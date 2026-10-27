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
