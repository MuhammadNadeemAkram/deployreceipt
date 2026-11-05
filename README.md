# DeployReceipt

An open-source quality assurance and release approval platform for web developers and agencies.

Run automated website checks, capture test evidence, track issues, and share release reports with clients for review and approval.

**Private beta status:** invite-only admission is enforced by default. Hosted deployment is blocked by owner configuration; follow the [private beta deployment guide](docs/private-beta-deployment.md). No production launch is claimed.

**Current milestone:** email/password authentication and personal project management are implemented. Asynchronous fixture scanning and separately gated, owner-authorized public staging scans are implemented. Public scanning defaults off and production activation remains unavailable. Private QA reports, human triage, and bounded PDF export are implemented. Private versioned client release reviews and approval decisions are implemented. Teams, billing, AI and unrestricted public scanning remain unavailable. No scan is initiated merely by saving a project URL.

## Setup

Use Node.js 24 LTS (24.15.0 or newer; see .nvmrc) and npm 12.2.1.

```sh
npm install --global npm@12.2.1
npm ci
```

Copy .env.example to .env.local and set:

```dotenv
APP_ENV=local
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_LOCAL_PUBLISHABLE_KEY
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Use the **publishable** key beginning with sb*publishable*. This app deliberately rejects secret keys and legacy JWT keys in that setting. No service-role key or database password is used by the web application. Public-prefixed values are bundled for the browser. Never place privileged credentials in them or commit .env.local.

The example above uses a disposable local Supabase stack. Apply all migrations and configure beta admission using the deployment guide; a fresh database denies unadmitted accounts. A local production build accepts only loopback origins. Use the staging example and deployment guide for a hosted Supabase project and HTTPS web deployment.

Without configuration, public pages still render and account pages explain what is missing. Dashboard operations fail closed. For complete setup, migrations, confirmation/reset templates, and verification, read [Supabase setup](docs/supabase-setup.md).

```sh
npm run dev
# Open http://localhost:3000
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

Type checking generates Next.js route types first and works on a clean checkout. CI runs the web checks and a separate real PostgreSQL authorization suite through Supabase CLI and Docker, without production credentials.

## Stack and compatibility

- Next.js 16.4.3 App Router; React / React DOM 19.3.1
- TypeScript 6.0.3, strict mode; Tailwind CSS 4.3.3 and PostCSS
- ESLint 9.39.5 and matching eslint-config-next 16.4.3
- Supabase JS 2.118.0 and @supabase/ssr 0.12.7
- Vitest 5.0.5 for validation, auth/server-action, callback, and proxy tests
- npm 12.2.1 with exact dependencies and a committed lockfile

TypeScript 7 and ESLint 10 exceed the supported peer ranges of the current lint plugins. ESLint 9 is upstream deprecated; revisit the dependency combination when the React lint plugin supports ESLint 10.

## Architecture

```text
src/
  app/
    (public)/                   Landing page and auth pages; public header/footer
      get-started/              Redirects to signup
      login/ signup/            Email/password entry points
      forgot-password/          Reset request
      reset-password/           Verified-session password update
    auth/callback/              PKCE or email/recovery/invitation token verification
    dashboard/                  Protected workspace, loading/error/not-found states
      projects/new/             Create project
      projects/[id]/edit/       Edit owned project
      projects/[id]/delete/     Explicit deletion confirmation
    layout.tsx                  Document, metadata, skip link, global styles
  components/                   Shared layout and configuration notice
  features/
    auth/                       Auth actions, validation, verified-user boundary, forms
    projects/                   Project actions, queries, validation, forms
    marketing/                  Existing landing-page presentation
  lib/supabase/                 Server/browser clients, environment checks, schema types
  proxy.ts                      Next.js 16 cookie/session refresh and early route gate
supabase/
  config.toml                   Local development configuration
  migrations/                   Version-controlled schema, triggers, RLS, grants
  tests/database/               Transactional pgTAP authorization tests
 tests/                         Automated web/server tests (no live service required)
.github/workflows/ci.yml         Web checks and database checks
AGENTS.md                       Repository conventions
```

Server Components remain the default. Interactive forms use React action state for pending/error/success feedback and call Server Actions. Every protected data operation independently verifies the user with Supabase Auth; the proxy is not the only security boundary. Project ownership comes from PostgreSQL auth.uid(), never a submitted owner ID. Queries additionally filter by the verified owner, and RLS enforces row access independently.

