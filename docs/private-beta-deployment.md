# Private beta deployment and operations

Status: configuration prepared; **hosted deployment blocked by owner configuration**. No staging URL has been deployed or verified by this change. Production is not activated. Task 05 PR #5 was merged into main before this work. No paid services, live database writes, production deploys or domains are authorized by these instructions.

## Architecture and boundaries

Vercel serves the Next.js Node web application, Auth callbacks and bounded PDF worker threads. A dedicated staging Supabase project provides Auth, PostgreSQL, private Storage and pgmq. The web application uses only its publishable key and the caller's HttpOnly session cookies. RLS combines existing owner/reviewer policies with a restrictive live-session + verified-email + operator admission check. Public signup displays operator instructions; the Auth before-user-created hook also rejects direct unadmitted registration. Reviewer invitation does not grant beta membership.

The isolated browser and privileged queue orchestrator remain on separate containers. Chromium has no credentials, no public network route and only the controlled fixture endpoint is permitted by its firewall. Vercel cannot enforce this container topology or host the long-running worker. The default hosted beta has **scanning disabled**, visibly labeled in the dashboard. Existing reports and client reviews remain usable. Public URL scanning has no supported configuration.

## Environment reference

Copy `.env.example` for local development, `.env.staging.example` for staging, or consult `.env.production.example` for future production. Use Node 24 LTS and npm 12.2.1, then `npm ci`. `npm run validate:env` validates without printing values; build runs it too. Next embeds NEXT_PUBLIC values at build time: rebuild when changing environments.

| Variable                             | Web                 | Worker   | Purpose                                                         |
| ------------------------------------ | ------------------- | -------- | --------------------------------------------------------------- |
| APP_ENV                              | required hosted     | no       | local, staging, production                                      |
| NEXT_PUBLIC_SITE_URL                 | required            | no       | Exact canonical origin; HTTPS hosted; no path/query/credentials |
| NEXT_PUBLIC_SUPABASE_URL             | required            | no       | Dedicated project's HTTPS origin                                |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | required            | no       | Publishable key only, never secret/service-role                 |
| STAGING_SUPABASE_PROJECT_REF         | required hosted     | no       | Staging hostname binding                                        |
| PRODUCTION_SUPABASE_PROJECT_REF      | required hosted     | no       | Different reserved/actual production ref; never the staging ref |
| SCANNING_AVAILABLE                   | disabled default    | no       | disabled; fixture only with independently verified isolation    |
| OPERATIONAL_LOGS                     | enabled recommended | no       | Sanitized structured dependency/readiness logs                  |
| LOCAL_PUBLIC_SIGNUP                  | optional local dev  | no       | enabled only in non-production local dev; never hosted          |
| PRODUCTION_ACTIVATION                | unset staging       | no       | approved only after separate production release authorization   |
| SUPABASE_URL                         | no                  | required | Orchestrator's database API origin                              |
| SUPABASE_SECRET_KEY                  | **never web**       | required | Broad privileged secret; isolated orchestrator only             |
| SCAN_WORKER_MODE                     | no                  | local    | Existing fixture-only engine mode                               |
| STAGING_SITE_ORIGIN                  | smoke CI only       | no       | Protected environment variable, canonical HTTPS staging origin  |
| VERCEL_AUTOMATION_BYPASS_SECRET      | smoke CI only       | no       | Optional protected secret for Vercel deployment protection      |

Vercel supplies VERCEL/VERCEL_ENV; do not override them. Preview requires APP_ENV=staging and cannot bind to the production ref. A production build mislabeled local can connect only to loopback. No secrets belong in repository examples or public variables. Production activation is an explicit guard, not a substitute for approval or protected environments.

## Owner staging setup (in order)

