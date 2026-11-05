# Authorized public scanning: staging deployment and operations

Task07 implements an optional public path in addition to the existing fixture path. It is **off by default** and is supported only in explicitly approved staging. Production remains off. See the [threat model](public-scanning-threat-model.md) and PR checks for actual verification; do not infer a passing public E2E from unit tests.

## Scope and architecture

Next.js authenticates an admitted owner, obtains informed consent and submits the stored project ID to an owner-checked SQL RPC. A dedicated controller leases the job, verifies current exact-host DNS TXT again, and creates an immutable gateway origin/budget. Chromium has no new outbound network access, DNS route or Supabase/gateway credentials. Its requests are fulfilled from the controller's authenticated, bounded gateway responses. The gateway resolves all A/AAAA answers, rejects any unsafe address, pins the numeric IPv4 socket, verifies actual peer, preserves Host/SNI and validates TLS certificates. IPv6-only sites are unsupported in this MVP; unsafe IPv6 answers are rejected even when a safe A record exists.

All remote requests are GET/HEAD. No CONNECT/Upgrade tunnels, supplied scripts, authenticated target sessions, forms, user headers, uploads/downloads, cookies or authorization headers are forwarded. Set-Cookie is stripped. Same-origin redirects are limited to five browser hops; third-party resources and cross-origin redirects are blocked. Browser-origin JavaScript and GET requests may have side effects despite these controls; explicit scan consent acknowledges that limitation. Blocked responses are warning/coverage observations, never automatic vulnerability claims.

New public roles do not use the broad service secret. The controller signs in with a dedicated Auth account and publishable key; a trusted access-token hook assigns `deployreceipt_scan_worker` only to active operator-registered identities. It cannot read customer project/check tables or download/sign screenshots. Its result/configuration/artifact operations are bound to its assigned live lease. Storage SELECT is permitted only for trusted delete operations on expired objects, not downloads/list/sign. Worker revocation and session revocation apply to still-unexpired JWTs.

## Database and Auth setup

Apply forward migration `20261105000100_public_scanning.sql` after all Task06 migrations. It preserves historical results/snapshots, fixture behavior and existing RPC clients. New operator tables have RLS and no ordinary client write grants. Public audit rows are immutable to users, owner-readable and retained 30 days. Do not edit old migrations or reset a live database.

In a dedicated staging Supabase project, configure both Auth hooks:

- Before User Created: existing `public.before_user_created` admission hook.
- Custom Access Token: new `public.scan_worker_access_token` hook. Local Supabase configuration enables it for disposable tests; hosted Auth must be configured separately.

Use an operator connection to admit the controller email before creating its confirmed Auth user; register that user's UUID in `scan_worker_identities` with active=true. No public account can self-register as a worker or invoke the token hook. Do not reuse a human owner/reviewer account. A missing/misconfigured hook makes controller startup fail closed because its JWT role is checked.

## Exact hostname authorization

The project uses its stored canonical HTTP/HTTPS URL, a DNS hostname and a default port. Embedded credentials, ambiguous parser forms, local/internal destinations and IP-literal targets are rejected. DNS TXT uses `_deployreceipt.<exact-host>` with value `deployreceipt=<random project challenge>`. For `www.noviqen.co.uk`, the record name is `_deployreceipt.www.noviqen.co.uk`; in Namecheap's `noviqen.co.uk` zone the Host field is only `_deployreceipt.www` because the provider appends the zone.

Create/recheck the challenge through the project UI. A verified result expires after24 hours; changing the URL invalidates it. No sibling/apex authority is inherited. Submission requires verified DNS, explicit consent, beta admission and the current stored URL. Leasing rechecks authority and target consistency; the worker checks real TXT again immediately before execution. No client may supply a substitute scan URL or verification success.

## Controller/container setup

Use the existing authorized Linux runtime only after its kernel/firewall/sandbox controls pass the supplied probes. The target website can remain on Vercel. Never attach this worker to the live website project's credentials or reuse the fixture network. A Vercel Sandbox/custom container deployment needs its own equivalent networking, lifecycle and secret-separation verification; a successful ordinary Vercel website deployment is not that proof.

Copy `.env.public-worker.example` to ignored `.env.public-worker` and supply only controller-scoped credentials. Create a random32-byte lowercase-hex gateway key in the operator secret store; supply the same value to controller/gateway. Do not put it in Chromium or the web app. Set PUBLIC_SCAN_CODE_SHA to the exact40-character tested commit. All three image builds bake in that revision; the controller compares gateway/browser health and sends matching revision evidence to SQL.

```sh
docker compose --env-file .env.public-worker -f compose.scan-public.yml build
docker compose --env-file .env.public-worker -f compose.scan-public.yml up -d
```

No ports are published. The browser has read-only mounts, bounded tmpfs/shared memory, seccomp, unprivileged sandboxed Chromium and dropped capabilities after firewall setup. The gateway is separately unprivileged after its firewall setup. Browser namespace OUTPUT permits only established replies; it has no direct DNS/TCP/UDP/IPv6 path. Gateway OUTPUT separately denies private/special IPv4 and all IPv6, allows only its fixed resolver and public TCP80/443. Controller is the only component joining browser-management and gateway-control networks; it alone has the restricted worker login. Never mount the Docker socket, host network, home directory or production credentials.

The public browser process is closed after each job and its supervisor exits; restart policy provides a fresh browser process for the next job. Fresh contexts are also used per viewport. A failed restart makes readiness fail; queue visibility/leases and bounded attempts provide recovery. Do not reuse a browser profile or persistent Sandbox snapshot containing hostile execution state.

