begin;
-- Public execution is a separate, operator-controlled staging rollout. Fresh installs remain disabled.
alter table public.scan_settings drop constraint scan_settings_mode_check;
alter table public.scan_settings add constraint scan_settings_mode_check check(mode in ('disabled','local','public'));
create table public.public_scan_settings(singleton boolean primary key default true check(singleton),operator_enabled boolean not null default false,staging_approved boolean not null default false,production_enabled boolean not null default false,infrastructure_checked_at timestamptz,security_suite_sha text check(security_suite_sha ~ '^[a-f0-9]{40}$'));
insert into public.public_scan_settings default values;
create table public.scan_worker_identities(user_id uuid primary key references auth.users(id) on delete cascade,active boolean not null default false);
create table public.public_scan_audit(id bigint generated always as identity primary key,user_id uuid references auth.users(id) on delete set null,project_id uuid references public.projects(id) on delete set null,event text not null check(event in ('submitted','verification_requested','verification_finished','leased','worker_failure','finished','policy_blocked')),created_at timestamptz not null default now());
create table public.public_worker_readiness(user_id uuid primary key references public.scan_worker_identities(user_id) on delete cascade,ready boolean not null,checked_at timestamptz not null,policy_version text not null check(policy_version='public-gateway-v1'),security_suite_sha text not null check(security_suite_sha ~ '^[a-f0-9]{40}$'));
alter table public.public_scan_settings enable row level security;
alter table public.scan_worker_identities enable row level security;
alter table public.public_scan_audit enable row level security;
alter table public.public_worker_readiness enable row level security;
revoke all on public.public_scan_settings,public.scan_worker_identities,public.public_scan_audit,public.public_worker_readiness from public,anon,authenticated;
grant all on public.public_scan_settings,public.scan_worker_identities,public.public_scan_audit,public.public_worker_readiness to service_role;
grant usage,select on sequence public.public_scan_audit_id_seq to service_role;
grant select on public.public_scan_audit to authenticated;
create policy owner_audit on public.public_scan_audit for select to authenticated using(user_id=(select auth.uid()) and (select public.beta_has_access()));
alter table public.scan_runs add column public_scope boolean not null default false,add column public_consent_at timestamptz,add column worker_identity uuid references auth.users(id) on delete set null;
alter table public.domain_verifications add column worker_identity uuid references auth.users(id) on delete set null;
create index public_scan_domain_time on public.scan_runs((public.scan_domain(target_url)),created_at) where public_scope;
create index public_audit_owner_time on public.public_scan_audit(user_id,created_at);
create role deployreceipt_scan_worker nologin noinherit;
grant deployreceipt_scan_worker to authenticator;
grant usage on schema public,storage to deployreceipt_scan_worker;
alter role deployreceipt_scan_worker set statement_timeout='10s';
alter role deployreceipt_scan_worker set lock_timeout='3s';
create function public.public_scan_worker() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(auth.role()='deployreceipt_scan_worker',false) and exists(select 1 from public.scan_worker_identities w join auth.users u on u.id=w.user_id join auth.sessions s on s.user_id=w.user_id where w.user_id=auth.uid() and w.active and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and s.id::text=auth.jwt()->>'session_id' and (s.not_after is null or s.not_after>clock_timestamp()));
$$;
create function public.scan_worker_access_token(event jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if exists(select 1 from public.scan_worker_identities where user_id=(event->>'user_id')::uuid and active) then return jsonb_set(event,'{claims,role}','"deployreceipt_scan_worker"');end if;
 return event;
end;$$;
revoke all on function public.scan_worker_access_token(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.scan_worker_access_token(jsonb) to supabase_auth_admin;
create function public.public_scan_ready() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.beta_settings b join public.public_scan_settings p using(singleton) where b.environment='staging' and b.enforced and b.scanning_enabled and p.operator_enabled and p.staging_approved and not p.production_enabled and p.infrastructure_checked_at>now()-interval '24 hours' and p.security_suite_sha is not null)
 and exists(select 1 from public.public_worker_readiness r join public.scan_worker_identities w on w.user_id=r.user_id and w.active join public.public_scan_settings p on p.security_suite_sha=r.security_suite_sha where r.ready and r.checked_at>now()-interval '45 seconds' and r.policy_version='public-gateway-v1');
$$;
create function public.public_scanning_status() returns boolean language sql stable security definer set search_path='' as $$ select public.beta_has_access() and (select mode='public' from public.scan_settings) and public.public_scan_ready(); $$;
create function public.public_worker_attest(p_ready boolean,p_policy_version text,p_security_suite_sha text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not public.public_scan_worker() or p_policy_version<>'public-gateway-v1' then raise exception 'not_authorized' using errcode='42501';end if;
 insert into public.public_worker_readiness values(auth.uid(),p_ready,clock_timestamp(),p_policy_version,p_security_suite_sha) on conflict(user_id)do update set ready=excluded.ready,checked_at=excluded.checked_at,policy_version=excluded.policy_version,security_suite_sha=excluded.security_suite_sha;
 return p_ready and p_security_suite_sha=(select security_suite_sha from public.public_scan_settings) and public.public_scan_ready();
end;$$;
create function public.public_target_origin(value text) returns text language plpgsql immutable set search_path='' as $$
declare parts text[];label text;
begin
 if value is null or char_length(value)>2048 or value ~ '[[:space:]\\]' then raise exception 'invalid_public_url';end if;
 parts:=regexp_match(value,'^(https?)://([a-z0-9.-]+)([/#?]|$)');
 if parts is null or char_length(parts[2])>253 or parts[2] !~ '^[a-z0-9.-]+\.[a-z][a-z0-9-]+$' or parts[2] ~ '(^|\.)(localhost|local|internal|test|invalid|example|onion)$' then raise exception 'invalid_public_url';end if;
 foreach label in array string_to_array(parts[2],'.')loop if char_length(label)>63 or label !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' then raise exception 'invalid_public_url';end if;end loop;
 return parts[1]||'://'||parts[2];
end;$$;
alter function public.request_scan(uuid) rename to fixture_request_scan;
revoke all on function public.fixture_request_scan(uuid) from public,anon,authenticated,service_role;
create function public.request_scan(p_project_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
begin
 if (select mode from public.scan_settings)='public' then raise exception 'explicit_consent_required';end if;
 return public.fixture_request_scan(p_project_id);
end;$$;
create function public.request_public_scan(p_project_id uuid,p_consent boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.projects;v public.domain_verifications;settings public.scan_settings;origin text;run_id uuid;
begin
 if not public.beta_has_access() then raise exception 'not_authorized' using errcode='42501';end if;
 if not coalesce(p_consent,false) then raise exception 'explicit_consent_required';end if;
 if not public.public_scan_ready() then raise exception 'public_scanning_unavailable';end if;
 select * into settings from public.scan_settings;if settings.mode<>'public' then raise exception 'public_scanning_unavailable';end if;
 select * into p from public.projects where id=p_project_id and owner_id=auth.uid();if not found then raise exception 'not_authorized' using errcode='42501';end if;
 origin:=public.public_target_origin(p.website_url);
 perform pg_advisory_xact_lock(hashtextextended('public_scan_global',7));
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 perform 1 from public.projects where id=p.id and website_url=p.website_url for update;if not found then raise exception 'target_changed';end if;
 select * into v from public.domain_verifications where project_id=p.id;
 if not found or v.status<>'verified' or v.method<>'dns' or v.domain<>public.scan_domain(p.website_url) or v.expires_at is null or v.expires_at<=now() then raise exception 'verification_required';end if;
 if exists(select 1 from public.scan_runs where public_scope and status in ('queued','running')) then raise exception 'public_worker_busy';end if;
 if exists(select 1 from public.scan_runs where project_id=p.id and status in ('queued','running')) then raise exception 'scan_already_active';end if;
 if exists(select 1 from public.scan_runs where public_scope and public.scan_domain(target_url)=v.domain and created_at>now()-interval '120 seconds') then raise exception 'domain_cooldown';end if;
 if(select count(*) from public.scan_runs where public_scope and public.scan_domain(target_url)=v.domain and created_at>now()-interval '1 day')>=20 then raise exception 'domain_allowance';end if;
 if exists(select 1 from public.scan_runs where requested_by=auth.uid() and created_at>now()-make_interval(secs=>settings.cooldown_seconds)) then raise exception 'scan_cooldown';end if;
 if(select count(*) from public.scan_runs where requested_by=auth.uid() and created_at>=date_trunc('day',now()))>=settings.daily_allowance then raise exception 'daily_allowance';end if;
 insert into public.scan_runs(project_id,requested_by,target_url,public_scope,public_consent_at) values(p.id,auth.uid(),p.website_url,true,clock_timestamp()) returning id into run_id;
 insert into public.public_scan_audit(user_id,project_id,event) values(auth.uid(),p.id,'submitted');
 perform pgmq.send('scan_jobs',jsonb_build_object('kind','scan','scan_id',run_id));return run_id;
end;$$;
alter function public.request_domain_verification(uuid) rename to fixture_request_verification;
revoke all on function public.fixture_request_verification(uuid) from public,anon,authenticated,service_role;
create function public.request_domain_verification(p_project_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if (select mode from public.scan_settings)='public' then
  if not public.beta_has_access() or not public.public_scan_ready() then raise exception 'public_scanning_unavailable';end if;
  perform public.public_target_origin(website_url) from public.projects where id=p_project_id and owner_id=auth.uid();if not found then raise exception 'not_authorized' using errcode='42501';end if;
 end if;
 perform public.fixture_request_verification(p_project_id);
 insert into public.public_scan_audit(user_id,project_id,event) values(auth.uid(),p_project_id,'verification_requested');
end;$$;
alter function public.lease_scan_job() rename to fixture_lease_scan_job;
revoke all on function public.fixture_lease_scan_job() from public,anon,authenticated,service_role;
create function public.lease_scan_job() returns jsonb language plpgsql security definer set search_path='' as $$
declare job record;r public.scan_runs;v public.domain_verifications;settings public.scan_settings;lease uuid=gen_random_uuid();
begin
 select * into settings from public.scan_settings;
 if settings.mode<>'public' then if (coalesce(auth.role()='service_role',false) or current_setting('role',true)='service_role') then return public.fixture_lease_scan_job();end if;return null;end if;
 if not public.public_scan_worker() or not public.public_scan_ready() or not exists(select 1 from public.public_worker_readiness r join public.public_scan_settings p on p.security_suite_sha=r.security_suite_sha where r.user_id=auth.uid() and r.ready and r.checked_at>now()-interval '45 seconds') then return null;end if;
 select * into job from pgmq.read('scan_jobs',180,1)limit 1;if not found then return null;end if;
 if job.message->>'kind'='scan' then
  select * into r from public.scan_runs where id=(job.message->>'scan_id')::uuid for update;
  if not found then perform pgmq.archive('scan_jobs',job.msg_id);return null;end if;
  if r.status in ('completed','failed','timed_out')then perform pgmq.archive('scan_jobs',job.msg_id);return null;end if;
  if r.lease_until>now() then return null;end if;
  select * into v from public.domain_verifications where project_id=r.project_id;
  if not r.public_scope or r.public_consent_at is null or r.created_at<now()-interval '15 minutes' or r.attempts>=settings.max_attempts or v.status is distinct from 'verified' or v.method is distinct from 'dns' or v.expires_at is null or v.expires_at<=now() or v.domain is distinct from public.scan_domain(r.target_url) or not exists(select 1 from public.projects p join auth.users u on u.id=p.owner_id join public.beta_access a on a.email=lower(u.email) and a.active where p.id=r.project_id and p.website_url=r.target_url and u.email_confirmed_at is not null) then
   update public.scan_runs set status='failed',completed_at=now(),lease_token=null,lease_until=null,error_code='authorization_expired',error_message='Public scan authority expired or target changed.' where id=r.id;
   perform pgmq.archive('scan_jobs',job.msg_id);return null;
  end if;
  perform public.public_target_origin(r.target_url);
  update public.scan_runs set status='running',started_at=coalesce(started_at,now()),attempts=attempts+1,lease_token=lease,lease_until=now()+interval '180 seconds',worker_identity=auth.uid() where id=r.id returning * into r;
  insert into public.public_scan_audit(user_id,project_id,event)values(r.requested_by,r.project_id,'leased');
  return jsonb_build_object('kind','scan','message_id',job.msg_id::text,'lease',lease,'run',to_jsonb(r),'settings',to_jsonb(settings),'verification',jsonb_build_object('token',v.token,'domain',v.domain,'expires_at',v.expires_at));
 elsif job.message->>'kind'='verify' then
  select * into v from public.domain_verifications where project_id=(job.message->>'project_id')::uuid for update;
  if not found then perform pgmq.archive('scan_jobs',job.msg_id);return null;end if;
  if v.status<>'pending' then perform pgmq.archive('scan_jobs',job.msg_id);return null;end if;
  if v.lease_until>now()then return null;end if;
  if v.attempts>=settings.max_attempts then update public.domain_verifications set status='failed',checked_at=now(),lease_until=null,lease_token=null where project_id=v.project_id;perform pgmq.archive('scan_jobs',job.msg_id);return null;end if;
  update public.domain_verifications set attempts=attempts+1,lease_token=lease,lease_until=now()+interval '180 seconds',worker_identity=auth.uid() where project_id=v.project_id returning * into v;
  return jsonb_build_object('kind','verify','message_id',job.msg_id::text,'lease',lease,'verification',to_jsonb(v),'target_url',(select website_url from public.projects where id=v.project_id),'settings',to_jsonb(settings));
 end if;perform pgmq.archive('scan_jobs',job.msg_id);return null;
end;$$;
create function public.worker_job_permitted(p_id uuid,p_lease uuid,p_kind text)returns boolean language sql stable security definer set search_path='' as $$
 select (coalesce(auth.role()='service_role',false) or current_setting('role',true)='service_role') or (public.public_scan_worker() and case when p_kind='scan' then exists(select 1 from public.scan_runs where id=p_id and worker_identity=auth.uid() and lease_token=p_lease and lease_until>now()) else exists(select 1 from public.domain_verifications where project_id=p_id and worker_identity=auth.uid() and lease_token=p_lease and lease_until>now())end);
$$;
alter function public.finish_scan(uuid,uuid,text,jsonb,text) rename to internal_finish_scan;
revoke all on function public.internal_finish_scan(uuid,uuid,text,jsonb,text)from public,anon,authenticated,service_role;
create function public.finish_scan(p_scan_id uuid,p_lease uuid,p_status text,p_checks jsonb,p_error text default null)returns boolean language plpgsql security definer set search_path='' as $$declare done boolean;begin
 if not public.worker_job_permitted(p_scan_id,p_lease,'scan')then raise exception 'not_authorized' using errcode='42501';end if;
 if exists(select 1 from public.scan_runs where id=p_scan_id and public_scope) and exists(select 1 from jsonb_array_elements(p_checks)c where c->'details'->'executed'='false'::jsonb and c->>'outcome' is distinct from 'warning')then raise exception 'invalid_public_outcome';end if;
 done:=public.internal_finish_scan(p_scan_id,p_lease,p_status,p_checks,p_error);if done then insert into public.public_scan_audit(user_id,project_id,event)select requested_by,project_id,'finished' from public.scan_runs where id=p_scan_id and public_scope; if exists(select 1 from jsonb_array_elements(p_checks)c where coalesce(c->'details'->>'policy_blocked','0')<>'0')then insert into public.public_scan_audit(user_id,project_id,event)select requested_by,project_id,'policy_blocked' from public.scan_runs where id=p_scan_id and public_scope;end if; end if;return done;
end;$$;
revoke all on function public.finish_scan(uuid,uuid,text,jsonb,text)from public,anon,authenticated;
grant execute on function public.finish_scan(uuid,uuid,text,jsonb,text)to service_role,deployreceipt_scan_worker;
alter function public.finish_verification(uuid,uuid,boolean,text) rename to internal_finish_verification;
revoke all on function public.internal_finish_verification(uuid,uuid,boolean,text)from public,anon,authenticated,service_role;
create function public.finish_verification(p_project_id uuid,p_lease uuid,p_verified boolean,p_method text)returns boolean language plpgsql security definer set search_path='' as $$declare done boolean;begin
 if not public.worker_job_permitted(p_project_id,p_lease,'verify')then raise exception 'not_authorized' using errcode='42501';end if;if auth.role()='deployreceipt_scan_worker' and p_method<>'dns' then raise exception 'invalid_method';end if;
 done:=public.internal_finish_verification(p_project_id,p_lease,p_verified,p_method);if done then null; end if;return done;
end;$$;
revoke all on function public.finish_verification(uuid,uuid,boolean,text)from public,anon,authenticated;
grant execute on function public.finish_verification(uuid,uuid,boolean,text)to service_role,deployreceipt_scan_worker;
alter function public.retry_scan(uuid,uuid) rename to internal_retry_scan;
revoke all on function public.internal_retry_scan(uuid,uuid)from public,anon,authenticated,service_role;
create function public.retry_scan(p_scan_id uuid,p_lease uuid)returns boolean language plpgsql security definer set search_path='' as $$declare done boolean;begin
 if not public.worker_job_permitted(p_scan_id,p_lease,'scan')then raise exception 'not_authorized' using errcode='42501';end if;
 done:=public.internal_retry_scan(p_scan_id,p_lease);if done then insert into public.public_scan_audit(user_id,project_id,event)select requested_by,project_id,'worker_failure' from public.scan_runs where id=p_scan_id and public_scope; end if;return done;
end;$$;
revoke all on function public.retry_scan(uuid,uuid)from public,anon,authenticated;
grant execute on function public.retry_scan(uuid,uuid)to service_role,deployreceipt_scan_worker;
alter function public.record_scan_configuration(uuid,uuid,jsonb) rename to internal_record_scan_configuration;
revoke all on function public.internal_record_scan_configuration(uuid,uuid,jsonb)from public,anon,authenticated,service_role;
create function public.record_scan_configuration(p_scan_id uuid,p_lease uuid,p_configuration jsonb)returns boolean language plpgsql security definer set search_path='' as $$declare done boolean;begin
 if not public.worker_job_permitted(p_scan_id,p_lease,'scan')then raise exception 'not_authorized' using errcode='42501';end if;
 if auth.role()='deployreceipt_scan_worker' and (p_configuration->>'mode' is distinct from 'public' or p_configuration->>'transport' is distinct from 'pinned_gateway_v1')then raise exception 'invalid_public_configuration';end if;
 done:=public.internal_record_scan_configuration(p_scan_id,p_lease,p_configuration);if done then null; end if;return done;
end;$$;
revoke all on function public.record_scan_configuration(uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.record_scan_configuration(uuid,uuid,jsonb)to service_role,deployreceipt_scan_worker;
alter function public.ack_scan_job(bigint) rename to internal_ack_scan_job;
revoke all on function public.internal_ack_scan_job(bigint)from public,anon,authenticated,service_role;
create function public.ack_scan_job(p_message_id bigint)returns boolean language plpgsql security definer set search_path='' as $$declare message jsonb;begin
 if not (coalesce(auth.role()='service_role',false) or current_setting('role',true)='service_role') then
  if not public.public_scan_worker()then raise exception 'not_authorized' using errcode='42501';end if;
  select q.message into message from pgmq.q_scan_jobs q where msg_id=p_message_id;
  if not(case when message->>'kind'='scan' then exists(select 1 from public.scan_runs where id=(message->>'scan_id')::uuid and worker_identity=auth.uid())else exists(select 1 from public.domain_verifications where project_id=(message->>'project_id')::uuid and worker_identity=auth.uid())end)then return false;end if;
 end if;return public.internal_ack_scan_job(p_message_id);
end;$$;
alter function public.expired_scan_artifacts()rename to internal_expired_scan_artifacts;
revoke all on function public.internal_expired_scan_artifacts()from public,anon,authenticated,service_role;
create function public.expired_scan_artifacts()returns setof text language plpgsql security definer set search_path='' as $$begin
 if not (coalesce(auth.role()='service_role',false) or current_setting('role',true)='service_role') and not public.public_scan_worker()then raise exception 'not_authorized' using errcode='42501';end if;
 delete from public.public_scan_audit where created_at<now()-interval '30 days';
 return query select public.internal_expired_scan_artifacts();
end;$$;
alter function public.worker_tick(uuid,boolean,text)rename to internal_worker_tick;
revoke all on function public.internal_worker_tick(uuid,boolean,text)from public,anon,authenticated,service_role;
create function public.worker_tick(p_instance uuid,p_ready boolean,p_error text default null)returns jsonb language plpgsql security definer set search_path='' as $$begin
 if not (coalesce(auth.role()='service_role',false) or current_setting('role',true)='service_role') and not public.public_scan_worker()then raise exception 'not_authorized' using errcode='42501';end if;
 return public.internal_worker_tick(p_instance,p_ready,p_error);
end;$$;
create function public.worker_artifact_allowed(p_name text,p_delete boolean)returns boolean language sql stable security definer set search_path='' as $$
 select public.public_scan_worker() and case when p_delete then exists(select 1 from storage.objects where bucket_id='scan-artifacts' and name=p_name and created_at<now()-make_interval(days=>(select retention_days from public.scan_settings))) else exists(select 1 from public.scan_runs where public_scope and worker_identity=auth.uid() and status='running' and lease_until>now() and p_name=id::text||'/'||attempts::text||'/desktop.png' or public_scope and worker_identity=auth.uid() and status='running' and lease_until>now() and p_name=id::text||'/'||attempts::text||'/mobile.png')end;
$$;
grant insert,select,delete on storage.objects to deployreceipt_scan_worker;
-- SELECT is needed to find expired objects for DELETE, but never to download, sign or list evidence.
create policy public_worker_cleanup_metadata on storage.objects for select to deployreceipt_scan_worker using(bucket_id='scan-artifacts' and storage.operation() in ('storage.object.delete','storage.object.delete_many') and public.worker_artifact_allowed(name,true));
create policy public_worker_upload on storage.objects for insert to deployreceipt_scan_worker with check(bucket_id='scan-artifacts' and public.worker_artifact_allowed(name,false));
create policy public_worker_cleanup on storage.objects for delete to deployreceipt_scan_worker using(bucket_id='scan-artifacts' and public.worker_artifact_allowed(name,true));
revoke all on function public.public_scan_worker(),public.public_scan_ready(),public.public_scanning_status(),public.public_worker_attest(boolean,text,text),public.public_target_origin(text),public.request_scan(uuid),public.request_public_scan(uuid,boolean),public.request_domain_verification(uuid),public.lease_scan_job(),public.worker_job_permitted(uuid,uuid,text),public.ack_scan_job(bigint),public.expired_scan_artifacts(),public.worker_tick(uuid,boolean,text),public.worker_artifact_allowed(text,boolean)from public,anon,authenticated;
grant execute on function public.request_scan(uuid),public.request_public_scan(uuid,boolean),public.request_domain_verification(uuid),public.public_scanning_status()to authenticated;
grant execute on function public.lease_scan_job(),public.ack_scan_job(bigint),public.expired_scan_artifacts(),public.worker_tick(uuid,boolean,text)to service_role,deployreceipt_scan_worker;
grant execute on function public.public_worker_attest(boolean,text,text),public.worker_artifact_allowed(text,boolean)to deployreceipt_scan_worker;
create or replace function public.beta_readiness(p_environment text,p_scanning boolean) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.beta_settings where environment=p_environment and enforced and scanning_enabled=p_scanning)
 and exists(select 1 from storage.buckets where id='scan-artifacts' and not public and file_size_limit<=2097152)
 and exists(select 1 from pg_extension where extname='pgmq')
 and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity)
 and exists(select 1 from public.scan_settings where (not p_scanning and mode='disabled')or(p_scanning and mode='local')or(p_scanning and mode='public' and public.public_scan_ready()));
$$;
notify pgrst,'reload schema';notify pgrst,'reload config';
commit;
