begin;
create table public.beta_settings(singleton boolean primary key default true check(singleton),environment text not null default 'staging' check(environment in ('local','staging','production')),enforced boolean not null default true,scanning_enabled boolean not null default false,check(enforced or environment='local'));
insert into public.beta_settings default values;
create table public.beta_access(email text primary key check(email=lower(btrim(email)) and length(email)<=254),active boolean not null default true,created_at timestamptz not null default now());
create table public.beta_usage(user_id uuid not null references auth.users(id) on delete cascade,action text not null,window_start timestamptz not null,used integer not null check(used>0),primary key(user_id,action,window_start));
create table public.worker_heartbeats(instance_id uuid primary key,last_seen_at timestamptz not null,ready boolean not null,error_code text check(error_code in ('database_unavailable','worker_failure')),last_success_at timestamptz);
-- Operator-only configuration and telemetry. No web service key is needed.
alter table public.beta_settings enable row level security;
alter table public.beta_access enable row level security;
alter table public.beta_usage enable row level security;
alter table public.worker_heartbeats enable row level security;
revoke all on public.beta_settings,public.beta_access,public.beta_usage,public.worker_heartbeats from public,anon,authenticated;
grant all on public.beta_settings,public.beta_access,public.beta_usage,public.worker_heartbeats to service_role;
create function public.beta_has_access() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and not coalesce((auth.jwt()->>'is_anonymous')::boolean,false) and (
 exists(select 1 from public.beta_settings where not enforced and environment='local') or exists(
 select 1 from auth.users u join public.beta_access a on a.email=lower(u.email) and a.active join auth.sessions s on s.user_id=u.id
 where u.id=auth.uid() and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
 and s.id::text=auth.jwt()->>'session_id' and (s.not_after is null or s.not_after>clock_timestamp())));
$$;
create function public.beta_access_status() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('allowed',public.beta_has_access(),'enforced',enforced,'environment',environment,'scanning_enabled',scanning_enabled) from public.beta_settings;
$$;
create function public.before_user_created(event jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if (select enforced from public.beta_settings) and not exists(select 1 from public.beta_access where email=lower(event->'user'->>'email') and active) then
 return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Private beta onboarding requires operator approval.'));
 end if;
 return '{}'::jsonb;
end;$$;
revoke all on function public.before_user_created(jsonb) from public,anon,authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.before_user_created(jsonb) to supabase_auth_admin;
create function public.beta_guard_write() returns trigger language plpgsql security definer set search_path='' as $$
declare action text; maximum integer; start_at timestamptz; used_now integer;
begin
 if auth.role()<>'authenticated' or auth.uid() is null then if tg_op='DELETE' then return old; else return new; end if; end if;
 if not public.beta_has_access() then raise exception 'beta_access_required' using errcode='42501'; end if;
 if not (select enforced from public.beta_settings) then if tg_op='DELETE' then return old; else return new; end if; end if;
 if tg_op in ('INSERT','UPDATE') and tg_table_name in ('scan_runs','domain_verifications') and not (select scanning_enabled from public.beta_settings) then raise exception 'scanning_disabled'; end if;
 if tg_op='INSERT' and tg_table_name='review_invitations' and not exists(select 1 from public.beta_access where email=new.invited_email and active) then raise exception 'reviewer_not_admitted'; end if;
 if tg_op='INSERT' and tg_table_name='projects' then
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,66));
  if (select count(*) from public.projects where owner_id=auth.uid())>=50 then raise exception 'project_limit'; end if;
 end if;
 action:=tg_table_name||':'||tg_op;
 maximum:=case when tg_table_name='projects' then 10 when tg_table_name='qa_reports' then 100 when tg_table_name in ('release_reviews','review_invitations') then 20 when tg_table_name in ('qa_comments','review_comments') then 40 when tg_table_name='qa_finding_triage' then 100 else null end;
 if maximum is not null and tg_op in ('INSERT','UPDATE') then
  delete from public.beta_usage where user_id=auth.uid() and window_start<now()-interval '2 days';
  start_at:=date_trunc(case when tg_table_name in ('qa_comments','review_comments','qa_finding_triage') then 'minute' when tg_table_name='projects' then 'hour' else 'day' end,clock_timestamp());
  insert into public.beta_usage(user_id,action,window_start,used) values(auth.uid(),action,start_at,1)
  on conflict on constraint beta_usage_pkey do update set used=beta_usage.used+1 where beta_usage.used<maximum returning used into used_now;
  if not found then raise exception 'beta_rate_limited'; end if;
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end;$$;
-- Restrictive policies add beta admission without replacing tenant/owner policies.
do $$declare table_name text;begin
 foreach table_name in array array['profiles','projects','scan_settings','domain_verifications','scan_runs','scan_checks','qa_reports','qa_finding_triage','qa_comments','qa_finding_evidence','qa_export_leases','release_reviews','review_invitations','release_review_evidence','review_comments','review_decisions','review_events'] loop
 execute format('create policy beta_admission on public.%I as restrictive for all to authenticated using ((select public.beta_has_access())) with check ((select public.beta_has_access()))',table_name);
 execute format('create trigger beta_guard before insert or update or delete on public.%I for each row execute function public.beta_guard_write()',table_name);
 end loop;