1. Use an existing authorized staging Supabase project with no customer data. Create infrastructure only with owner approval. Reserve a different production project ref; do not put production keys in preview scope. Record project identifiers privately.
2. Follow the migration procedure below. Migration defaults are enforced admission, environment staging and scanning disabled. Keep scan_settings.mode=disabled. Confirm the Storage bucket is private and has a 2 MiB file limit.
3. In Supabase Auth enable the **Before User Created** PostgreSQL hook `public.before_user_created`. The local config enables this automatically; hosted dashboard configuration is separate and mandatory. Disable anonymous and unused social providers, require email confirmation, double-confirm email changes, secure password changes, minimum 12-character passwords. Disable unrestricted signup operationally if using admin invitations; the DB hook still provides admission defense. Configure sign-in/signup 20 per five minutes/IP, email 10/hour, refresh 150/five minutes/IP and verification 20/five minutes/IP, or stricter supported equivalents. Hosted values are not applied by a SQL migration. Configure owner-approved SMTP; verify delivery before inviting testers. Do not log callback tokens.
4. Insert approved, lowercased emails into beta_access using the SQL editor/operator connection, **before** creating or inviting accounts. Example with a placeholder: `insert into public.beta_access(email) values ('approved-person@example.test') on conflict(email) do update set active=true;`. Use Supabase's admin invitation flow and verify email ownership. Never give operators' keys to testers. Admission removal (`active=false`) revokes application and Storage access immediately, including already-issued JWTs. Auth sign-out/session deletion also revokes access at the DB boundary. Auth user deletion removes retained usage records.
5. Use an existing authorized Vercel project, connect the repository, Node 24, framework Next.js, `npm ci`, `npm run build`, default output. `vercel.json` disables automatic Git deployments. Keep that disabled. Configure Preview variables from the staging example, no worker secret. Establish a stable staging branch alias/canonical HTTPS origin and Vercel deployment protection before sharing any URL. Variable values are entered in the account UI, not committed.
6. Set Supabase Site URL to that canonical staging origin and allow only its exact `/auth/callback` and recovery callback destination. Avoid wildcard domains or production callbacks. Temporary deployment aliases redirect to the configured canonical origin; health/ready are directly testable. Do not distribute a temporary alias as an auth origin.
7. From an authenticated owner CLI linked to the **existing staging Vercel project**, run `vercel pull --environment=preview`, `vercel build`, then `vercel deploy --prebuilt` on the reviewed branch. Confirm the linked project IDs before running. Do not use `--prod`. Set the stable staging alias to this preview using the Vercel UI, and verify protection applies to it. A deployment may require a rebuild once the canonical alias is finalized. This guide does not execute any of those commands or create infrastructure.
8. Check `/api/health` (process alive) and `/api/ready` (configuration + DB schema/settings/private bucket/queue ready). Ready is 503 on missing dependency or env mismatch. The response reveals no project data. Confirm cookie Secure/HttpOnly/SameSite=Lax over real HTTPS and callback/reset/logout behavior.
9. Configure GitHub environment `staging`: required reviewers, main-only deployment branches, STAGING_SITE_ORIGIN variable, optional bypass secret. Run the manual Staging smoke workflow from main after approved merge/deploy. It performs three read-only checks and never deploys. Health failure must not be bypassed by marking the deployment ready.
10. Execute the acceptance checklist below with two fresh accounts and one unadmitted account. Keep the preview protected while resolving any failures.

