# Scanning engine: restricted local milestone

## Supported scope and safety gate

Public URL scanning is **disabled in the database**. There is no public-mode environment switch. The only enabled scan target in the supported development mode is `http://fixture:8080/` (or a path on that origin), served by the controlled fixture in this repository. DNS ownership verification is implemented for public domains, but verification does not enable public scans.

Do not describe this milestone as a production-secure arbitrary-URL scanner. Before implementing public mode, independently review and test a connection-time egress proxy, IPv4/IPv6 address policy, pinned DNS/TLS connections, redirects, resource requests, sandboxing, and deployment network controls. `worker/security.ts` includes preparatory public-address/pinning utilities and tests; they are not a public-browser transport.

The local browser container has a firewall allowing new outbound TCP connections only to the fixed fixture IP/port. IPv6 output is denied. Docker's scan network is internal. The browser uses a fixed resolver mapping, blocks service workers/WebSockets/popups, and authorizes each request. Browser interception is an additional check, not the network boundary.

## Data flow

1. An authenticated owner creates/rechecks a domain challenge through a Server Action and owner-checked SQL RPC.
2. A queue job checks DNS TXT against a random 256-bit project token. In local mode, the exact administrator-provided fixture is explicitly authorized with method `local_fixture`; this is not DNS ownership proof.
3. The owner requests a scan by project ID only. SQL takes the stored URL, locks the per-user quota/project, checks verification, target mode, cooldown/daily limits, and one-active-scan constraint.
4. SQL inserts `scan_runs` and sends a pgmq message in the same transaction.
5. A separate Node worker claims a 180-second queue visibility window and a matching lease token. It connects to the isolated Playwright browser and runs bounded checks.
6. Private PNG uploads complete first. All check rows, derived counts, and terminal status are then committed atomically through a worker-only RPC.
7. Queue acknowledgement is refused until work is durably terminal. Operational failures retry without acknowledging an active scan. Crashed workers' leases become reclaimable after visibility expiry; a resumed worker enforces attempt/age limits.
8. Owner-checked pages/API routes display persisted observations. Artifact routes sign only the stored artifact of an owned scan for 60 seconds.

No browser runs inside a Next.js request. No application cookies, credentials, authenticated browser state, user-defined scripts, or arbitrary Playwright instructions are passed to the target page.

## Installation and migrations

Use the Node/npm versions in README. Run `npm ci`. Added dependencies are Playwright and ipaddr.js; tsx runs the TypeScript worker.

Apply both pending scan migrations (schema and the forward artifact-policy correction) with the existing Supabase CLI workflow:

```sh
supabase link --project-ref YOUR_DEVELOPMENT_PROJECT
supabase db push --dry-run
supabase db push
```

Review the dry run. Never reset a hosted database. The migration enables pgmq, creates the private `scan_jobs` queue and scan tables/functions, and creates a private `scan-artifacts` bucket. Do not expose pgmq/pgmq_public schemas or restore anonymous/authenticated execute grants on queue helpers. Clients may call only the two owner-checked request RPCs. Worker RPCs are restricted to service_role.

Application tables have RLS. Users cannot insert/update/delete verification results, runs, or checks directly. Owners can read only their project records. Existing project policies still apply. Any URL edit removes verification and cancels active runs; an old lease cannot commit after that cancellation.

## Domain authorization

On a project’s Scans & details page, create a challenge. Add this exact TXT record using the displayed domain/token:

```text
Name:  _deployreceipt.YOUR_DOMAIN
Value: deployreceipt=YOUR_PROJECT_TOKEN
```

Click Recheck verification after DNS propagation. The worker handles TXT chunking, exact matching, resolver timeouts, and bounded records. Verification expires in 24 hours. Tokens are not a substitute for SSRF protection. New project URLs require a new challenge. A worker must run for verification to leave pending state.

## Restricted local development

Prerequisites: Docker Engine/Compose, Linux container support, a disposable local Supabase stack, and Chromium sandbox/user-namespace support. Keep this setup on a development machine. No service port is published by the scan Compose file.

1. Start local Supabase (`supabase start`) and apply migrations using `supabase db reset --local` only if its data is disposable.
2. Configure the existing web .env.local with local API URL and publishable key as documented in the Supabase guide.
3. Copy .env.worker.example to .env.worker. Set SUPABASE_URL to `http://host.docker.internal:54321` and SUPABASE_SECRET_KEY to the local **secret** API key (`sb_secret_...`). For a hosted development project, use its HTTPS API URL and its worker-only secret. Never use NEXT_PUBLIC_ for this key.
4. In the disposable development database, explicitly enable only the fixture mode:

```sql
update public.scan_settings set mode='local' where singleton;
```

5. Start the restricted topology:

```sh
docker compose -f compose.scan-local.yml up --build -d
docker compose -f compose.scan-local.yml logs -f worker browser
npm run dev
```