end;$$;
create policy beta_storage_admission on storage.objects as restrictive for all to authenticated using((select public.beta_has_access())) with check((select public.beta_has_access()));
create function public.beta_readiness(p_environment text,p_scanning boolean) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.beta_settings where environment=p_environment and enforced and scanning_enabled=p_scanning)
 and exists(select 1 from storage.buckets where id='scan-artifacts' and not public and file_size_limit<=2097152)
 and exists(select 1 from pg_extension where extname='pgmq')
 and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity)
 and exists(select 1 from public.scan_settings where mode=case when p_scanning then 'local' else 'disabled' end);
$$;
create function public.worker_tick(p_instance uuid,p_ready boolean,p_error text default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_error is not null and p_error not in ('database_unavailable','worker_failure') then raise exception 'invalid_error_code'; end if;
 insert into public.worker_heartbeats(instance_id,last_seen_at,ready,error_code,last_success_at) values(p_instance,clock_timestamp(),p_ready,p_error,case when p_ready then clock_timestamp() else null end)
 on conflict(instance_id) do update set last_seen_at=excluded.last_seen_at,ready=excluded.ready,error_code=excluded.error_code,last_success_at=coalesce(excluded.last_success_at,worker_heartbeats.last_success_at);
 delete from public.worker_heartbeats where last_seen_at<now()-interval '7 days';
 delete from public.beta_usage where window_start<now()-interval '2 days';
 return jsonb_build_object('scanning_enabled',(select scanning_enabled from public.beta_settings));
end;$$;
create function public.operational_status() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('queued',(select count(*) from public.scan_runs where status='queued'),'running',(select count(*) from public.scan_runs where status='running'),'stale_leases',(select count(*) from public.scan_runs where status='running' and lease_until<now()),'failed_24h',(select count(*) from public.scan_runs where status in ('failed','timed_out') and created_at>now()-interval '1 day'),'healthy_workers',(select count(*) from public.worker_heartbeats where ready and last_seen_at>now()-interval '45 seconds'));
$$;
revoke all on function public.beta_has_access(),public.beta_access_status(),public.beta_guard_write(),public.beta_readiness(text,boolean),public.worker_tick(uuid,boolean,text),public.operational_status() from public,anon,authenticated;
grant execute on function public.beta_has_access(),public.beta_access_status() to authenticated;
grant execute on function public.beta_readiness(text,boolean) to anon,authenticated;
grant execute on function public.worker_tick(uuid,boolean,text),public.operational_status() to service_role;
update storage.buckets set file_size_limit=2097152 where id='scan-artifacts';
-- Bound authenticated transactions, including calls through security-definer RPCs.
alter role authenticated set statement_timeout='10s';
alter role authenticated set lock_timeout='3s';
create index beta_usage_user_window on public.beta_usage(user_id,window_start);
create index beta_usage_window on public.beta_usage(window_start);
create index scan_runs_status_created on public.scan_runs(status,created_at);
create index review_invitations_review_created on public.review_invitations(review_id,created_at desc);
create index release_review_evidence_path on public.release_review_evidence(path);
create index review_decisions_reviewer on public.review_decisions(reviewer_id);
-- Gate leasing in the database too, including older worker binaries during rollback.
alter function public.lease_scan_job() rename to beta_internal_lease_scan_job;
revoke all on function public.beta_internal_lease_scan_job() from public,anon,authenticated,service_role;
create function public.lease_scan_job() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.beta_settings where enforced and not scanning_enabled) then return null; end if;
 return public.beta_internal_lease_scan_job();
end;$$;
revoke all on function public.lease_scan_job() from public,anon,authenticated;
grant execute on function public.lease_scan_job() to service_role;
notify pgrst,'reload config';
commit;
