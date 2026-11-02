begin;
create extension if not exists pgmq;
create extension if not exists pgcrypto with schema extensions;
select pgmq.create('scan_jobs');

create table public.scan_settings (
  singleton boolean primary key default true check(singleton),
  mode text not null default 'disabled' check(mode in ('disabled','local')),
  daily_allowance integer not null default 10 check(daily_allowance between 1 and 100),
  cooldown_seconds integer not null default 60 check(cooldown_seconds between 30 and 3600),
  timeout_seconds integer not null default 90 check(timeout_seconds between 10 and 90),
  max_attempts integer not null default 3 check(max_attempts between 1 and 3),
  max_links integer not null default 5 check(max_links between 0 and 5),
  max_requests integer not null default 100 check(max_requests between 10 and 200),
  screenshot_bytes integer not null default 2097152 check(screenshot_bytes between 65536 and 5242880),
  retention_days integer not null default 7 check(retention_days between 1 and 30)
);
insert into public.scan_settings default values;
alter table public.scan_settings enable row level security;
revoke all on public.scan_settings from public,anon,authenticated;
grant select on public.scan_settings to authenticated;
create policy scan_settings_read on public.scan_settings for select to authenticated using (auth.uid() is not null);
grant all on public.scan_settings to service_role;

create table public.domain_verifications (
  project_id uuid primary key references public.projects(id) on delete cascade,
  domain text not null check(char_length(domain) between 1 and 253),
  token text not null default encode(extensions.gen_random_bytes(32),'hex'),
  status text not null default 'pending' check(status in ('pending','verified','failed')),
  method text not null default 'dns' check(method in ('dns','local_fixture')),
  created_at timestamptz not null default now(),
  last_queued_at timestamptz not null default now(),
  checked_at timestamptz,
  verified_at timestamptz,
  expires_at timestamptz,
  attempts integer not null default 0,
  lease_token uuid,
  lease_until timestamptz
);
create table public.scan_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  target_url text not null,
  status text not null default 'queued' check(status in ('queued','running','completed','failed','timed_out')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  passed_count integer not null default 0 check(passed_count >= 0),
  failed_count integer not null default 0 check(failed_count >= 0),
  warning_count integer not null default 0 check(warning_count >= 0),
  error_code text,
  error_message text,
  attempts integer not null default 0,
  lease_token uuid,
  lease_until timestamptz,
  check ((status in ('queued','running') and completed_at is null) or (status in ('completed','failed','timed_out') and completed_at is not null))
);
create unique index scan_one_active_project on public.scan_runs(project_id) where status in ('queued','running');
create index scan_project_history on public.scan_runs(project_id,created_at desc);
create index scan_user_allowance on public.scan_runs(requested_by,created_at desc);
create table public.scan_checks (
  id uuid primary key default gen_random_uuid(),
  scan_run_id uuid not null references public.scan_runs(id) on delete cascade,
  check_type text not null check(check_type in ('availability','desktop','mobile','javascript','links','network')),
  outcome text not null check(outcome in ('pass','fail','warning')),
  description text not null check(char_length(description) between 1 and 500),
  details jsonb not null default '{}' check(octet_length(details::text)<=32768),
  duration_ms integer check(duration_ms between 0 and 120000),
  screenshot_path text check(screenshot_path is null or char_length(screenshot_path)<200),
  unique(scan_run_id,check_type)
);
create index scan_checks_run on public.scan_checks(scan_run_id);
alter table public.domain_verifications enable row level security;
alter table public.scan_runs enable row level security;
alter table public.scan_checks enable row level security;
revoke all on public.domain_verifications,public.scan_runs,public.scan_checks from public,anon,authenticated;
grant select on public.domain_verifications,public.scan_runs,public.scan_checks to authenticated;
grant all on public.domain_verifications,public.scan_runs,public.scan_checks to service_role;
create policy verification_owner_read on public.domain_verifications for select to authenticated using (
  exists(select 1 from public.projects p where p.id=project_id and p.owner_id=(select auth.uid())));
create policy scan_owner_read on public.scan_runs for select to authenticated using (
  exists(select 1 from public.projects p where p.id=project_id and p.owner_id=(select auth.uid())));
