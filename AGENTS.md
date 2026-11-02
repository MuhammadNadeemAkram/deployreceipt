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

- This milestone authorizes Supabase authentication and personal project CRUD, not teams, scans, billing, or AI.
- Use @supabase/ssr clients. The server client is server-only. Never introduce a service-role or secret key into web code or public environment variables.
- Refresh cookies in src/proxy.ts for Next.js 16. Verify users independently in each protected page/action; do not trust getSession or submitted IDs for authorization.
- Derive project owner_id from auth.uid() in SQL. Keep ownership and immutable columns out of grants and writable application types. Enforce RLS for every new application table and operation.
- Keep schema changes in new versioned supabase/migrations files. Do not edit an applied migration; add a forward migration. Maintain database authorization tests for allowed and denied operations across two users and anonymous callers.
- Callback redirects must use the configured canonical origin and fixed destinations. Never log auth tokens, callback URLs, or raw provider errors.
- Use server validation and accessible form state. Do not fetch submitted website URLs during project management.
- Run npm test alongside lint/typecheck/build. Run npm run test:db with Supabase CLI and Docker when available, and distinguish mocked web tests from real database tests.

## Scanning engine conventions

- This milestone authorizes the restricted fixture scanning engine, not public URL scanning, reports, approvals, billing, AI, or user-defined scripts.
- Read docs/scanning-engine.md before changing worker/network code. Public scanning stays disabled; do not add an environment bypass or rely only on Playwright routing.
- Keep the privileged Node orchestrator separate from the browser container. Browser containers receive no application credentials, no host networking, and no privileged mode. Keep the firewall, sandbox, capability drop, and resource bounds intact.
- Use pgmq leases and worker-only RPCs. Persist artifacts/results before acknowledgement. Reject stale lease writes; test crash recovery, duplicate jobs, quotas, and denied permissions in SQL.
- Add forward migrations only. Keep RLS enabled on scan tables and private screenshot policies tied to project ownership. Never accept client-supplied scan targets, outcomes, limits, or verification success.
- Browser fixture tests are test-only. Distinguish unit tests, fixture browser observations, real SQL tests, container egress tests, and configured end-to-end runs in handoffs.

## Report/evidence conventions

- Task 04 authorizes private QA reports, manual triage/comments, same-scan evidence references, and bounded PDF export. Public scanning, anonymous sharing, approvals, billing and AI stay unavailable.
- Derive reports from terminal persisted scans. Keep automated observations immutable and manual triage in separate tables. Unknown historical configuration/authorization must remain unknown.
- Use owner-checked RPCs and RLS for all report mutations. Composite evidence keys must prevent cross-scan references; preserve original Storage retention.
- PDF export must not render HTML or fetch arbitrary URLs. Keep PNG validation, local font assets, worker/thread/output limits, Origin checks, export leases, and final ownership recheck intact.
- Never pass authentication credentials into the rendering worker or persist signed screenshot URLs in reports/PDFs.
- Keep SQL, unit/API, real PDF, browser-layout fixture and configured live end-to-end verification distinct in handoffs. Do not claim the scan-pipeline prerequisite is complete without evidence.
