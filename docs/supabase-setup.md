# Supabase setup and verification

## Hosted development project

1. Create a Supabase development project. Copy its project URL and **publishable** API key from Project Settings → API Keys to .env.local using the names in .env.example. Never use a secret or service-role key.
2. Set NEXT_PUBLIC_SITE_URL to the application origin. Use http://localhost:3000 locally and HTTPS in deployment. Rebuild after changing public environment variables.
3. In Supabase Authentication → URL Configuration, set Site URL to the same origin. Allow these exact redirect URLs for each environment:
   - http://localhost:3000/auth/callback
   - http://localhost:3000/auth/callback?next=/reset-password
     Replace the origin for your deployment. Do not use broad production wildcard allowlists.
4. Enable Email/password sign-in and email confirmations. Disable anonymous sign-in. Set the minimum password length to at least 12. Configure your own SMTP provider and appropriate Supabase Auth rate limits before opening registration beyond development; the application adds no email integration dependency.
5. Install Supabase CLI 2.122.0 following the official CLI installation instructions. Authenticate interactively with supabase login, then run:

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase db push --dry-run
supabase db push
```

Review the dry run before applying to your own development project. The web app does not run migrations. Do not reset a hosted database. Back up existing data before future schema changes.

## Email callbacks

The standard Supabase confirmation link and the configured emailRedirectTo/redirectTo values support the default SSR PKCE flow. Open the email link in the same browser that initiated signup or recovery: the code verifier is in that browser’s cookie storage. The callback exchanges the short-lived code for a session, sets cookies, and redirects to a fixed local destination. Expired or replayed codes return a generic invalid-link message.

For server-side token-hash templates (including confirmation on another browser), set these email template links in Supabase. These are template expressions, not real tokens:

**Confirm signup**

```html
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email"
  >Confirm your email</a
>
```

**Reset password**

```html
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery"
  >Reset your password</a
>
```

Use a separate Supabase project per environment when using SiteURL templates. Supabase verifies token hashes before creating a session. The app accepts only email and recovery token types and fixes the destination based on the verified type. It does not accept arbitrary redirect URLs. Do not log full callback URLs or store them in analytics. Configure any external proxy/CDN logs accordingly. Email link scanners may consume one-use links; request a fresh link if this occurs.

The reset page and update action both require a verified, non-anonymous session. Signed-in users can also reach it from My account → Change password. Successful updates request global sign-out and direct users to log in again. As with Supabase generally, existing short-lived access JWTs can remain valid until expiry; configure appropriate session lifetimes. Secure password change in Supabase may require a fresh reset link for old sessions.

## Local database and authorization tests

Install Docker and the supported Supabase CLI first. From the repository root:

```sh
supabase start
supabase db reset --local
npm run test:db
```

The reset command recreates **local development data only**. Use it only against a disposable local stack. supabase start prints local credentials: use only its publishable key, never its secret key, in .env.local. Auth email confirmations are enabled in supabase/config.toml. Open the local email inbox at http://localhost:54324 to follow signup/recovery links. App, Auth Site URL, redirect allowlist, and NEXT_PUBLIC_SITE_URL must all use the same hostname (localhost versus 127.0.0.1 matters for PKCE cookies).

For database-only testing, supabase db start followed by supabase test db is sufficient; CI uses this path. The test transaction creates two disposable auth records, uses real authenticated/anon roles and JWT claims, exercises allowed and denied operations, and rolls back. It tests profile triggers, RLS activation, profile visibility/update, ownership derivation, forbidden ownership transfer, cross-user read/update/delete isolation, authenticated CRUD, constraints, and anonymous access denial. It does not need a service key.

```sh
supabase stop --no-backup
```

Stop only your local development stack when finished.

## Schema and permissions

- profiles: user UUID referencing auth.users, optional full name, creation/update timestamps. A security-definer trigger with an empty search_path creates profiles at auth.users insertion, before email confirmation. Metadata is type checked and length bounded. Existing users are backfilled.
- projects: generated UUID, owner defaulting to auth.uid(), constrained name/HTTP(S) URL/description, timestamps, and an owner/creation index.
- Both tables enable RLS. Signed-in non-anonymous users can read/update their own profile and create/read/update/delete their own projects.
- Anonymous API roles have no table grants. Authenticated users receive only profile full_name updates and project name/URL/description inserts and updates; no owner, ID, or timestamp writes. Profile insert/delete are not granted. Policies also enforce ownership in USING/WITH CHECK.
- Server data operations verify authentication and never accept ownership from form data. No request is made to a submitted website. Local/private website addresses are permitted as metadata; any future scanner must implement its own SSRF defenses.

The application uses one owner per project. Organizations, memberships, and shared projects are outside this milestone.

## Verification checklist

Run automated web checks:

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

Web tests mock Supabase at the integration boundary; they exercise the actual validators, actions, session guard, callback, and proxy. They do not claim to test real email delivery or PostgreSQL. Run the pgTAP suite above for actual database authorization.

Then verify against a configured development project:

1. Open /dashboard in a private window: expect a sign-in redirect with no project data.
2. Sign up with a unique email. Confirm that the profile exists before confirmation but dashboard access requires a session. Follow the email and confirm the dashboard opens. Repeat with an expired/reused link and verify an error.
3. Create a project, reload, sign out, and sign back in. Confirm the saved project remains. Edit it, then cancel a deletion and finally confirm deletion.
4. Try an invalid URL and a URL with embedded credentials: expect validation errors. Save a valid URL: no scan, network request, or QA score should appear.
5. Use a separate browser/profile for user B. Confirm B cannot see user A’s projects. Paste A’s edit/delete URL while signed in as B: expect not found. Run the SQL suite to verify direct database operations too.
6. Request a reset email and follow it in the same browser for PKCE (or use the token-hash template). Set a new password, confirm the old password no longer works, and sign in with the new password. Expired links must not update anything.
7. Delete/expire the browser’s auth session and try project actions. Expect sign-in rather than an unauthorized write.
8. Review desktop and narrow mobile layouts, keyboard focus, form errors, the account menu, and loading/error states.

Missing configuration should produce an explicit setup notice; service errors must not display secrets, tokens, SQL details, or invented success.

## Official references

- [SSR clients and proxy](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs)
- [Password authentication](https://supabase.com/docs/guides/auth/passwords)
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Database testing in CI](https://supabase.com/docs/guides/deployment/ci/testing)