Application tables contain no passwords or session tokens. Supabase manages auth records and cookie-based sessions. SSR cookies are refreshed through proxy.ts and written through server actions/callbacks. Avoid caching authenticated responses; callback redirects use a configured canonical origin and fixed allowed destinations. Callback parameters and tokens must not be logged.

The typed schema contracts in src/lib/supabase/types.ts reflect the migration and intentionally restrict writable columns. Regenerate/review schema types after migration changes; keep application writes limited to allowed columns.

## Current feature status

| Area                                                   | Status                                                                      |
| ------------------------------------------------------ | --------------------------------------------------------------------------- |
| Responsive landing page and GitHub links               | Implemented; original product presentation preserved                        |
| Signup, confirmation, login, password reset, logout    | Invite-only beta onboarding; requires configured Supabase Auth              |
| Private dashboard and project CRUD                     | Implemented; requires applied migration                                     |
| Profiles                                               | Created automatically on auth user insertion, including before confirmation |
| PostgreSQL RLS and restricted grants                   | Migration and database authorization suite included                         |
| Automated validation and server-flow tests             | Implemented; service calls are mocked in web tests                          |
| Restricted fixture scans, real checks and private PNGs | Implemented; see scanning guide                                             |
| QA reports, finding triage and private PDF export      | Implemented; requires reporting migration and Node runtime                  |
| Client review and release approval                     | Implemented; requires Task 05 migration and verified reviewer email         |
| Public scanning                                        | Not available                                                               |
| Teams, billing, AI                                     | Not implemented                                                             |

Email delivery and persistence against a real Supabase project require the integration verification in the setup guide. A passing mocked test does not establish real email delivery or database isolation; the database suite and manual two-user checks cover those boundaries.

## Roadmap

1. Configure protected staging and verify hosted invitation/recovery email, private PDF, evidence retention and two-user acceptance.
2. Complete an isolated database/Storage restore drill and configure operational alerts; revisit pagination as project volume grows.
3. Deploy and independently verify the isolated public topology on a permanent approved staging host before expanding beta access; production public rollout requires a separate review.
4. Verify hosted report/review operations, retention cleanup and account-erasure policy before separately authorized notifications, team roles or expanded approval workflows.

## Contributing

Read AGENTS.md. Work on a feature branch, keep changes focused, run lint, typecheck, tests, and build, and submit a PR. Run database tests when Docker/Supabase CLI are available. Report unexecuted checks explicitly. Keep feature claims and setup instructions accurate.

## License

Apache-2.0. See [LICENSE](LICENSE). The original license is preserved.

Build tooling note: dev and build select Next.js’s supported webpack bundler explicitly. Turbopack could not launch its CSS worker in this Windows environment; the webpack production build succeeds. This does not change the App Router or runtime architecture.

## Asynchronous scanning milestone

See [Scanning engine setup and security boundaries](docs/scanning-engine.md) for queue migrations, DNS authorization, the isolated local fixture topology, worker credentials, limits, retention, tests, and remaining deployment requirements. This guide covers the preserved fixture topology. Public staging uses the separate Task 07 topology and operator gates described below; no client parameter bypasses them. Added dependencies: Playwright 1.64.1, ipaddr.js 2.5.0, and tsx 4.23.15. Worker source is under worker/, scan UI/actions are under src/features/scans, and the forward migration is 20261102000100_scanning_engine.sql.

Dependency audit note (2026-11-02): npm reports 16 moderate development-toolchain advisories inherited through ESLint/minimatch. The suggested automatic fix downgrades to incompatible major versions and was not applied. No added runtime scanner dependency was identified in those advisories. Review the lint toolchain separately; this milestone does not claim a clean full dependency audit.

## QA reports and evidence

Owners can create reports from terminal scans, review immutable observations, add human severity/status/notes/comments, reference same-scan evidence and export a private PDF. Failed scans are diagnostic reports, and historical configuration is marked unknown when it was never recorded. See [reporting setup, PDF architecture and security](docs/qa-reports.md). Apply the new migration before deploying the updated worker, which records actual execution configuration. Public scanning defaults off; approved staging results use the same report model. Full controlled-fixture pipeline verification is tracked by the reports-end-to-end CI job and its proof artifact; report/SQL/layout tests alone do not establish that path.