create policy check_owner_read on public.scan_checks for select to authenticated using (
  exists(select 1 from public.scan_runs r join public.projects p on p.id=r.project_id where r.id=scan_run_id and p.owner_id=(select auth.uid())));

create function public.scan_domain(value text) returns text
language sql immutable set search_path='' as $$
  select lower(substring(value from '^https?://([a-zA-Z0-9.-]+)(:[0-9]+)?([/?#]|$)'));
$$;
create function public.invalidate_scan_verification() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.website_url is distinct from new.website_url then
    delete from public.domain_verifications where project_id=new.id;
    update public.scan_runs set status='failed',completed_at=now(),lease_token=null,lease_until=null,
      error_code='project_changed',error_message='The project URL changed during this scan.'
      where project_id=new.id and status in ('queued','running');
  end if;
  return new;
end;
$$;
create trigger project_verification_changed after update of website_url on public.projects
for each row execute function public.invalidate_scan_verification();

create function public.request_domain_verification(p_project_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare p public.projects; v public.domain_verifications; host text;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'not_authorized' using errcode='42501'; end if;
  select * into p from public.projects where id=p_project_id and owner_id=auth.uid() for update;
  if not found then raise exception 'not_authorized' using errcode='42501'; end if;
  host=public.scan_domain(p.website_url);
  if host is null or host like '%.local' or host like '%.localhost' or host='localhost' or host ~ '^[0-9.]+$' then raise exception 'invalid_domain'; end if;
  select * into v from public.domain_verifications where project_id=p.id;
  if found and v.last_queued_at > now()-interval '30 seconds' then raise exception 'verification_cooldown'; end if;
  if found and v.lease_until>now() then raise exception 'verification_busy'; end if;
  insert into public.domain_verifications(project_id,domain) values(p.id,host)
  on conflict(project_id) do update set status='pending',last_queued_at=now(),attempts=0,
    lease_token=null,lease_until=null,verified_at=null,expires_at=null;
  perform pgmq.send('scan_jobs',jsonb_build_object('kind','verify','project_id',p.id));
end;
$$;

create function public.request_scan(p_project_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.projects; v public.domain_verifications; settings public.scan_settings; run_id uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'not_authorized' using errcode='42501'; end if;
  -- Serialize per-user quotas as well as the per-project duplicate constraint.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  select * into p from public.projects where id=p_project_id and owner_id=auth.uid() for update;
  if not found then raise exception 'not_authorized' using errcode='42501'; end if;
  select * into settings from public.scan_settings;
  if settings.mode<>'local' then raise exception 'scanning_disabled'; end if;
  if p.website_url !~ '^http://fixture:8080(/[^?#]*)?$' then raise exception 'fixture_only'; end if;
  select * into v from public.domain_verifications where project_id=p.id;
  if not found or v.status<>'verified' or v.method<>'local_fixture' or v.domain<>'fixture' or v.expires_at is null or v.expires_at<=now() then raise exception 'verification_required'; end if;
  if exists(select 1 from public.scan_runs where project_id=p.id and status in ('queued','running')) then raise exception 'scan_already_active'; end if;
  if exists(select 1 from public.scan_runs where requested_by=auth.uid() and created_at>now()-make_interval(secs=>settings.cooldown_seconds)) then raise exception 'scan_cooldown'; end if;
  if (select count(*) from public.scan_runs where requested_by=auth.uid() and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=settings.daily_allowance then raise exception 'daily_allowance'; end if;
  insert into public.scan_runs(project_id,requested_by,target_url) values(p.id,auth.uid(),p.website_url) returning id into run_id;
  perform pgmq.send('scan_jobs',jsonb_build_object('kind','scan','scan_id',run_id));
  return run_id;
end;
$$;

create function public.lease_scan_job() returns jsonb
language plpgsql security definer set search_path='' as $$
declare job record; r public.scan_runs; v public.domain_verifications; settings public.scan_settings; lease uuid=gen_random_uuid();
begin
  select * into settings from public.scan_settings;
  -- Expired leases are reclaimed when the queue visibility window expires.
  select * into job from pgmq.read('scan_jobs',180,1) limit 1;
  if not found then return null; end if;
  if job.message->>'kind'='scan' then
    select * into r from public.scan_runs where id=(job.message->>'scan_id')::uuid for update;
    if not found then perform pgmq.archive('scan_jobs',job.msg_id); return null; end if;
    if r.status in ('completed','failed','timed_out') then perform pgmq.archive('scan_jobs',job.msg_id); return null; end if;
    if r.lease_until>now() then return null; end if;
    if r.attempts>=settings.max_attempts or r.created_at<now()-interval '1 hour' or settings.mode<>'local' then
      update public.scan_runs set status='failed',completed_at=now(),lease_token=null,lease_until=null,error_code='retry_limit',error_message='The scan could not finish within its retry or queue limits.' where id=r.id;
      perform pgmq.archive('scan_jobs',job.msg_id); return null;
    end if;
    update public.scan_runs set status='running',started_at=coalesce(started_at,now()),attempts=attempts+1,
      lease_token=lease,lease_until=now()+interval '180 seconds' where id=r.id returning * into r;
    return jsonb_build_object('kind','scan','message_id',job.msg_id::text,'lease',lease,'run',to_jsonb(r),'settings',to_jsonb(settings));
  elsif job.message->>'kind'='verify' then
    select * into v from public.domain_verifications where project_id=(job.message->>'project_id')::uuid for update;
    if not found then perform pgmq.archive('scan_jobs',job.msg_id); return null; end if;
    if v.status<>'pending' then perform pgmq.archive('scan_jobs',job.msg_id); return null; end if;
    if v.lease_until>now() then return null; end if;
    if v.attempts>=settings.max_attempts then
      update public.domain_verifications set status='failed',checked_at=now(),lease_until=null,lease_token=null where project_id=v.project_id;
      perform pgmq.archive('scan_jobs',job.msg_id); return null;
    end if;
    update public.domain_verifications set attempts=attempts+1,lease_token=lease,lease_until=now()+interval '180 seconds'
      where project_id=v.project_id returning * into v;
    return jsonb_build_object('kind','verify','message_id',job.msg_id::text,'lease',lease,'verification',to_jsonb(v),
      'target_url',(select website_url from public.projects where id=v.project_id),'settings',to_jsonb(settings));
  end if;
  perform pgmq.archive('scan_jobs',job.msg_id); return null;
end;
$$;

create function public.finish_verification(p_project_id uuid,p_lease uuid,p_verified boolean,p_method text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if p_method not in ('dns','local_fixture') then raise exception 'invalid_method'; end if;
  if p_method='local_fixture' and ((select mode from public.scan_settings)<>'local' or
    (select website_url from public.projects where id=p_project_id) !~ '^http://fixture:8080(/[^?#]*)?$') then raise exception 'fixture_only'; end if;
  update public.domain_verifications set status=case when p_verified then 'verified' else 'failed' end,
    method=p_method,checked_at=now(),verified_at=case when p_verified then now() else null end,
    expires_at=case when p_verified then now()+interval '24 hours' else null end,lease_until=null,lease_token=null
    where project_id=p_project_id and status='pending' and lease_token=p_lease and lease_until>now();
  return found;
end;
$$;

create function public.finish_scan(p_scan_id uuid,p_lease uuid,p_status text,p_checks jsonb,p_error text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.scan_runs; item jsonb;
begin
  select * into r from public.scan_runs where id=p_scan_id for update;
  if p_lease is null or not found or r.status<>'running' or r.lease_token is distinct from p_lease or r.lease_until<=now() then return false; end if;
  if p_status not in ('completed','failed','timed_out') or p_checks is null or jsonb_typeof(p_checks)<>'array' or jsonb_array_length(p_checks)>6 then raise exception 'invalid_result'; end if;
  if p_status='completed' and jsonb_array_length(p_checks)<>6 then raise exception 'incomplete_checks'; end if;
  for item in select value from jsonb_array_elements(p_checks) loop
    if item->>'screenshot_path' is not null and item->>'screenshot_path' not like r.id::text||'/%' then raise exception 'invalid_artifact'; end if;
    insert into public.scan_checks(scan_run_id,check_type,outcome,description,details,duration_ms,screenshot_path)
    values(r.id,item->>'check_type',item->>'outcome',item->>'description',coalesce(item->'details','{}'),(item->>'duration_ms')::integer,item->>'screenshot_path');
  end loop;
  update public.scan_runs set status=p_status,completed_at=now(),lease_token=null,lease_until=null,
    passed_count=(select count(*) from public.scan_checks where scan_run_id=r.id and outcome='pass'),
    failed_count=(select count(*) from public.scan_checks where scan_run_id=r.id and outcome='fail'),
    warning_count=(select count(*) from public.scan_checks where scan_run_id=r.id and outcome='warning'),
    error_code=case when p_status='completed' then null when p_status='timed_out' then 'execution_timeout' else 'worker_error' end,
    error_message=case when p_status='completed' then null when p_status='timed_out' then 'The scan exceeded its execution limit.' else 'The scan could not be completed.' end
    where id=r.id;
  return true;
end;
$$;

create function public.retry_scan(p_scan_id uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  update public.scan_runs set status=case when attempts>=(select max_attempts from public.scan_settings) then 'failed' else 'queued' end,
    completed_at=case when attempts>=(select max_attempts from public.scan_settings) then now() else null end,
    error_code='worker_error',error_message='A worker attempt failed.',lease_token=null,lease_until=null
    where id=p_scan_id and status='running' and lease_token=p_lease and lease_until>now();
  return found;
end;
$$;
create function public.ack_scan_job(p_message_id bigint) returns boolean
language plpgsql security definer set search_path='' as $$
declare message jsonb;
begin
  select q.message into message from pgmq.q_scan_jobs q where msg_id=p_message_id;
  if message->>'kind'='scan' and exists(select 1 from public.scan_runs where id=(message->>'scan_id')::uuid and status in ('queued','running')) then return false; end if;
  if message->>'kind'='verify' and exists(select 1 from public.domain_verifications where project_id=(message->>'project_id')::uuid and status='pending') then return false; end if;
  return pgmq.archive('scan_jobs',p_message_id);
end;
$$;
create function public.expired_scan_artifacts() returns setof text
language sql security definer set search_path='' as $$
  select name from storage.objects where bucket_id='scan-artifacts'
  and created_at<now()-make_interval(days=>(select retention_days from public.scan_settings)) limit 100;
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('scan-artifacts','scan-artifacts',false,5242880,array['image/png']);
create policy scan_artifact_owner_read on storage.objects for select to authenticated using (
  bucket_id='scan-artifacts' and exists(select 1 from public.scan_runs r join public.projects p on p.id=r.project_id
    where r.id::text=(storage.foldername(name))[1] and p.owner_id=(select auth.uid())
    and r.created_at>now()-make_interval(days=>(select retention_days from public.scan_settings))));

do $$ begin if exists(select 1 from pg_namespace where nspname='pgmq_public') then execute 'revoke all on all functions in schema pgmq_public from public,anon,authenticated'; end if; end $$;
revoke all on schema pgmq from public,anon,authenticated;
revoke all on all tables in schema pgmq from public,anon,authenticated;
revoke all on all functions in schema pgmq from public,anon,authenticated;
revoke all on function public.scan_domain(text),public.invalidate_scan_verification(),
 public.request_domain_verification(uuid),public.request_scan(uuid),public.lease_scan_job(),
 public.finish_verification(uuid,uuid,boolean,text),public.finish_scan(uuid,uuid,text,jsonb,text),
 public.retry_scan(uuid,uuid),public.ack_scan_job(bigint),public.expired_scan_artifacts() from public,anon,authenticated;
grant execute on function public.request_domain_verification(uuid),public.request_scan(uuid) to authenticated;
grant execute on function public.lease_scan_job(),public.finish_verification(uuid,uuid,boolean,text),
 public.finish_scan(uuid,uuid,text,jsonb,text),public.retry_scan(uuid,uuid),public.ack_scan_job(bigint),
 public.expired_scan_artifacts() to service_role;
commit;
