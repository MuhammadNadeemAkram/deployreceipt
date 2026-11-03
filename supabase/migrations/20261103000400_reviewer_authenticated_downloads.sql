begin;
-- SELECT is also used for signing/listing; reviewers must only authenticate each download.
-- https://github.com/supabase/storage/blob/master/src/http/routes/operations.ts
-- storage.operation() is set by the trusted Storage API, not a submitted application field.
drop policy invited_review_artifact_read on storage.objects;
create policy invited_review_artifact_read on storage.objects for select to authenticated using (
 bucket_id='scan-artifacts'
 and storage.operation()='storage.object.get_authenticated'
 and public.can_read_review_evidence(storage.objects.name)
);
commit;
