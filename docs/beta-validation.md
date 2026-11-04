# Task 06 validation record

Date: 2026-11-04. Task05 was merged via PR#5 at main commit d1b081047317c42bb9c94be509df453c69d134fe before this feature branch. No live database was modified and no hosted deployment was made.

## Executed checks

The first complete green [CI run41805080935](https://github.com/MuhammadNadeemAkram/deployreceipt/actions/runs/41805080935) validated commit13366c3. Subsequent missing-configuration denial cases extend this baseline; inspect the [current PR checks](https://github.com/MuhammadNadeemAkram/deployreceipt/pull/6/checks) for the final revision.

| Check                                     | Actual result                                                                                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Node24/npm12.2.1 clean dependency install | Passed in CI using npm ci; package-lock preserved                                                                                        |
| ESLint / strict TypeScript                | Passed locally and in CI                                                                                                                 |
| Unit/server tests                         | 204 passed across10 files; includes environment isolation, admission failure, callbacks, headers, Auth, reports/PDF and review behaviors |
| Real Chromium browser/layout tests        | 5 passed across2 files                                                                                                                   |
| Production build                          | Passed locally and CI; Windows write-permission failure resolved by rerunning with filesystem access                                     |
| Fresh migrations                          | All9 migrations replayed on disposable Supabase PostgreSQL; no existing applied migration changed                                        |
| Real pgTAP authorization/integrity        | First complete green run:245 assertions across5 suites; final branch adds3 missing-settings denial assertions                            |
| Container egress/sandbox                  | Passed isolated Linux fixture probes; browser cannot reach public/private/metadata targets or carry worker credentials                   |
| Real scan/report/review/beta E2E          | Passed separate temporary owner/reviewer/outsider accounts, private Storage, real PDF, owner UI and client review UI                     |
| Full dependency audit policy              | Passes only the expiring moderate dev-only exception; full raw audit still reports16 moderate paths,0 high/critical                      |
| Runtime npm audit --omit=dev              | 0 vulnerabilities                                                                                                                        |

E2E evidence from the passing run is in its controlled-report-e2e artifact (seven-day retention): e2e-proof.json, e2e-release-proof.json, e2e-beta-proof.json, seven-page e2e-report.pdf, desktop/mobile report and client review PNGs, owner review and historical timeline PNGs. They contain disposable fixture observations, not real client website test results. Desktop report and mobile reviewer screenshots were inspected; no horizontal overflow was observed in the tested viewports.

## Verified workflow and negative cases

- Operator-admitted invitation token accepted server-side, password set, account signed in; direct unadmitted Auth signup rejected by the real hook. SMTP delivery is not claimed: the test uses admin-generated disposable invitation tokens, held only in memory.
- Owner authentication/project creation, verified controlled-fixture scan, real persisted check outcomes/configuration and private PNGs, manual triage preserving automated outcome, report generation and private PDF embedding.
- Reviewer invitation/authentication/acceptance, v1 change request, v2 revised approval, separate historical digests/events, third-user and original project-history denial.
- Concurrent decisions have one winner; stale/replayed/version-forged decisions fail; revoked invitations and missing evidence deny access; cross-origin action is rejected and literal HTML is not executed.
- Still-unexpired JWT denied after actual Auth session sign-out. Admission removal denies app API, direct database reads and private Storage; re-admission recovers. Readiness returns503 for inconsistent scan configuration while liveness remains200, and recovers after correction.
- Unique generated request IDs, per-response production nonce CSP, HttpOnly/Lax cookies and private worker heartbeat verified. Project deletion revokes report, export and review access.

## Controlled performance observations

Single disposable Linux CI run, localhost services and small real fixture report; these are observations, not benchmarks/SLOs or hosted load results:

| Measurement                                         | Observed                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Dashboard navigation to heading                     | 91 ms                                                                                  |
| Report navigation to heading                        | 389 ms                                                                                 |
| Four simultaneous authorized review API reads       | 79 ms total, all200 with distinct request IDs                                          |
| Authenticated PDF request through complete response | 807 ms                                                                                 |
| PDF                                                 | 75,232 bytes,7 pages, embedded private images                                          |
| Scan                                                | 6 executed checks:3 pass,1 fail,2 warnings; intentionally imperfect controlled fixture |

PDF memory is bounded by a128 MiB old-generation worker limit, not a measured total RSS guarantee. Worker container memory/CPU/PID limits remain configured. No large dataset query-plan, large-report memory profile or hosted load test was performed. Release lists now project summaries rather than entire frozen reports. React auth caching is request-scoped, with real revocation recovery checked across requests.

## Unexecuted hosted checks and acceptance gates

This Windows environment has no local Docker/Supabase CLI; real migrations/DB/E2E/isolation checks ran in GitHub's disposable Linux CI instead. There is no linked/authorized Vercel deployment configuration here, so **no staging URL** is available. Manual staging smoke workflow, HTTPS Secure cookies, hosted SMTP/reset delivery, account-level hook/rate-limit settings, Vercel PDF worker packaging, cloud-host egress controls, backup/Storage restore and alert delivery remain unverified. The owner must execute the [deployment and acceptance guide](private-beta-deployment.md).

Final status: **blocked by hosted configuration**, with a verified repository implementation and a restricted staging path. Production launch is not ready. Public scanning remains disabled; cloud worker activation additionally requires privileged credential and exact-host isolation review.