PDF dependencies: pdf-lib and @pdf-lib/fontkit, with a vendored OFL-licensed Noto Sans font. Export uses a bounded Node worker with local fonts and private PNG bytes, not HTML or external website rendering.

## Client review and release approval

Owners can freeze a specific completed QA report, submit a three-day review invitation to one verified-email reviewer, collect finding/release feedback, and record an explicit change request or approval. Later report edits cannot change the snapshot or inherit an earlier approval. Notification delivery is manual; no invitation email is claimed. Apply `20261103000100_release_reviews.sql` `20261103000200_review_evidence_scope.sql` `20261103000300_review_reissue_audit.sql` and `20261103000400_reviewer_authenticated_downloads.sql` before deploying. See [client review architecture, state machine, retention and security](docs/client-release-reviews.md).

Owner routes are under `src/app/dashboard/releases`, the client portal under `src/app/reviews`, invitation instructions under `src/app/review-invitations`, and scoped evidence under `src/app/api/reviews`. Feature modules are in `src/features/releases`. Six RLS-protected tables hold snapshots, invitations, evidence references, comments, decisions and audit events. No new runtime dependencies or credentials are added. Existing owner-only reports/PDFs and fixture isolation remain intact.

The complete disposable CI workflow now covers owner-to-reviewer v1 change requests, v2 approvals, third-account denial, concurrent decisions, replay, revocation, missing evidence and separate historical records. Inspect its result and evidence artifact for the current revision; mocked tests do not establish this path. The review audit trail is not a legally qualified electronic signature and is removed by explicit project deletion.

## Private beta hardening (Task 06)

Hosted status: **blocked by owner configuration**; no staging URL or production launch is claimed. Admission is now fail-closed by default: operator-approved verified accounts with live sessions only, enforced in the app and database/Storage. The signup page provides onboarding instructions. Approved reviewers need separate operator admission. Hosted scans default disabled and the dashboard labels this clearly.

Read the [deployment, environment, migration, worker, backup/rollback and acceptance guide](docs/private-beta-deployment.md), [security findings/risk register](docs/beta-security-review.md), and [actual validation record](docs/beta-validation.md). Apply the new forward migration `20261104000100_private_beta.sql` before deploying this version. Existing migrations/license are preserved. No new dependencies were added.

Use `.env.staging.example` for isolated Preview settings; production configuration is prepared in `.env.production.example` but requires separately approved activation. `npm run validate:env` checks environment binding without printing credentials. `npm run audit:security` enforces the documented expiring dev-only exception and rejects other vulnerabilities. Vercel automatic Git deployments are disabled; manual staging smoke never deploys.

Readiness/liveness: `/api/ready` and `/api/health`. Operational code is in `src/lib/operations`, environment validation in `server/environment.mjs`, operator SQL in the new migration, and worker health checks under `worker/`. All hosted acceptance items and backup/alerting setup remain owner-run steps. Next task: configure protected staging, verify hosted auth/PDF/retention and an isolated restore drill before expanding the beta.

## Authorized public scanning (Task 07)

The feature branch implements an optional, default-off public scanning mode with exact-host DNS proof, explicit passive-scan consent, a separately isolated browser, pinned HTTP/TLS gateway, dedicated worker identity, SQL quotas/RLS and policy-aware report/PDF/review coverage. Existing fixture mode remains available separately. Production public scanning is not activated.

Read the [public scanning deployment/verification/disable guide](docs/public-scanning.md) and [threat model](docs/public-scanning-threat-model.md). Apply forward migration `20261105000100_public_scanning.sql` and configure the dedicated Auth token hook before using the public controller. `.env.public-worker.example` contains no credentials. No new application dependencies were added.

The owner-authorized test target is `https://www.noviqen.co.uk/`, mapped to the Vercel `theblogwriter` project. The target-site deployment remains unchanged. The manual public staging workflow requires actual TXT proof and passing security probes before enabling execution in its disposable staging environment; the first real run passed with six persisted checks, two private screenshots and an owner-authorized PDF/reviewer workflow. See the [actual validation record](docs/public-scanning-validation.md) for revisions, counts and evidence. A permanent hosted scanner and production rollout are separate from that test.
