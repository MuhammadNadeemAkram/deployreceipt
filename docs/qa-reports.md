# QA reports and evidence

## Supported behavior

A project owner can create one report per terminal scan from the scan detail page. Completed scans produce QA reports; failed/timed-out scans produce explicitly labeled diagnostic reports with incomplete coverage. Queued/running scans cannot produce a report. Completed scans with missing checks or inconsistent counts are rejected rather than repaired with invented data.

The report retains the project name at report creation and the target URL from the original scan, not the project's subsequently edited URL. Automated checks remain in scan_checks and their outcomes are never rewritten by manual triage.

Public website scanning remains disabled. There are no anonymous report links, approvals, billing, AI findings, or certification claims.

## Schema and migration

Apply 20261102000300_qa_reports.sql through the existing Supabase workflow:

```sh
supabase db push --dry-run
supabase db push
```

Review the dry run and use a development project first. Do not reset a hosted database.

New tables:

- qa_reports: immutable report identity, original scan reference, project/name/target snapshot, QA/diagnostic kind and creator.
- qa_finding_triage: manually assigned severity, resolution, notes, revision and author/time, separate from immutable observations.
- qa_comments: append-only developer comments, with authenticated author derived in SQL.
- qa_finding_evidence: references to existing screenshot checks from the same report/scan. Composite foreign keys prevent cross-scan attachment.
- qa_export_leases: private per-user export leases and cooldown state.

Every table has RLS. Clients receive SELECT only on owner-visible report/triage/comment/evidence tables. Mutations go through authenticated, owner-checked security-definer functions with an empty search_path. Export lease rows are not client-readable. Anonymous users cannot read or mutate report data.

Project deletion cascades through scans to reports, triage, comments, evidence links and export leases. New report/PDF requests after deletion fail authorization or return not found. Previously downloaded files cannot be revoked; existing short-lived screenshot links may remain valid until their existing 60-second expiry.

## Historical data and provenance

New scan requests capture authorization metadata without copying challenge tokens. The updated worker records the exact leased configuration it uses through a worker-only, current-lease-checked RPC before launching the browser. Deploy the migration before the updated worker.

Old scans are not backfilled with current settings. If execution configuration or historical authorization evidence was never recorded, the report/PDF says so. It does not claim that an old target has just been verified.

Displayed lifecycle duration is started_at to completed_at and may include retry waits. Per-check durations are the original observations, not a performance score. A terminal report with zero persisted checks remains a diagnostic with no passed checks.

## Human review

Owners can assign critical/high/medium/low or leave severity untriaged, and choose open/investigating/resolved/ignored. These are human decisions, not automated vulnerability classifications. Notes are plain text up to 2,000 characters. Each save carries a revision; stale saves require refresh rather than silently overwriting another session.

Developer comments are append-only, up to 2,000 characters each and 30 per report. They cannot specify an arbitrary author.

Findings can reference at most two existing screenshots from their own scan. New attachments require an existing artifact within the current retention window. Existing expired links may remain as historical metadata, but they do not restore access or extend retention. Missing/expired/unavailable evidence is labeled, never replaced with a sample.

The review guidance is curated explanatory text tied to the check type. It is separate from actual observations and does not generate additional findings.

## Report and PDF architecture

- src/features/reports/model.ts builds a consistency-checked report from actual records.
- queries.ts enforces server authentication, explicit project ownership, and RLS-backed reads.
- actions.ts validates inputs and calls scoped SQL mutations.
- /dashboard/reports lists the latest 50 owner-visible reports; summary metrics describe that displayed set.
- /dashboard/reports/[id] shows all context, filters, findings, triage, comments and available evidence.
- /api/reports/[id] returns structured private report data, with no signed URLs embedded.
- POST /api/reports/[id]/pdf rechecks ownership, validates Origin against NEXT_PUBLIC_SITE_URL, claims an export lease, loads private evidence with the user's Storage authorization, renders, then checks report access again before returning bytes.

