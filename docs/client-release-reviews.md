# Client release reviews

Task 05 adds private, authenticated review of one immutable QA report version. Public scanning, anonymous sharing, legal signatures, billing, AI and deployment automation remain unavailable.

## Setup and architecture

Apply `20261103000100_release_reviews.sql` and `20261103000200_review_evidence_scope.sql` after the Task 04 migrations, using the existing development Supabase migration workflow. No additional environment variables, credentials, notification provider or runtime dependencies are required. Never reset a hosted database. Deploy the web application after the migration.

- `src/features/releases`: typed snapshots, server queries/actions, validation, owner/reviewer forms and shared presentation.
- `/dashboard/releases`: owner list/filter, creation, invitations, feedback, revisions and audit history.
- `/reviews`: current invitations for the signed-in verified email. `/reviews/[id]` is the simpler client portal.
- `/review-invitations/[id]`: public instructions only; no review content or automatic acceptance.
- `/api/reviews/[id]/evidence/[checkId]`: authenticated private bytes, without a signed redirect.

The existing report and scan authorization policies remain owner-only. Reviewers receive access to release snapshots and specifically referenced screenshots, not the original reports, projects, scan history, developer workspace, or other files.

## Snapshot and schema

The database constructs the snapshot from a completed, consistent persisted QA report and its actual checks, triage, developer notes/comments, original target and recorded execution/authorization context. Failed or incomplete diagnostic reports cannot be submitted for release approval. A QA report may still contain failed checks and warnings; those are displayed prominently and must be explicitly acknowledged for approval.

Snapshot content includes the review ID, version, release name/notes, project/report/scan identity and copied report content. Its digest is SHA-256 over UTF-8 PostgreSQL canonical `jsonb::text`, not JavaScript JSON serialization. Draft snapshots are immutable too: revoke and create a revised version to change content. Later report edits never affect an existing review. Snapshot creation takes the report lock also used by triage/comment mutations. No screenshot binaries, signed URLs, auth tokens or worker secrets are copied.

New tables:

- `release_reviews`: immutable snapshot/digest, exact source IDs, owner, lineage/version, lifecycle and access deadline.
- `review_invitations`: one active primary invitation, matching email, accepted user, expiry/revocation and preserved older invitation rows.
- `release_review_evidence`: exact original artifact paths/check IDs and the retention deadline captured at creation.
- `review_comments`: append-only text, authenticated author/role/time, optional snapshot finding/reply, feedback type and current resolution marker.
- `review_decisions`: one append-only decision per version, reviewer, digest, acknowledgements, notes and timestamp.
- `review_events`: append-only owner-visible activity history and sanitized IDs/version metadata. Resolution changes are events; comment content is never silently rewritten.

Every table has RLS and SELECT-only grants for ordinary authenticated users. Narrow security-definer RPCs use an empty search path, derive identity from `auth.uid()`, and independently check ownership/current verified email. No client can directly insert or update ownership, snapshots, authors, state, decisions or events.

## Invitations and manual delivery

1. Owner selects an eligible report, release name, optional notes and one reviewer email.
2. Create draft, inspect the frozen content, then submit separately.
3. Copy the invitation URL and send it manually. DeployReceipt does **not** send or claim to send a notification email.
4. Reviewer signs in with that verified email. New users use the existing signup and email-confirmation flow. After authentication, reopen the link or select Client reviews in the workspace; authentication redirects remain fixed internal destinations.
5. Accept explicitly. URLs identify invitations but never act as access tokens.

The database reads the current Auth user record, requires `email_confirmed_at`, rejects anonymous users, and matches normalized email and accepted user ID. It does not trust user-editable metadata or stale JWT email claims. Changing an accepted reviewer's email removes access. Another account cannot inherit an accepted invitation merely by matching its email.

Revocation removes accepted access immediately for subsequent requests. Expired pending reviews can be explicitly reissued, rotating the invitation ID while retaining the old expired row and auditing the action. Revoked invitations cannot be silently revived. Completed reviews require a new version rather than reissuing a decision.

