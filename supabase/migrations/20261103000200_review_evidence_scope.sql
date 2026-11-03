begin;
-- Shared bytes may be authorized by another review. An endpoint must check its exact review too.
create function public.can_read_release_artifact(p_review uuid,p_check uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.release_review_evidence e join public.release_reviews r on r.id=e.review_id join public.scan_runs s on s.id=r.scan_run_id
 where e.review_id=p_review and e.check_id=p_check and e.expires_at>now()
 and s.created_at>now()-make_interval(days=>(select retention_days from public.scan_settings))
 and public.can_read_release_review(r.id));
$$;
revoke all on function public.can_read_release_artifact(uuid,uuid) from public,anon,authenticated;
grant execute on function public.can_read_release_artifact(uuid,uuid) to authenticated;
alter table public.release_reviews add constraint release_report_scan_fk foreign key(report_id,scan_run_id) references public.qa_reports(id,scan_run_id) on delete cascade;
alter table public.release_reviews add constraint release_scan_project_fk foreign key(scan_run_id,project_id) references public.scan_runs(id,project_id) on delete cascade;
alter table public.release_reviews add constraint release_version_digest_unique unique(id,version,snapshot_digest);
alter table public.review_decisions add constraint decision_exact_version_fk foreign key(review_id,version,snapshot_digest) references public.release_reviews(id,version,snapshot_digest) on delete cascade;
commit;