## Explicit staging activation

Set web APP_ENV=staging, PUBLIC_SCAN_STAGING=approved, SCANNING_AVAILABLE=public, with the Task06 dedicated project-ref and HTTPS origin validation. Production or local web public-mode flags are rejected. These are server/operator configuration, never UI inputs.

Only after reviewing a passing security suite on the exact host, an operator may set the database gates:

```sql
update public.beta_settings set environment='staging',enforced=true,scanning_enabled=true where singleton;
update public.scan_settings set mode='public' where singleton;
update public.public_scan_settings set operator_enabled=true,staging_approved=true,
 production_enabled=false,infrastructure_checked_at=clock_timestamp(),
 security_suite_sha='REPLACE_WITH_REVIEWED_40_CHARACTER_COMMIT' where singleton;
```

The placeholder cannot pass the SHA constraint. Infrastructure approval expires after24 hours and worker/gateway/browser readiness after45 seconds. The registered worker must be active with a live session, and its image revision must match the reviewed SHA. A stale/missing gateway or mismatched image cannot execute a job. Heartbeat propagation is bounded; stopping containers is required for immediate in-flight shutdown. Production public execution remains unavailable in this milestone; the reserved production flag does not override the staging restriction.

The project page displays public availability only when both server configuration and database readiness pass. A verified owner must check the scope/side-effect consent checkbox for each Run Scan submission. The existing fixture button/API continues to require only its fixture authorization and cannot silently become a public request.

## Bounds and evidence

One public job globally at a time; one active project scan; existing per-user daily quota and cooldown. Across all accounts, each hostname has a120-second cooldown and20 scans/24 hours. The gateway also caps each destination IP at60 requests/minute and32 MiB body/minute, and total egress at120 requests/minute and64 MiB/minute. These transient gateway windows complement persistent SQL hostname quotas and reset on gateway restart; operator trust and beta admission remain necessary.

Each scope permits at most100 requests, two upstream sockets,90 seconds,2 MiB per response and16 MiB total response bytes (including failed partial bodies). Headers are bounded separately. The controller queues at most100 browser resource requests; invalid methods and origins are denied. Renderer limits remain browser768 MiB/1 CPU/256 PIDs, controller256 MiB/0.5 CPU/64 PIDs, gateway256 MiB/0.5 CPU/64 PIDs. PNG evidence is bounded by the existing policy/private2 MiB Storage bucket and seven-day retention. Existing PDF page/time/heap/output limits remain in force.

The original immutable outcomes remain pass/fail/warning. Policy-blocked requests and checks with executed=false are explicitly recorded in details and propagated through scan UI, report/PDF limitations and review scope. A blocked request is not counted as an HTTP broken link. Unknown or missing evidence is never reconstructed. Screenshot timing is execution timing, not a Core Web Vitals or accessibility assessment.

## Automated verification and actual public staging test

Normal PR CI runs URL/DNS/rebinding/redirect/method/budget tests, real TLS with a trusted disposable certificate and hostname mismatch rejection, raw browser/gateway namespace probes, SQL/RLS/worker privilege tests, real Auth-hook/Storage API boundaries, baseline fixture pipeline and production build.

`compose.scan-public-test.yml` has no internet route. Its public-range numeric fixture address is assigned exclusively inside an internal Docker network; tests never send adversarial traffic to real public systems. Disposable certificate keys remain under ignored work/ and are never committed or copied into production images.

The manual CI workflow accepts only the explicitly owner-authorized hostname `www.noviqen.co.uk`. PUBLIC_SCAN_E2E_CHALLENGE is encrypted in GitHub Actions only with the owner's explicit approval. It proves actual DNS before starting any public scan. It first reruns isolated security tests on that runner, then creates a disposable local Supabase staging database and the public topology. It enables public scanning only within that disposable staging environment, verifies real persistence/private screenshots/report/PDF/reviewer approval/cross-user denial and kill switch, then disables execution and tears everything down. The report/reviewer UI runs locally on the runner; this test does not claim a permanent hosted SaaS deployment or email delivery.

Dispatch the existing CI workflow from the feature branch or reviewed main with authorized_hostname=www.noviqen.co.uk; it calls the public staging workflow. No arbitrary public target, authentication/session data or custom JavaScript is accepted. A missing or mismatched TXT challenge returns BLOCKED before scanning; a mock/fixture result is never substituted.

## Emergency disable, cleanup and rollout

Immediately set public_scan_settings.operator_enabled=false and beta_settings.scanning_enabled=false using an operator connection. Stop the public worker, gateway and browser containers to abort in-flight execution. Revoke the worker identity (active=false), terminate its Auth sessions and rotate affected secrets if compromise is suspected. Preserve only sanitized event codes/correlation IDs. Re-run exact-host isolation probes before recovery; do not weaken firewall, TLS validation or admission to restore availability.

Worker cleanup removes expired Storage objects through restricted expiry checks and private queue/RPC handling. If the worker is stopped, perform the existing operator retention cleanup; a web-only deployment has no cleanup daemon. Forward-migrate fixes; never roll back by dropping RLS or enabling broad service credentials in the public controller. Fixture mode can continue separately.

Permanent staging rollout requires an approved long-lived host, hosted Auth hook configuration, dedicated staging data/Storage, daily cleanup, alerting/backup/restore verification and updated24-hour infrastructure attestation. Production rollout remains a separate reviewed release. Kernel/browser vulnerabilities, GET side effects, DNS/shared-host ambiguity and operator misconfiguration remain residual risks; no security certification is claimed.
