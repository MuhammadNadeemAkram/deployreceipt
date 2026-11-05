# Public website scanning: threat model and infrastructure gate

Date: 2026-11-05. Task07 branch: `feat/secure-public-scanning`.

**Status: implemented behind staging release gates; validation in progress.** The gateway, separate public topology, dedicated worker identity, consent/RLS workflow and security tests are implemented on the feature branch. This document is not itself evidence of passing isolation or public E2E; consult the PR checks and validation record. Fresh installations and production public scanning remain disabled.

Task06 PR#6 is merged into main at `39bd935`. Existing fixture-only checks and application protections are the baseline. The operator identified Vercel as the hosting platform but did not identify a separate approved Linux worker host. The identified Vercel web deployment does not establish an approved worker/gateway runtime with the required network controls. Vercel also offers separate Container Runtime, Background Workers and Sandbox products; none is configured or verified for this repository, and their existence does not prove this topology is enforceable. Do not broaden the existing fixture firewall or enable a public scan mode to work around this.

The user replaced the previous target with `https://www.noviqen.co.uk/`. On 2026-11-05, read-only inspection of the authenticated [theblogwriter project](https://vercel.com/nadeemakram4436-1522s-projects/theblogwriter) verified:

- The target project is linked to `MuhammadNadeemAkram/theblogwriter`, not the DeployReceipt repository, and has a Ready production deployment.
- `www.noviqen.co.uk` and `theblogwriter.vercel.app` both show Valid Configuration / Production.
- `noviqen.co.uk` shows a 308 redirect to `www.noviqen.co.uk`.
- The project's Daemons page shows **No Daemons Configured** (all environments).
- The project's Sandbox page shows **Get Started with Vercel Sandbox** onboarding; no configured DeployReceipt scanning runtime was identified there.
- No deployment, domain, permission, environment-variable, service or billing setting was changed. No secret values were opened.

This verifies the website's deployment mapping, not the browser/gateway isolation or DNS TXT ownership proof required by DeployReceipt. Record `https://www.noviqen.co.uk` as the proposed staging test origin only. No DNS ownership challenge has been verified, no public scan has been queued and no scanner traffic has been sent by this task. Authorization for this exact hostname does not authorize the apex domain, sibling subdomains, cross-origin redirects or third-party infrastructure. Keep the scanner control plane and credentials separate from this live target-site project.

## Sources and design requirements

- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html): validate hostnames and all resolved addresses, control redirection, account for DNS pinning/rebinding and use network defenses.
- [Official Playwright Docker guidance](https://playwright.dev/docs/docker): untrusted sites need a separate unprivileged user and a seccomp configuration supporting the Chromium sandbox. The published image alone is not an isolation guarantee.
- [Vercel Container Runtime](https://vercel.com/docs/functions/runtimes/container), [Background Workers](https://vercel.com/docs/background-workers) and [Sandbox](https://vercel.com/docs/sandbox): these are separate deployment options requiring an explicit compatibility, network-policy and account-configuration assessment. Ordinary Next.js deployment is not evidence of an isolated scanning runtime. No platform-wide claim that Vercel cannot execute containers is made.
- Existing [fixture scanner boundaries](scanning-engine.md), [beta deployment guide](private-beta-deployment.md) and [Task06 risk register](beta-security-review.md) remain authoritative for currently implemented behavior.

These sources inform the proposed design. None establishes that the proposed controls are deployed or have passed tests.

## Assets, actors and trust

| Component / asset                                               | Trust and responsibility                                                                                                                            |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Beta users / registered URLs / DNS answers                      | Untrusted input, including malicious admitted users and compromised owner-controlled sites                                                          |
| Target HTML, scripts, resources, redirects and response headers | Fully hostile, even after successful ownership verification                                                                                         |
| Chromium renderer                                               | Treat as potentially compromised; no network authority, credentials, host mounts or reusable state                                                  |
| Browser supervisor                                              | Small trusted process in a constrained disposable execution domain; no Supabase credentials                                                         |
| Policy gateway                                                  | Security-critical connector; validates actual destinations and protocol, pins connections, bounds bytes/time, supplies sanitized policy decisions   |
| Worker controller                                               | Trusted orchestration; leases, authorized job scope, evidence/result persistence and cleanup; must not expose queue/database privileges to Chromium |
| Supabase Auth/PostgreSQL/Storage/queue                          | Trusted service boundary with independently enforced admission, ownership, grants, leases and retention                                             |
| Next.js / Vercel                                                | Authenticated control plane and existing reports/reviews; never executes a browser in a web request                                                 |
| Screenshots and report observations                             | Confidential, attacker-controlled content; private access, bounds and retention apply                                                               |
| Host administrator and kernel                                   | Trusted isolation substrate; kernel/browser compromise remains residual risk                                                                        |

Ownership proof authorizes a bounded scan; it does not make the scanned content safe. Operator approval, account admission, DNS proof and explicit per-scan consent serve different purposes and cannot substitute for each other.

## Proposed enforceable architecture

```text
Next.js -> owner-checked PostgreSQL RPC -> pgmq lease -> worker controller
                                                       |
                                               disposable browser
                                                       |
                                         policy-enforcing gateway
                                                       |
                                       validated public HTTP(S) origin
```

Select a dedicated Linux VM/runtime supporting namespaces, host-enforced firewall rules, custom seccomp, cgroup resource limits and unprivileged sandboxed Chromium. Keep the existing fixture topology separate. A Docker bridge marked internal, DNS checks or Playwright routing alone is insufficient.

The implementation uses a **bounded HTTP fetch gateway with controller-mediated response delivery**:

1. Browser namespace denies every new outbound IPv4/IPv6 connection, including loopback, DNS, UDP, metadata, control services and ordinary internet traffic. Only established responses on the controller's browser-management connection are permitted. No host networking or published browser-management port.
2. Browser requests are intercepted and submitted by the trusted controller to a separate authenticated gateway control interface. Chromium receives response bytes, never a gateway control credential or database token. The browser cannot call that interface directly. Playwright interception selects requests but is not the network boundary: bypass attempts hit the namespace firewall.
3. Gateway accepts an immutable, expiring per-job origin and budget supplied by the controller after a valid queue lease. It supports only normalized GET/HEAD requests, no CONNECT tunnel or arbitrary raw socket forwarding. It does not offer a general internet proxy.
4. Gateway parses/canonicalizes each destination, resolves A/AAAA through its configured bounded resolver, rejects the entire answer set if any address is unsafe, then opens a connection to one validated numeric address without a second hostname lookup. Verify the socket peer address. HTTPS uses the original hostname for Host, SNI and certificate verification, with validation enabled. Redirects return to policy evaluation; never follow them implicitly.
5. Gateway egress firewall independently denies private, special-purpose, metadata and control networks; only approved DNS resolver traffic and validated public HTTP/HTTPS ports are allowed. The control interface cannot route between networks. Firewall rules are installed before dropping setup capabilities; missing rules prevent startup.
6. Bound response headers, compressed and expanded bytes, job totals, socket counts, requests and elapsed time. Reject unsupported encodings rather than accidentally forwarding a decompression bomb. Never forward target cookies, authorization, proxy credentials or user-supplied headers. Strip Set-Cookie from delivered responses and start each context without website credentials.
7. Recycle browser processes/namespaces between hostile jobs. Fresh contexts are required within each job but are not sufficient protection against browser-process compromise across jobs. Remove temporary files and volumes; restart/quarantine on cleanup failure.

This architecture avoids opaque HTTPS CONNECT tunnels, which would prevent the gateway from enforcing methods, response budgets and origin policy inside TLS. Compatibility, TLS, redirect and resource tests run against controlled fixtures; real public compatibility must be established by the owner-authorized staging workflow. Do not enable an unrestricted CONNECT fallback when a site fails to render.

For the initial MVP, block all third-party resources and cross-origin redirects. A resource being public does not establish the owner's authority to scan it. Record resulting coverage limitations. Future third-party exceptions require a separate review and must pass the same connection-time policy.

## Threats and required mitigations

| Threat                                                                                             | Required control and test                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSRF to loopback/private/link-local/metadata/reserved destinations                                 | Shared normalized policy plus numeric-address gateway connection plus independent network deny rules; prove target counters receive zero prohibited traffic                                                                  |
| Alternate IPv4 notation, IPv4-mapped IPv6, scoped IPv6, backslashes, userinfo, parser disagreement | Strict raw-input validation and a single canonical URL contract; reject ambiguity, unsupported schemes/ports and prohibited encodings rather than guessing                                                                   |
| DNS rebinding, mixed A/AAAA answers, public-to-private changes                                     | Validate all answers for every new destination/connection; pin numeric connection; assert actual peer; no second DNS lookup or fallback after rejection                                                                      |
| DNS failures / IPv6-only transport not safely supported                                            | Fail closed and record a policy/infrastructure limitation; never skip validation or silently use system browser DNS                                                                                                          |
| Redirect to another host, protocol or private IP                                                   | No implicit follow; bounded same-verified-origin redirect chain with fresh destination checks; cross-origin redirects blocked                                                                                                |
| Link check or subresource bypass                                                                   | Same gateway path and budgets for navigation, screenshots, links and every resource; no alternate HTTP client with broad egress                                                                                              |
| Browser bypass / WebSocket / WebRTC / service worker / raw socket                                  | Deny new network connections outside gateway-mediated fetch, UDP/DNS and unnecessary protocols; disable SW registration and WebSockets, block popups/downloads, test with malicious fixture scripts and direct socket probes |
| Compromised browser steals worker credential                                                       | Separate execution domains; no worker secrets, credential environment, privileged mounts or gateway bearer token in browser; dedicated least-privilege worker identity before activation                                     |
| Cross-job browser persistence                                                                      | Disposable process/namespace and bounded tmpfs per job, no reuse of profiles/cache/service workers; cleanup and crash recovery tests                                                                                         |
| Malicious JS / infinite loops / huge bodies / request storms                                       | CPU/memory/PID/socket/byte/time/request limits at independent host, gateway and controller boundaries; abort and dispose whole job on deadline                                                                               |
| State-changing requests / GET side effects                                                         | Remote GET/HEAD only, no form automation or arbitrary scripts/authenticated sessions; do not claim GET is side-effect-free; require explicit informed user consent                                                           |
| Screenshot content and signed URL leakage                                                          | Existing private Storage/RLS/retention, bounded PNG validation, final authorization checks; never log screenshot URLs or move rendering into an external service                                                             |
| Unverified or expired hostname / sibling authorization                                             | Exact canonical registered hostname TXT proof with random challenge and expiry, recheck before scan, never inherit sibling/apex proof; server uses stored URL only                                                           |
| Forged scan / user result writes / stale queue leases                                              | Existing authenticated project ownership/RLS plus owner-checked submission, immutable results and current lease checks; no privileged user grants                                                                            |
| Many accounts overwhelm one domain                                                                 | Shared hostname budget/cooldown/concurrency under DB locking, in addition to per-user quota and project active-job limit; gateway global concurrency/budgets                                                                 |
| Policy denial misreported as website defect                                                        | Separate policy-blocked/not-executed observations from actual HTTP failures; warnings and scope limitations propagate to dashboard, report, PDF and frozen approvals                                                         |
| Unsafe logs / DNS or URL secret exfiltration                                                       | Allowlisted event codes and aggregate counts; no raw URLs, query strings, request bodies, headers, TXT challenges or provider error messages                                                                                 |

TLS validation must stay enabled. A hostile DNS answer resolving to a public server still does not bypass TLS identity verification. A valid certificate and public IP do not authorize a different hostname or prove that GET requests are harmless.

## Ownership and audit contract for future implementation

- Reuse secure unique DNS TXT challenges, but define canonical hostname normalization identically in application, SQL and gateway. The current SQL hostname extractor is not by itself a complete public URL authorization policy.
- Verify `_deployreceipt.<exact-hostname>` and bind proof to the stored hostname, project, challenge, checked time and expiry. Recheck expiry and hostname at submission and job start; stale queued jobs must not inherit fresh authority accidentally.
- Do not accept a submitted arbitrary target URL, success flag, network allowlist, job budget or gateway endpoint from a browser form.
- Preserve automated outcomes and historical snapshots. Store policy observations with actual execution status; never inflate passes for checks that could not run.
- Record submission, verification, denial and worker failure using sanitized audit events. Apply forward migrations/RLS/restricted grants; never edit merged migrations.
- Keep fixture and public jobs distinguishable throughout configuration snapshots, report scope and client approvals. A fixture proof cannot satisfy public-hostname verification.

## Host and credential prerequisites: currently unverified

The following are the hosted activation checklist; passing CI does not silently activate a permanent deployment:

- [ ] Existing approved Linux worker host identified, with a configured authorized management connection. Vercel identification alone does not satisfy this.
- [ ] Host supports custom seccomp, Chromium user namespaces/sandbox, capability dropping, cgroup limits and independently verified IPv4/IPv6/DNS egress rules.
- [ ] Dedicated least-privilege controller identity/RPC and Storage grants; Task06's broad privileged worker secret is not approved for hostile public scans.
- [ ] Gateway implementation, non-bypassable control/data networks and secret separation reviewed on the exact runtime; no public proxy or browser control ports.
- [ ] Exact test origin remains explicitly authorized and DNS ownership verified through the application.
- [ ] Separate staging services, private artifacts, cleanup, backups and incident kill switch configured.

No connection details for such a worker host are currently configured in this workspace. Neither checkout has a linked `.vercel/project.json`; no Vercel deployment token is configured in this task environment. The user supplied the dashboard URL and completed browser sign-in, allowing read-only verification of the target-site project. That project has no configured daemon and does not identify an approved scanning runtime. Browser access to the target website project does not supply a worker deployment identity or demonstrate enforceable egress policy. Docker/Supabase CLIs are unavailable locally; prior Linux CI verifies the **existing fixture topology only**.

## Adversarial validation plan

All attack fixtures must run inside an isolated namespace with no route to third-party public services. Use a test-only resolver/connector harness and controlled HTTP/TLS/DNS servers; do not add a production environment variable that bypasses public-address validation. Container probes must prove deny behavior independently of Playwright routing.

Required groups before activation:

1. URL parsing: alternate/encoded IPs, IPv6/mapped/scoped variants, localhost aliases, credentials, control characters, backslashes, ambiguous authorities, unsafe schemes/ports and parser consistency.
2. DNS/socket: safe+unsafe mixed answers, empty/timeouts, rebinding, connection-time address substitution, correct TLS hostname/SNI and certificate rejection. Demonstrate no hidden second resolution.
3. HTTP: bounded same-origin redirect chains, cross-origin/private redirects, response headers/body/encoding limits, method restrictions and no CONNECT/Upgrade tunnel.
4. Browser: direct DNS/TCP/UDP/loopback/control/metadata attempts, proxy bypass, SW/WebSocket/WebRTC, downloads, popups, malicious JS, memory/request storms, cleanup and controller/browser/gateway crashes.
5. Database: current verified exact hostname, expiry/change invalidation, quota races across accounts/domains, result immutability, RLS/worker privilege misuse and stale leases.
6. End-to-end: real owner/reviewer accounts, actual TXT proof, public gateway fetch, checks, screenshots, immutable results, dashboard/report/PDF/approval, cross-user denial, retention and recovery.

Existing unit/fixture/container tests cannot substitute for these new tests. **Public staging E2E: pending execution.** The manual workflow creates a disposable Linux staging database and public topology only after isolated security tests pass and the exact owner-issued DNS challenge resolves. It stores no production credentials and tears down on completion. Do not run a public test merely because a target URL was supplied.

## Rollout and emergency response

Keep `scan_settings.mode` restricted to its existing disabled/local values and retain fixture-only worker/browser rules. Do not add a client-selectable public mode or repurpose SCANNING_AVAILABLE=fixture as public permission. A future forward migration must default public execution off and require operator staging approval, expiring infrastructure attestations and a separate production gate.

On a future incident: deny new public submissions and leases in the database, stop/quarantine public worker and gateway containers, revoke the dedicated worker identity, preserve sanitized event IDs, inspect private artifacts under owner authorization and verify network containment. Never loosen egress to recover availability. Leave fixture topology isolated. Re-enable only after root cause, cleanup, exact-host regression and owner review.

Production rollout recommendation: **do not enable production public scanning**. The supported activation target is explicitly approved staging with a matching tested image revision, recent independent infrastructure evidence, a dedicated worker identity and live gateway/browser readiness. No current high-impact activation blocker is waived by this document.

## Residual risks after a future implementation

Kernel/Chromium vulnerabilities, public-site GET side effects, resource exhaustion, shared hosting/CDN ambiguity, DNS or certificate-authority compromise and operational misconfiguration cannot be eliminated by URL checks. Screenshot content may contain sensitive or offensive material even without an authenticated session. A bounded scan is neither a vulnerability assessment nor security certification. Require informed scope consent, conservative defaults, patching, private retention and an incident owner.

## Implementation references

- `worker/gateway/`: shared URL/DNS policy, numeric pinned HTTP/TLS connections, request/body/time/per-IP/global budgets, authenticated per-job control API and kernel firewall.
- `compose.scan-public.yml`: separate browser/controller/gateway networks; browser receives no application or gateway credentials. All images share the tested commit; readiness rejects mismatches.
- `20261105000100_public_scanning.sql`: default-off staging gates, custom worker role/access-token hook, exact-host ownership/consent, worker-bound leases/artifacts, hostname/global quotas, RLS and sanitized audit.
- `compose.scan-public-test.yml`: no internet route; controlled TLS endpoint, raw kernel bypass probes and TLS verification tests.
- `public-scanning-staging.yml`: explicit manual owner-authorized real-target validation, with isolated probes first and DNS proof required before any scan. This is not permanent infrastructure or a production rollout.