HTTP-only cookies are intentional: current UI authentication uses server actions and server components. The unused browser Supabase factory must not be used for cookie-based browser auth without a separate security review. Pages are dynamically rendered for per-response nonce CSP; authenticated responses are never shared-cacheable. Nonce CSP follows the [Next.js guidance](https://nextjs.org/docs/app/guides/content-security-policy). No external analytics or error-tracking dependency is installed.

## Database migration and configuration

All migrations in supabase/migrations are append-only; Task 06 adds `20261104000100_private_beta.sql`. It adds four operator-only RLS tables, restrictive admission policies on all 17 application tables and Storage, bounded write quotas, session checks, readiness/worker metrics RPCs, indexes and a database scan-lease kill switch. Existing immutable snapshots, tenant ownership policies and historical results are preserved. The old leasing implementation is private to a security-definer wrapper, inaccessible directly to service_role.

Clean disposable validation: install Docker and pinned Supabase CLI 2.122.0, run `supabase start` then `supabase db reset --local`, `supabase test db`, and `node tests/integration/report-pipeline.mjs` after `npm ci` and Chromium install. Reset is **only** for an isolated disposable local database. CI recreates this topology and applies every migration from scratch; no hosted/customer project is reset.

For existing staging: take/verify a backup first; review `supabase migration list --linked` against the intended staging ref. Run `supabase db push --linked --dry-run`, inspect the exact pending forward migrations, then owner-run `supabase db push --linked`. Never run db reset against linked/live projects. Migration is transactional: on failure stop deployment, capture sanitized error, verify migration history and rollback transaction, fix with a forward migration after diagnosis. Do not mark a failed migration as applied. Keep old app/worker paused until configuration and readiness pass.

Local beta tests require explicit `beta_settings.environment='local', enforced=true`; fixture E2E also sets scanning_enabled=true and scan_settings.mode=local in the disposable DB. To run the legacy local development setup without admission, an operator may explicitly set environment=local,enforced=false; schema disallows disabling admission in staging/production. This bypass is not a hosted setup option.

Performance: authenticated transactions have 10 s statement and 3 s lock timeouts. Project listing already filters owner and limits results. Release listing now selects summary columns instead of full frozen report JSON. New indexes support queue status/time, invitation ordering, evidence paths, reviewer ownership and bounded quota cleanup. Inspect EXPLAIN (ANALYZE, BUFFERS) with synthetic data in staging before expanding beta; no customer dataset or production load test is used. PostgreSQL sessions and admission are looked up once per statement using scalar RLS subqueries; server auth admission is cached only within one React request.

## Worker deployment and recovery

Use `compose.scan-local.yml` on a dedicated authorized Linux VM/container runtime that supports internal networks, iptables, custom seccomp, read-only roots and Linux Chromium sandboxing. Do not use Vercel/serverless functions or relax firewall/sandbox controls. No port is published. Only the orchestrator joins both control and scan networks. Browser capabilities are dropped after firewall setup, Chromium runs as pwuser with sandbox enabled, and DNS/public/private/metadata endpoints are denied except the exact fixture service. Existing egress CI probes verify this boundary.

Resource budgets: browser 768 MiB/1 CPU/256 PIDs, fixture128 MiB/64 PIDs, orchestrator256 MiB/64 PIDs; tmpfs and shared memory remain bounded. One job per orchestrator, bounded attempts/leases/idempotent finalization remain unchanged. Browser and orchestrator have file-based health checks refreshed during long scans; privileged heartbeat data has no customer URLs. Monitor `docker compose -f compose.scan-local.yml ps` and container health. Docker unhealthy status alone does not restart a running container: alert the operator and investigate; restart only the failed service after pausing leases. The worker exits/restarts on process termination; browser exits if Chromium closes.

Default hosted web runs with no worker and scanning disabled. Cloud worker activation requires a separate review of host enforcement and the broad orchestrator secret. Never inject it into Chromium. Use an uncommitted `.env.worker`, restrictive filesystem permissions and an operator secret store. Do not copy local keys into hosted environments.

Emergency pause: operator `update public.beta_settings set scanning_enabled=false where singleton;`, then stop worker service. The DB lease wrapper prevents new jobs even from old worker versions. In-flight bounded jobs can finalize; if quarantining a suspected compromise, stop both containers and revoke the secret immediately. After recovery restart browser/fixture, verify egress probes, start one orchestrator, inspect operational_status and expired leases. Existing lease retry/idempotency handles retries; do not manually manufacture successful results or duplicate queue messages.

Artifact retention remains seven days, existing cleanup RPC/object removal enforced. A web-only beta has no worker cleanup loop: schedule a private operator cleanup run at least daily (expired_scan_artifacts RPC then Storage deletion), or retain no uploaded evidence until an isolated worker exists. Do not enable Storage upload permissions to work around that. Missing/expired evidence is explicitly labeled in reports and exports. Snapshot audit data is deleted by explicit project deletion; it is not an independent legal archive.

## Monitoring, alerts and incident response

/api/health is dependency-free liveness; /api/ready has a five-second DB budget. A proxy-generated x-request-id is forwarded through Next; callers cannot choose it. Structured logs allow only known event names, safe error codes, UUID correlation and timing. Auth errors, tokens, signed URLs, SQL payloads, report content and raw provider errors are never logged. Application dependency calls timeout at ten seconds. Existing immutable review events remain the business audit trail; operational logs are separate.

Use Vercel logs plus an owner-configured HTTPS uptime monitor (for example a self-hosted Uptime Kuma instance). No paid service or telemetry export is created. Error tracking can consume the sanitized JSON envelope; do not attach request bodies, cookies or full URLs. An operator-only `select public.operational_status();` returns queued/running/stale_leases/failed_24h/healthy_workers, not customer data. Poll with an operator connection outside the web app; ordinary users cannot execute it. Route alerts through the owner's chosen incident channel; no automatic outbound messages are sent by this app.

Initial alert policy: readiness failing twice over two minutes; any stale lease older than its configured expiry; queue >10 for five minutes with scanning enabled; no fresh worker heartbeat for60 s when enabled; failed scan spike >5/hour (use job records for the hourly window). When scanning disabled, do not page for zero workers. Track PDF failure/timeout rates and dependency latency without content. Tune thresholds with actual beta evidence; no production SLO is claimed.

Incident: pause scanning and invitations, restrict Vercel protection to operators, preserve sanitized correlation IDs/timestamps, identify affected versions/accounts. Revoke admission/sessions and rotate affected keys in the correct environment. Never post screenshots or tokens in public issues. Restore a disposable copy and test isolation before recovery. Owner decides customer notification requirements. Document timeline, impact and follow-up before reopening beta.

## Backup, restore and rollback

Before migrations/releases, record commit, deployment ID, migration versions, project ref, settings and bucket configuration privately. Verify Supabase backup/PITR availability and retention for the owner's actual plan; do not buy a plan automatically. If unavailable, use owner-run encrypted database exports kept outside the repository, with restricted access and expiry. Include application/Auth data and schema, and separately export **Storage object bytes**: a database backup alone does not back up the screenshots. Queue state and secrets require a separate recovery plan; never replay old queued jobs blindly. Record a beta RPO of24 h/RTO of4 h as a target pending a measured restore drill, not a guarantee.

Test restore into an isolated authorized recovery project with no public access, replace keys and redirect configuration, restore schema/data/Storage, reconcile only valid retained objects and outstanding queue leases. Verify two-user RLS, beta/session gates, historical review digests, private evidence, PDF exports and deletion. Never overwrite live records for a drill. A database dump with auth/storage ownership may need Supabase's documented managed restore process; validate commands with the current platform rather than improvising role grants.

Rollback: first pause DB leases and stop workers, disable invitations/limit access. Reassign staging alias to the recorded previous compatible Vercel deployment in the UI. Keep the forward migration and restrictive admission policies; do not remove RLS or run destructive down migrations. Old web builds lack the new UI gate but database admission stays enforced. Old workers must stay stopped until compatibility is verified; DB kill switch remains active. If a schema correction is necessary, ship a forward fix. Verify health/readiness, login, cross-user denial and historical audit continuity before reopening. Data restore is an owner-approved incident operation, never an automatic deployment rollback.

## Release controls and acceptance

CI checks every PR: clean npm install, lint, TypeScript, unit/server tests, real browser checks, production build, expiring dependency policy, fresh migrations/pgTAP, fixture egress and real DB-backed scan/report/review/beta workflows. Require all four CI jobs in branch protection, review approval, and prohibit main force pushes. Configure a separate protected `production` GitHub environment with required reviewers and main-only branches before any future deployment workflow; none is installed or activated here. Keep Vercel Git deployments disabled. An approved production launch requires a separate request, dedicated project, production variables/activation, backup drill and complete acceptance evidence.

Private-beta acceptance (owner signs off after staging deployment):

- [ ] Dedicated staging project and protected canonical preview; no production credentials or customer data.
- [ ] All forward migrations applied; Auth hook/rate limits/SMTP configured and independently checked.
- [ ] Unadmitted direct signup denied; approved account invited, verified, logged in; password recovery callback delivers and works.
- [ ] Secure/HttpOnly/Lax cookies; logout, expired/revoked session and admission removal block database and private Storage access.
- [ ] Developer CRUD, real stored reports, private PDF, separate admitted reviewer, v1 change request and v2 approval, immutable history, third-user denial.
- [ ] Scanning disabled visibly; if fixture worker separately activated, egress/sandbox and private key separation verified on that exact host.
- [ ] Missing evidence, stale invitations, dependency outage, readiness recovery and project deletion tested.
- [ ] Desktop/mobile keyboard navigation and report/reviewer layouts inspected.
- [ ] Hosted dashboard/report/PDF timings and bounded concurrency measured; PDF worker thread/4 MiB response verified on Vercel.
- [ ] Daily evidence cleanup, backup/restore drill, monitoring/alert destination and rollback owner established.
- [ ] No high-impact unresolved findings; time-bounded dev dependency exception understood.

Repository tests do not check these boxes on behalf of an unconfigured hosted deployment. See the [risk register](beta-security-review.md) for residual blockers and [validation record](beta-validation.md) for actual executed results.

References: [Supabase Auth hooks](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook), [live sessions and JWT lifetime](https://supabase.com/docs/guides/auth/sessions), [Vercel response limits](https://vercel.com/docs/functions/limitations). PDF output is capped at4 MiB below the documented4.5 MB response limit, with no external HTML rendering or resource fetching.