## State machine and decisions

- `draft -> pending_review`: owner submission before expiry.
- `pending_review -> approved | changes_requested`: accepted matching reviewer, before expiry, exactly once.
- `draft | pending_review -> expired`: deadline reached; read/operation checks enforce the deadline immediately. A scoped RPC materializes expiry/audit events on subsequent visits; no background scheduler is claimed.
- `expired -> draft | pending_review`: explicit owner reissue, depending on whether it was previously submitted; no completed decision can be reissued.
- `draft | pending_review | approved | changes_requested -> revoked`: explicit owner revocation. The original decision remains intact.
- A terminal review may create one linear successor from an eligible report in the same project. Version numbers increase; decisions are never copied. Branches from a stale predecessor are rejected.

Review, invitation and decision transitions serialize on the review row. Concurrent approvals have one winner. The decision must supply the exact version and digest. Approval requires acknowledgements of the scope, failed checks/warnings and available/missing/expired evidence. Request Changes requires feedback. Approval means acceptance of that release version, not a clean test suite, security certification, qualified electronic signature or deployment.

## Evidence and deletion

Review windows are three days from draft creation or explicit reissue, shorter than the default seven-day screenshot policy. Old scans may have less evidence time left, or no remaining screenshots. The portal shows the evidence deadline independently. The effective deadline is the earlier of the snapshot's captured deadline and the current scan retention deadline; changing retention cannot extend an old review's evidence authorization. Reissue does not extend artifact retention.

Review evidence is streamed using the authenticated user's Storage access. Authorization is checked for the exact review/check again after download (another active review of the same image cannot satisfy this check); responses are private/no-store, bounded to 2 MiB, and do not redirect to reusable signed URLs. Missing files, shortened retention, revoked access and expired screenshots produce an explicit unavailable notice. Already downloaded bytes cannot be revoked or erased from a browser/device.

Explicit project deletion cascades reviews, invitations, feedback, decisions and audit events, and denies subsequent review/evidence access. This is an application audit trail, not a legally retained archive. Ordinary users cannot edit/delete audit records directly. Account erasure with historical author/decision foreign keys requires a separately designed data-retention policy; there is no account-deletion feature in this milestone.

## Validation and security review

Run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:browser`, `npm run build`. With Docker/Supabase CLI, run `supabase db start` and `npm run test:db` for real RLS tests.

CI's controlled report workflow also runs `tests/integration/release-workflow.mjs` against disposable local Supabase and the isolated fixture scanner. It uses separate verified developer/reviewer accounts and a third outsider. Browser forms exercise draft/submission/acceptance/feedback/revision/approval; database calls test simultaneous decisions and replay. The seven-day `controlled-report-e2e` artifact includes `e2e-release-proof.json`, owner/client desktop/mobile screenshots, and the existing scan/report evidence. Defining this test is not proof it passed: inspect the run for the specific PR revision.

Checks cover version/digest forgery, immutability, identity mismatch/unverified email, before-acceptance isolation, direct writes, cross-project access, author impersonation, comment bounds and HTML as literal React text, invitation expiry/reissue/revocation, replay, concurrent decisions, missing/expired artifacts, audit history and project deletion. Server Actions retain Next.js origin/CSRF protections; invitation GET requests never mutate data. Redirect destinations are fixed routes and UUIDs, not submitted URLs.

Known limits: one primary reviewer, latest 50 reviews/invitations (100 eligible report choices), 100 comments/review, 2,000 characters/comment or decision, 4,000 release-note characters, 512 KiB snapshot, no notification email, no realtime updates, no public sharing or reviewer PDF export. Original owner-only PDF export remains unchanged. A hosted deployment, real confirmation-email delivery and deployment-specific operational behavior require separate development-environment verification. Existing lint-toolchain audit advisories remain documented in README.
