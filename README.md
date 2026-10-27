# DeployReceipt

An open-source quality assurance and release approval platform for web developers and agencies.

Run automated website checks, capture test evidence, track issues, and share release reports with clients for review and approval.

**Status:** early development. The description above is the product direction; only the public landing page and coming-soon page are implemented.

## Setup

Use Node.js 24 LTS (24.15.0 or newer) (see .nvmrc) and npm 12.2.1.

```sh
npm install --global npm@12.2.1
npm ci
npm run dev
```

Open http://localhost:3000. No credentials or environment variables are required. For future integrations, copy .env.example to .env.local and supply your own values when those features are implemented. Never commit secrets.

```sh
npm run lint
npm run typecheck
npm run build
npm start
```

Type checking generates Next.js route types first, so it also works on a clean checkout. The production server requires a successful build. CI runs the same checks on pull requests and main.

## Stack and compatibility

- Next.js 16.4.3 App Router, React / React DOM 19.3.1
- TypeScript 6.0.3 with strict checking
- Tailwind CSS 4.3.3, its PostCSS adapter, and PostCSS
- ESLint 9.39.5 (upstream deprecated, required by the current React lint peer range) with matching eslint-config-next 16.4.3
- npm 12.2.1; exact package versions and committed lockfile

Versions were checked against the npm registry during initialization. TypeScript 7 and ESLint 10 are newer, but are outside the supported peer ranges of the TypeScript parser and React lint plugin used by the Next.js configuration. This project selects the newest stable versions within those supported ranges. Node typings follow the Node 24 runtime.

No authentication, database, payment, AI, or browser automation dependencies are installed.

## Architecture

```text
.github/workflows/ci.yml             Pull request validation
src/
  app/                              Routes, metadata, global styles
    get-started/page.tsx             Explicit coming-soon page
    layout.tsx                      Shared shell
    page.tsx                        Public landing page
  components/layout/                Shared header and footer
  features/marketing/components/    Marketing workflow and illustration
  lib/site.ts                       Shared product metadata and links
AGENTS.md                           Repository conventions
.env.example                        Credential-free future configuration
```

Pages and components render on the server by default. The marketing feature owns its presentation; shared layout and configuration are separate. There are no speculative service layers or empty modules.

Future authenticated features should live under src/features with thin App Router pages. Add server-only Supabase clients and PostgreSQL access when implementing authentication and tenancy. Enforce authorization at the data boundary. Run future Playwright jobs in a separate worker process with explicit job contracts; do not run browser jobs during web requests. These are architecture directions, not existing services.

## Current feature status

| Area                                                                | Status                                     |
| ------------------------------------------------------------------- | ------------------------------------------ |
| Responsive landing page, navigation, GitHub links                   | Implemented                                |
| Get Started destination                                             | Implemented coming-soon page               |
| Workflow illustration                                               | Static, clearly labeled planned experience |
| Semantic landmarks, skip link, focus styles, reduced-motion support | Implemented                                |
| Lint, strict types, build, CI configuration                         | Implemented                                |
| Authentication, teams, tenant authorization                         | Planned                                    |
| PostgreSQL persistence, evidence storage                            | Planned                                    |
| Automated checks and Playwright workers                             | Planned                                    |
| Reports and client release approvals                                | Planned                                    |
| Billing and AI integrations                                         | Not implemented                            |

No testimonials, customer counts, live checks, or completed approval records are claimed.

## Roadmap

1. Define the organization, membership, project, release, evidence, and approval data model and authorization rules.
2. Implement Supabase authentication and organization membership with server-side access controls and meaningful integration tests.
3. Add project and release management with PostgreSQL migrations.
4. Introduce a job queue and isolated Playwright workers with explicit failure handling.
5. Add evidence storage, reports, client review, and an auditable approval lifecycle.

## Contributing

Read AGENTS.md. Use a feature branch, keep changes focused, run all three validation scripts, and submit a pull request. Keep documentation and feature status accurate. Add dependencies only when justified by implemented behavior.

## License

Apache-2.0. See [LICENSE](LICENSE). The original license is preserved.
