# Task 07 validation record

Date: 2026-11-05. Branch: `feat/secure-public-scanning`; base: Task 06 merge `39bd935`. PR: [#7](https://github.com/MuhammadNadeemAkram/deployreceipt/pull/7).

## Scope

The owner explicitly authorized `https://www.noviqen.co.uk/`. Its exact-host DNS challenge was verified by the real Linux controller immediately before scanning. The owner separately approved encrypted challenge storage in GitHub Actions. Challenge values, worker credentials, temporary environments and generated evidence are excluded from Git.

The Linux GitHub Actions runner provided a disposable approved staging runtime. Controlled adversarial fixtures and namespace/TLS probes run before public execution on that runner. Supabase Auth/PostgreSQL/Storage and the controller/gateway/browser topology are disposable. The reporting/reviewer web UI runs locally on the runner. This establishes a real public-target pipeline; it does not establish a permanent hosted application, production launch, email delivery, backups, alerting or security certification.

The target's live Vercel project was inspected read-only and was not modified. Production public mode and new-install defaults remain off. The workflow disables execution and tears down its staging resources after validation.

## Revision-specific checks

Final behavioral revision: `be9ea9f7fdc067b518396f0cdac3da8717789b32`.

| Check                                   | Actual result                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Local ESLint                            | Passed, no warnings                                                                                                                   |
| Local TypeScript                        | Passed                                                                                                                                |
| Local unit/server/security tests        | 254 passed across 11 files                                                                                                            |
| Local browser integration tests         | 7 passed across 3 files                                                                                                               |
| Local production build                  | Passed with configuration absent and scanning disabled                                                                                |
| Dependency audit policy                 | Passed; 0 high/critical, 8 moderate development-toolchain advisories under existing GHSA-g3hv-75wg-m249 exception expiring 2026-12-04 |
| Real PostgreSQL migrations/RLS tests    | All 10 migrations applied to disposable PostgreSQL; 285 checks passed across 6 SQL files                                              |
| Preserved fixture namespace egress      | Passed on Linux                                                                                                                       |
| Final public namespace/TLS and full E2E | Passed: all 6 manual workflow jobs green, including real DNS-authorized public E2E                                                    |

[Final PR CI](https://github.com/MuhammadNadeemAkram/deployreceipt/actions/runs/42027537472) and [final authorized staging run](https://github.com/MuhammadNadeemAkram/deployreceipt/actions/runs/42027593392) identify the tested revision independently of later documentation edits.

The database suite caught a PL/pgSQL alias collision in the additional worker-specific readiness guard on revision `9e09b75`. It was corrected in `be9ea9f` and the full database suite passed. Earlier superseded runs were cancelled; they are not counted as passing validation.

## Final genuine public-target result

[Successful final authorized public workflow](https://github.com/MuhammadNadeemAkram/deployreceipt/actions/runs/42027593392), revision `be9ea9f7fdc067b518396f0cdac3da8717789b32`:

| Observation             | Persisted result                                                  |
| ----------------------- | ----------------------------------------------------------------- |
| Exact target origin     | `https://www.noviqen.co.uk`                                       |
| Ownership               | Real DNS TXT; current proof rechecked by dedicated worker         |
| HTTP availability       | 200                                                               |
| Automated observations  | 6 checks; 4 passes, 0 failures, 2 warnings                        |
| Policy-blocked requests | 23; recorded as coverage limitations                              |
| Private evidence        | 2 genuine PNG screenshots                                         |
| Private PDF             | 762,765 bytes; 8 pages                                            |
| Release review          | Verified separate reviewer access and version-bound approval      |
| Authorization           | Unrelated account denied report/review/evidence access            |
| Disable/deletion        | Kill switch and access revocation after project deletion verified |
| Production activation   | False                                                             |

The earlier real run on `f349053` also passed ([run 42021935903](https://github.com/MuhammadNadeemAkram/deployreceipt/actions/runs/42021935903)); its policy and PDF sizes differed because target content and request timing can vary. The final results above are taken from the final proof artifact, not copied from that earlier run.

The uploaded `authorized-public-staging-evidence` artifact contains the sanitized proof JSON, desktop/mobile report screenshots, mobile review screenshot and PDF. Evidence is retained by Actions for seven days. Generated files are not committed. Counts reflect one bounded run and are not general website quality or vulnerability claims.

## Security checks and operational limits

- URL/DNS tests reject alternate IP representations, mapped IPv6, mixed/private answers, unsafe schemes/ports/credentials, rebinding, unverified redirects, prohibited methods and exceeded budgets. Numeric sockets preserve TLS hostname/SNI verification and prohibit a second DNS lookup.
- Internal-only Docker fixtures verify real trusted-certificate TLS, hostname mismatch rejection, response bounds, no implicit redirect following, cookie stripping and kernel denial of private/loopback access. Private listeners make these more than connection-to-absent-service checks. No adversarial traffic targets the public website.
- Browser probes use the production firewall/capability setup, unprivileged sandboxed Chromium, direct TCP/UDP/DNS/IPv6 and proxy-bypass attempts. Playwright routing is not the sole boundary.
- SQL and real Auth/Storage integration verify custom worker role issuance, live-session revocation, caller-specific revision readiness, consent, queue leases, scoped uploads, denied downloads and stale writes. Existing owner/reviewer and deletion policies remain active.
- Public results use existing immutable observations, private artifacts, reports, notes, PDF and versioned approvals. Missing/unexecuted coverage remains explicit; no findings are seeded for public execution.

No new application dependency was added. Apache-2.0, merged migrations, existing history and lockfile are preserved. Local Docker/SQL execution was unavailable; real Linux CI results are reported separately from local tests.

For a permanent staging deployment, follow [public scanning operations](public-scanning.md): dedicated staging Auth hooks/data, restricted worker identity, tested image revision, independently tested host networking, operator approval and expiring readiness. Maintain seven-day private artifact cleanup, patching, monitoring and incident response. Third-party resources, cross-origin redirects, IPv6-only targets, authenticated sessions and user scripts remain unsupported. GET side effects and browser/kernel vulnerabilities remain residual risks.

Production recommendation: retain default-off production public scanning until a separate host-specific deployment and operational review is approved. Do not reuse the target website's project or credentials for the scanner.