6. Sign in, create a project with URL `http://fixture:8080/`, open Scans & details, and create/recheck the challenge. A running worker marks the administrator-provided fixture authorization.
7. Once verified, click Run QA Scan. Observe queued → running → terminal state, then inspect the six real check records and private desktop/mobile screenshots. The controlled fixture intentionally includes a broken link, JS errors, and a blocked metadata redirect: warnings/failures are expected observations.
8. Reload or sign in again to verify persistence. Use a second account to verify that the project, scans, checks, and screenshots are inaccessible.
9. Change the project URL and confirm verification is invalidated. Stop/restart a worker during a scan to verify lease recovery; allow up to 180 seconds for reappearance.
10. Stop only this local topology when finished:

```sh
docker compose -f compose.scan-local.yml down
```

`npm run worker` loads .env.worker and starts the same Node orchestrator. It must have access to the isolated browser endpoint for local scans; use the Compose worker for the supported topology. When scanning is disabled it can process DNS verification without a browser. Do not run an uncontained arbitrary-target browser alongside worker credentials.

The browser entrypoint installs IPv4/IPv6 firewall rules as root, then drops to pwuser with no capabilities. The browser gets no worker environment file. It runs with Chromium sandbox enabled and the upstream Playwright seccomp profile. If firewall/sandbox setup fails, it must exit; do not “fix” startup by adding privileged mode, host networking, disabling the firewall, or disabling the sandbox.

The fixture network has a fixed private subnet; resolve local subnet conflicts before starting. Chromium uses a pinned fixture mapping rather than page-controlled DNS. Control/API egress belongs only to the Node orchestrator, which has no inbound service listener.

## Limits and retention

Only administrators can update `scan_settings`. Server/database validation constrains all settings; clients cannot override them.

- One active scan per project; one worker attempt at a time.
- Default 10 scans/user/UTC day; 60-second cooldown, serialized across projects.
- At most 5 same-origin links, 2 viewport screenshots, 100 requests by default, and 90 seconds of browser execution.
- Fixed desktop 1440×900 and mobile 390×844 viewports.
- Up to 3 attempts; 180-second visibility/lease; queued work older than one hour becomes terminal when a worker next claims it.
- Default 2 MiB per screenshot; hard storage cap 5 MiB.
- Default screenshot retention 7 days (1–30 configurable). Owner reads expire with retention. The worker removes up to 100 old objects per minute, including orphaned uploads. Keep a worker scheduled/running for cleanup.
- Metadata/checks remain available until project deletion. Pgmq archived message retention is an operator maintenance responsibility.

A screenshot proves only that a viewport was captured. These are not visual-regression, performance, accessibility-certification, vulnerability, or exhaustive link checks.

Messages and URLs are bounded/sanitized before persistence: query strings/fragments, common credential patterns, bearer strings and JWTs are redacted. No request headers or raw provider errors are saved. Private site content may appear in screenshots; restrict account access and storage retention accordingly.

## Checks performed

- Availability: observed navigation, final policy-validated URL, HTTP status and elapsed navigation time. Failures are categorized as timeout/DNS/TLS/blocked/navigation when identifiable.
- Desktop/mobile: separate isolated contexts and real PNG viewport captures.
- JavaScript: bounded page/console errors; console locations distinguish first/third-party where available. Page-error attribution is explicitly unknown.
- Links: at most five deduplicated same-origin HTTP links, navigated through the same guarded browser (not an API client that could bypass egress).
- Network: observed request failures/HTTP failures, sanitized resources, category, and request-limit warnings.

Completed means execution finished. Individual checks can fail. Terminal engine timeouts retain only observations captured before the deadline.

## Tests and verification

```sh
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run test:browser
npm run build
supabase db start
npm run test:db
```

Unit tests cover parsing, IPv4/IPv6/encoded addresses, mixed DNS/rebinding/pinning, verification, bounded links, ownership, signing, persistence ordering, retries and stale leases. Browser tests run only with NODE_ENV=test against an ephemeral loopback fixture; this explicit test policy cannot be passed in a normal worker process. Browser tests are not network-isolation proof.

Database pgTAP tests use real roles, queues, grants, quotas, leases, result transactions, and private Storage read policies. They roll back all fixtures. CI runs them on fresh local PostgreSQL. No production credentials are required.

To test the actual container firewall separately:

```sh
cp .env.worker.example .env.worker
docker compose -f compose.scan-local.yml up -d fixture
docker compose -f compose.scan-local.yml run --build --rm -e SCAN_EGRESS_TEST_ONLY=1 browser
docker compose -f compose.scan-local.yml down
```

This mode applies the identical firewall and capability drop before attempting fixture, loopback, metadata, public, wrong-port and IPv6 connections. It does not enable public scanning or prove protection against every browser exploit.

## Remaining deployment requirements

Public scanning remains unavailable even if unit/container smoke tests pass. A production public mode needs an independent network/SSRF review, connection-time proxy enforcement for every protocol, sandbox isolation and resource testing, deployment-specific egress verification, worker-specific least-privilege credentials, operational monitoring and retention scheduling. A real configured Supabase/browser end-to-end run remains a separate verification from unit, browser-fixture and SQL tests.

No AI, PDFs, client approvals, billing, unrestricted crawling, user scripts, or public performance claims are included.

Worker shutdown is bounded too: a non-responsive browser disconnect stops blocking the attempt after five seconds. The Compose worker restarts after a process crash; durable leases govern recovery rather than an in-memory queue.
