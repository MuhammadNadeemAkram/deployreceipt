# Repository conventions

- Read README, Git status, and relevant code before editing. Preserve unrelated work and the Apache-2.0 license.
- Work on a feature branch and prepare a PR; never push directly to main.
- Use Node.js 24 LTS and the npm version in package.json. Commit package-lock.json; use npm ci.
- Keep routes and metadata in src/app, shared components in src/components, feature UI in src/features/<feature>/components, and shared configuration in src/lib.
- Default to Server Components. Add client components only for required browser interactions. Keep secrets and database access server-side.
- Use strict TypeScript, named component exports, the @/ alias, semantic HTML, visible keyboard focus, and responsive layouts.
- Prefer small concrete modules; avoid unnecessary dependencies and empty service abstractions.
- Label illustrative content and keep documented feature status accurate.
- Do not implement auth, billing, AI, database access, or workers without task authorization. Future browser workers must execute outside the web request lifecycle.
- Never commit credentials, .env files, node_modules, build output, or caches. Keep .env.example credential-free.
- Run npm run lint, npm run typecheck, and npm run build before handoff. Add meaningful tests for behavior changes and report incomplete checks.
- Update README setup, architecture, roadmap, and status when behavior changes.

## Authentication and database conventions

- Authentication covers personal accounts and project CRUD. Scans, reports and reviews follow their dedicated conventions below; teams, billing and AI remain out of scope.
- Use @supabase/ssr clients. The server client is server-only. Never introduce a service-role or secret key into web code or public environment variables.
- Refresh cookies in src/proxy.ts for Next.js 16. Verify users independently in each protected page/action; do not trust getSession or submitted IDs for authorization.
- Derive project owner_id from auth.uid() in SQL. Keep ownership and immutable columns out of grants and writable application types. Enforce RLS for every new application table and operation.
- Keep schema changes in new versioned supabase/migrations files. Do not edit an applied migration; add a forward migration. Maintain database authorization tests for allowed and denied operations across two users and anonymous callers.
- Callback redirects must use the configured canonical origin and fixed destinations. Never log auth tokens, callback URLs, or raw provider errors.
- Use server validation and accessible form state. Do not fetch submitted website URLs during project management.
- Run npm test alongside lint/typecheck/build. Run npm run test:db with Supabase CLI and Docker when available, and distinguish mocked web tests from real database tests.

## Scanning engine conventions

- Fixture mode remains isolated; Task07 also authorizes the separately gated public staging mode. Reports and client reviews follow their dedicated conventions below. Unrestricted/unverified scanning, production public activation, billing, AI and user-defined scripts remain out of scope.
- Read docs/scanning-engine.md before changing worker/network code. Public mode defaults off and requires current exact-host DNS, per-scan consent, tested image revision, independent host evidence, live gateway/browser readiness and operator staging approval. Do not bypass these gates or rely only on Playwright routing.
- Keep the privileged Node orchestrator separate from the browser container. Browser containers receive no application credentials, no host networking, and no privileged mode. Keep the firewall, sandbox, capability drop, and resource bounds intact.
- Use pgmq leases and worker-only RPCs. Persist artifacts/results before acknowledgement. Reject stale lease writes; test crash recovery, duplicate jobs, quotas, and denied permissions in SQL.
- Add forward migrations only. Keep RLS enabled on scan tables and private screenshot policies tied to project ownership. Never accept client-supplied scan targets, outcomes, limits, or verification success.
- Browser fixture tests are test-only. Distinguish unit tests, fixture browser observations, real SQL tests, container egress tests, and configured end-to-end runs in handoffs.

## Report/evidence conventions

- Task 04 authorizes private QA reports, manual triage/comments, same-scan evidence references, and bounded PDF export. Client reviews follow Task 05 conventions below. Public scanning, anonymous sharing, billing and AI stay unavailable.
- Derive reports from terminal persisted scans. Keep automated observations immutable and manual triage in separate tables. Unknown historical configuration/authorization must remain unknown.
- Use owner-checked RPCs and RLS for all report mutations. Composite evidence keys must prevent cross-scan references; preserve original Storage retention.
- PDF export must not render HTML or fetch arbitrary URLs. Keep PNG validation, local font assets, worker/thread/output limits, Origin checks, export leases, and final ownership recheck intact.
- Never pass authentication credentials into the rendering worker or persist signed screenshot URLs in reports/PDFs.
- Keep SQL, unit/API, real PDF, browser-layout fixture and configured live end-to-end verification distinct in handoffs. Do not claim the scan-pipeline prerequisite is complete without evidence.
## Client release review conventions

- Task 05 authorizes private versioned release reviews, verified-email invitations, feedback, explicit decisions and audit history. Public scanning, anonymous sharing, legal signatures, billing, deployments and AI remain unavailable.
- Construct snapshots in SQL from real eligible reports; never trust submitted outcomes/snapshots/owners/authors. Snapshot content and digest remain immutable, including drafts. Revisions require a new version and decision.
- Match invitations against current verified Auth email and accepted user ID, not metadata or JWT email alone. A URL never grants access. Keep invitation GET routes read-only and authentication redirects fixed.
- Keep owner/report/scan policies intact. Reviewers see only active accepted review snapshots and exact referenced evidence. Stream private evidence with bounded downloads, expiry and final authorization checks; never issue reviewer signed redirects or extend retention.
- All transitions, feedback and decisions use scoped RPCs with RLS, row locks, restricted grants and append-only audit/decision records. Preserve prior decisions after revocation and revisions; document project-deletion cascades.
- Test verified separate users, third-account denial, simultaneous/replayed decisions, version forgery, expiry/reissue/revocation, literal HTML, private evidence and the complete browser workflow. Distinguish real SQL/E2E results from mocked tests.

## Private beta operations

- Hosted deployments require distinct staging/production project refs and enforced verified-email/live-session admission in SQL and app boundaries. Keep direct Auth signup guarded by the hosted Before User Created hook. Review invitations never grant beta admission.
- Preserve restrictive beta RLS/Storage policies, operator-only tables and database-backed quotas. Only explicitly configured local databases may bypass admission.
- Keep web scanning disabled unless the exact fixture-only runtime has passed isolation checks; Vercel cannot host the worker. Never expose the orchestrator secret to web or browser code.
- Maintain nonce CSP, HttpOnly/Secure/Lax server auth cookies, sanitized operational event allowlists and bounded health checks. Never log raw dependency URLs/errors or customer content.
- Run audit:security with other required checks; the documented dev-only exception expires2026-12-04. Do not broaden it to runtime/new advisories.
- Git auto deployment stays disabled. Production activation and live database operations need a separate authorized release. Update deployment/risk/validation docs with actual executed evidence, including unavailable hosted checks.

## Public scanning conventions

- Read docs/public-scanning.md and the threat model before public worker/network changes. Keep fixture tests/topology separate.
- Chromium has no direct outbound path or credentials. All public responses use the pinned policy gateway with TLS validation, same-origin GET/HEAD, body/request/time/IP budgets and denied tunnels.
- Use only the dedicated live-session worker role, never a service secret in public mode. Preserve worker-bound leases, upload scope and operation-limited expired cleanup.
- Never count policy blocks or unexecuted checks as website defects or successful tests. Preserve immutable raw observations and historical approvals.
- Adversarial tests use no-internet controlled networks. Real public E2E requires explicit owner authorization and actual DNS proof; publish sanitized evidence and keep hosted/ephemeral validation distinct.
- Public production remains off; do not change a target site's hosting configuration to run the scanner.
