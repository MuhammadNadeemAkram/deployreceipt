# DeployReceipt

An open-source quality assurance and release approval platform for web developers and agencies.

Run automated website checks, capture test evidence, track issues, and share release reports with clients for review and approval.

**Current milestone:** email/password authentication and personal project management are implemented. Website checks, QA evidence, reports, client approvals, teams, billing, and AI remain planned. No scan is initiated when a project URL is saved.

## Setup

Use Node.js 24 LTS (24.15.0 or newer; see .nvmrc) and npm 12.2.1.

```sh
npm install --global npm@12.2.1
npm ci
```

Copy .env.example to .env.local and set:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Use the **publishable** key beginning with sb_publishable_. This app deliberately rejects secret keys and legacy JWT keys in that setting. No service-role key or database password is used by the web application. Public-prefixed values are bundled for the browser. Never place privileged credentials in them or commit .env.local.

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
    auth/callback/              PKCE code exchange or email/recovery token verification
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

The two typed schema contracts in src/lib/supabase/types.ts reflect the migration and intentionally restrict writable columns. Regenerate/review schema types after migration changes; keep application writes limited to allowed columns.

## Current feature status

| Area                                                   | Status                                                                      |
| ------------------------------------------------------ | --------------------------------------------------------------------------- |
| Responsive landing page and GitHub links               | Implemented; original product presentation preserved                        |
| Signup, confirmation, login, password reset, logout    | Implemented; requires configured Supabase Auth                              |
| Private dashboard and project CRUD                     | Implemented; requires applied migration                                     |
| Profiles                                               | Created automatically on auth user insertion, including before confirmation |
| PostgreSQL RLS and restricted grants                   | Migration and database authorization suite included                         |
| Automated validation and server-flow tests             | Implemented; service calls are mocked in web tests                          |
| Website scans, QA evidence, reports, release approvals | Planned                                                                     |
| Teams, billing, AI                                     | Not implemented                                                             |

Email delivery and persistence against a real Supabase project require the integration verification in the setup guide. A passing mocked test does not establish real email delivery or database isolation; the database suite and manual two-user checks cover those boundaries.

## Roadmap

1. Apply this migration to a development Supabase project and complete two-user authentication/persistence verification.
2. Add pagination and account/profile management as project volume grows.
3. Design release and evidence data contracts, then introduce a queue and isolated Playwright workers with SSRF protections.
4. Add QA reports, client review, and an auditable release approval lifecycle.

## Contributing

Read AGENTS.md. Work on a feature branch, keep changes focused, run lint, typecheck, tests, and build, and submit a PR. Run database tests when Docker/Supabase CLI are available. Report unexecuted checks explicitly. Keep feature claims and setup instructions accurate.

## License

Apache-2.0. See [LICENSE](LICENSE). The original license is preserved.

Build tooling note: dev and build select Next.js’s supported webpack bundler explicitly. Turbopack could not launch its CSS worker in this Windows environment; the webpack production build succeeds. This does not change the App Router or runtime architecture.
