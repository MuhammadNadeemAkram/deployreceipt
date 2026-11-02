begin;
-- Qualify the outer Storage name: an unqualified name inside the EXISTS subquery
-- can resolve to projects.name, incorrectly hiding artifacts from their owner.
drop policy scan_artifact_owner_read on storage.objects;
create policy scan_artifact_owner_read on storage.objects for select to authenticated using (
  bucket_id='scan-artifacts' and exists (
    select 1 from public.scan_runs r join public.projects p on p.id=r.project_id
    where r.id::text=(storage.foldername(storage.objects.name))[1]
      and p.owner_id=(select auth.uid())
      and r.created_at>now()-make_interval(days=>(select retention_days from public.scan_settings))
  )
);
commit;