PDF export always includes all findings, independently of the current UI filters. It draws text and embeds PNG bytes directly with pdf-lib. There is no HTML renderer, browser, remote image loader or URL-based evidence fetch. Malicious HTML is literal text, not markup. No signed URL is placed into the PDF as a permanent evidence link.

The renderer runs in a separate Node worker thread using a checked-in, openly licensed Noto Sans font. No privileged API key or authentication cookie is passed into that thread. The only file read by the renderer is the fixed font asset. Original target URLs and developer text are drawn as text, without executable PDF actions or external-resource annotations.

## Resource bounds

- At most two rendering threads per Node process.
- A per-user 45-second export lease, plus a 30-second export cooldown enforced in PostgreSQL.
- A 12-second renderer wall-clock deadline and 128 MiB worker old-generation heap limit.
- At most two images, 2 MiB each; authorized Storage downloads have an 8-second abort deadline.
- PNG signatures, dimensions, channel/depth/interlace and bounded decompression are validated. Nonessential PNG chunks are discarded; arbitrary HTML/SVG or URL resources are rejected.
- At most 30 PDF pages, 8 MiB output and 512 KiB text-model input.
- Technical details are abridged after 2,000 characters per finding in PDF, with an explicit notice. The full observation remains in the private web report.
- Notes/comments are not silently truncated; oversized exports fail with a clear message.
- Responses are private/no-store, attachments have a UUID-based filename, and PDF output is not persisted server-side.

PDF generation requires the Node runtime, worker_threads and the traced server/font/package assets. Edge-only runtimes are unsupported. next.config.ts includes required assets for output tracing; verify these files when packaging a custom deployment.

The original scan artifact retention remains authoritative. PDF export embeds only evidence accessible at export time. A downloaded PDF is an owner-controlled copy and cannot subsequently be expired by the application.

Noto Sans covers common Latin/Greek/Cyrillic text. Unsupported glyphs use a visible fallback with a notice; full text remains available in the web report. Add reviewed font coverage before claiming support for every script.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm run test:browser
npm run build
supabase db start
npm run test:db
```

Tests cover record-derived reports, immutable outcomes, human triage validation/revisions, comments, composite evidence integrity, owner/cross-user access, export origin checks, lease cleanup, deletion races, real PDF rendering, private PNG embedding, missing/expired evidence, diagnostics, malicious HTML, PNG/resource bounds, and project-deletion cascades.

Browser layout tests use the actual report and workspace components with explicitly labeled controlled test records. They generate desktop/mobile previews and exercise server-rendered finding filters. Those previews are not evidence of authenticated live Supabase behavior.

The reports-end-to-end CI job exercises the complete disposable local Supabase, isolated browser worker, Storage, report and PDF path. It creates real temporary accounts, retains a non-secret proof JSON plus interface screenshots/PDF as a seven-day CI artifact, and removes its test accounts. Inspect the job result and proof for each revision; defining the job is not proof that it passed. Production deployment verification remains separate. Component/SQL/layout tests must not be described as a substitute for this integrated path.

## Manual checks with a development project

1. Apply migrations, configure the existing application and updated worker, and keep public scanning disabled.
2. Complete a controlled-fixture scan, then create/open its report.
3. Verify the project/target, scan identifier/dates, recorded configuration, actual checks/counts and screenshots against the persisted scan.
4. Set severity/status/notes on a failed finding, add a comment and attach a screenshot. Confirm the original failure and automated counts do not change.
5. Open two sessions and save the same finding: the stale revision should be rejected.
6. Export PDF. Verify branding, scope, incomplete-coverage notices where applicable, findings, human notes, private evidence and generation timestamp.
7. Remove/expire a screenshot and confirm the report/export labels it unavailable rather than reconstructing it. Attaching a new expired image must fail.
8. Sign in as another user and attempt the report, JSON endpoint and PDF export: no report/evidence should be exposed.
9. Delete the original project and verify subsequent report/export requests fail and metadata/comments/evidence links cascade.
10. Review desktop/mobile layout, keyboard focus, field labels, filter controls and error/pending feedback.

No production migration or credentials are supplied by this change.
