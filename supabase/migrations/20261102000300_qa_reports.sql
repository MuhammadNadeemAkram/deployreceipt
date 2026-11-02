begin;
-- Historic scans remain NULL: current settings are not evidence of past execution.
alter table public.scan_runs add column configuration_snapshot jsonb;
alter table public.scan_runs add column verification_snapshot jsonb;
create function public.capture_scan_report_context() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    select jsonb_build_object('domain',v.domain,'method',v.method,'verified_at',v.verified_at,'expires_at',v.expires_at)
      into new.verification_snapshot from public.domain_verifications v
      where v.project_id=new.project_id and v.status='verified' and v.expires_at>now();

  end if;
  return new;
end;
$$;
create trigger scan_report_context before insert or update on public.scan_runs
for each row execute function public.capture_scan_report_context();
revoke all on function public.capture_scan_report_context() from public,anon,authenticated;

create function public.record_scan_configuration(p_scan_id uuid,p_lease uuid,p_configuration jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if p_configuration is null or jsonb_typeof(p_configuration)<>'object' or octet_length(p_configuration::text)>4096 then raise exception 'invalid_configuration'; end if;
  update public.scan_runs set configuration_snapshot=(p_configuration-'singleton') || jsonb_build_object('source','worker_attempt','desktop_viewport','1440x900','mobile_viewport','390x844','scope','single target and at most five internal links')
    where id=p_scan_id and status='running' and lease_token=p_lease and lease_until>now();
  return found;
end;
$$;
revoke all on function public.record_scan_configuration(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_scan_configuration(uuid,uuid,jsonb) to service_role;
alter table public.scan_runs add constraint scan_id_project_unique unique(id,project_id);
alter table public.scan_checks add constraint scan_check_id_run_unique unique(id,scan_run_id);
create table public.qa_reports (
  id uuid primary key default gen_random_uuid(),
  scan_run_id uuid not null unique,
  project_id uuid not null,
  project_name text not null,
  target_url text not null,
  kind text not null check(kind in ('qa','diagnostic')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(id,scan_run_id),
  foreign key(scan_run_id,project_id) references public.scan_runs(id,project_id) on delete cascade
);
create index qa_reports_project_created on public.qa_reports(project_id,created_at desc);
create table public.qa_finding_triage (
  report_id uuid not null,
  scan_run_id uuid not null,
  scan_check_id uuid not null,
  severity text check(severity in ('critical','high','medium','low')),
  resolution text not null default 'open' check(resolution in ('open','investigating','resolved','ignored')),
  notes text not null default '' check(char_length(notes)<=2000),
  revision integer not null default 1 check(revision>0),
  updated_by uuid not null references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key(report_id,scan_check_id),
  foreign key(report_id,scan_run_id) references public.qa_reports(id,scan_run_id) on delete cascade,
  foreign key(scan_check_id,scan_run_id) references public.scan_checks(id,scan_run_id) on delete cascade
);
create table public.qa_comments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null,
  scan_check_id uuid not null,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check(char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  foreign key(report_id,scan_check_id) references public.qa_finding_triage(report_id,scan_check_id) on delete cascade
);
create index qa_comments_report on public.qa_comments(report_id,created_at);
create table public.qa_finding_evidence (
  report_id uuid not null,
  scan_run_id uuid not null,
  finding_check_id uuid not null,
  evidence_check_id uuid not null,
  attached_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(report_id,finding_check_id,evidence_check_id),
  foreign key(report_id,scan_run_id) references public.qa_reports(id,scan_run_id) on delete cascade,
  foreign key(report_id,finding_check_id) references public.qa_finding_triage(report_id,scan_check_id) on delete cascade,
  foreign key(evidence_check_id,scan_run_id) references public.scan_checks(id,scan_run_id) on delete cascade
);
create table public.qa_export_leases (
  user_id uuid primary key references auth.users(id) on delete cascade,
  report_id uuid not null references public.qa_reports(id) on delete cascade,
  lease_token uuid,
  lease_until timestamptz not null,
  last_started_at timestamptz not null
);
create function public.owns_qa_report(p_report_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and not coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
  and exists(select 1 from public.qa_reports r join public.projects p on p.id=r.project_id where r.id=p_report_id and p.owner_id=auth.uid());
$$;
revoke all on function public.owns_qa_report(uuid) from public,anon;
grant execute on function public.owns_qa_report(uuid) to authenticated;

alter table public.qa_reports enable row level security;
alter table public.qa_finding_triage enable row level security;
alter table public.qa_comments enable row level security;
alter table public.qa_finding_evidence enable row level security;
alter table public.qa_export_leases enable row level security;
revoke all on public.qa_reports,public.qa_finding_triage,public.qa_comments,public.qa_finding_evidence,public.qa_export_leases from public,anon,authenticated;
grant select on public.qa_reports,public.qa_finding_triage,public.qa_comments,public.qa_finding_evidence to authenticated;
create policy reports_owner_read on public.qa_reports for select to authenticated using(public.owns_qa_report(id));
create policy triage_owner_read on public.qa_finding_triage for select to authenticated using(public.owns_qa_report(report_id));
create policy comments_owner_read on public.qa_comments for select to authenticated using(public.owns_qa_report(report_id));
create policy evidence_owner_read on public.qa_finding_evidence for select to authenticated using(public.owns_qa_report(report_id));

create function public.create_qa_report(p_scan_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.scan_runs; p public.projects; report_id uuid; total integer;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'not_authorized' using errcode='42501'; end if;
  select * into r from public.scan_runs where id=p_scan_id;
  if not found then raise exception 'not_authorized' using errcode='42501'; end if;
  select * into p from public.projects where id=r.project_id and owner_id=auth.uid() for update;
  if not found then raise exception 'not_authorized' using errcode='42501'; end if;
  select * into r from public.scan_runs where id=p_scan_id for update;
  if r.status not in ('completed','failed','timed_out') then raise exception 'scan_not_terminal'; end if;
  select count(*) into total from public.scan_checks where scan_run_id=r.id;
  if r.status='completed' and (total<>6
    or r.passed_count<>(select count(*) from public.scan_checks where scan_run_id=r.id and outcome='pass')
    or r.failed_count<>(select count(*) from public.scan_checks where scan_run_id=r.id and outcome='fail')
    or r.warning_count<>(select count(*) from public.scan_checks where scan_run_id=r.id and outcome='warning'))
    then raise exception 'scan_data_inconsistent'; end if;
  insert into public.qa_reports(scan_run_id,project_id,project_name,target_url,kind,created_by)
    values(r.id,p.id,p.name,r.target_url,case when r.status='completed' then 'qa' else 'diagnostic' end,auth.uid())
    on conflict(scan_run_id) do nothing;
  select id into report_id from public.qa_reports where scan_run_id=r.id;
  insert into public.qa_finding_triage(report_id,scan_run_id,scan_check_id,updated_by)
    select report_id,r.id,c.id,auth.uid() from public.scan_checks c where c.scan_run_id=r.id on conflict do nothing;
  return report_id;
end;
$$;
create function public.save_qa_triage(p_report_id uuid,p_check_id uuid,p_severity text,p_resolution text,p_notes text,p_revision integer,p_evidence uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare r public.qa_reports; t public.qa_finding_triage; evidence_id uuid; source public.scan_checks;
begin
  if not public.owns_qa_report(p_report_id) then raise exception 'not_authorized' using errcode='42501'; end if;
  select * into r from public.qa_reports where id=p_report_id for update;
  select * into t from public.qa_finding_triage where report_id=r.id and scan_check_id=p_check_id for update;
  if not found then raise exception 'finding_not_found'; end if;
  if p_revision is distinct from t.revision then raise exception 'stale_triage'; end if;
  if (p_severity is not null and p_severity not in ('critical','high','medium','low')) or p_resolution is null or p_resolution not in ('open','investigating','resolved','ignored') or p_notes is null or char_length(p_notes)>2000 or coalesce(cardinality(p_evidence),0)>2 then raise exception 'invalid_triage'; end if;
  foreach evidence_id in array coalesce(p_evidence,'{}'::uuid[]) loop
    select * into source from public.scan_checks where id=evidence_id and scan_run_id=r.scan_run_id and screenshot_path is not null;
    if not found then raise exception 'invalid_evidence'; end if;
    if not exists(select 1 from public.qa_finding_evidence where report_id=r.id and finding_check_id=t.scan_check_id and evidence_check_id=evidence_id) then
      if not exists(select 1 from public.scan_runs s join storage.objects o on o.bucket_id='scan-artifacts' and o.name=source.screenshot_path
        where s.id=r.scan_run_id and s.created_at>now()-make_interval(days=>(select retention_days from public.scan_settings)))
      then raise exception 'evidence_unavailable'; end if;
    end if;
  end loop;
  update public.qa_finding_triage set severity=p_severity,resolution=p_resolution,notes=p_notes,revision=revision+1,updated_by=auth.uid(),updated_at=clock_timestamp()
    where report_id=r.id and scan_check_id=t.scan_check_id;
  delete from public.qa_finding_evidence where report_id=r.id and finding_check_id=t.scan_check_id and not(evidence_check_id=any(coalesce(p_evidence,'{}'::uuid[])));
  insert into public.qa_finding_evidence(report_id,scan_run_id,finding_check_id,evidence_check_id,attached_by)
    select r.id,r.scan_run_id,t.scan_check_id,value,auth.uid() from unnest(coalesce(p_evidence,'{}'::uuid[])) value on conflict do nothing;
end;
$$;
create function public.add_qa_comment(p_report_id uuid,p_check_id uuid,p_body text) returns uuid
language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
  if not public.owns_qa_report(p_report_id) then raise exception 'not_authorized' using errcode='42501'; end if;
  perform 1 from public.qa_reports where id=p_report_id for update;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 2000 then raise exception 'invalid_comment'; end if;
  if (select count(*) from public.qa_comments where report_id=p_report_id)>=30 then raise exception 'comment_limit'; end if;
  insert into public.qa_comments(report_id,scan_check_id,body,author_id) values(p_report_id,p_check_id,btrim(p_body),auth.uid()) returning id into new_id;
  return new_id;
end;
$$;
create function public.claim_qa_export(p_report_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare current_lease public.qa_export_leases; token uuid=gen_random_uuid();
begin
  if not public.owns_qa_report(p_report_id) then raise exception 'not_authorized' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('qa_pdf:'||auth.uid()::text,0));
  select * into current_lease from public.qa_export_leases where user_id=auth.uid();
  if found and current_lease.lease_until>clock_timestamp() then raise exception 'export_busy'; end if;
  if found and current_lease.last_started_at>clock_timestamp()-interval '30 seconds' then raise exception 'export_cooldown'; end if;
  insert into public.qa_export_leases(user_id,report_id,lease_token,lease_until,last_started_at) values(auth.uid(),p_report_id,token,clock_timestamp()+interval '45 seconds',clock_timestamp())
    on conflict(user_id) do update set report_id=p_report_id,lease_token=token,lease_until=clock_timestamp()+interval '45 seconds',last_started_at=clock_timestamp();
  return token;
end;
$$;
create function public.release_qa_export(p_token uuid) returns void
language plpgsql security definer set search_path='' as $$
  begin update public.qa_export_leases set lease_token=null,lease_until=clock_timestamp() where user_id=auth.uid() and lease_token=p_token; end;
$$;
revoke all on function public.create_qa_report(uuid),public.save_qa_triage(uuid,uuid,text,text,text,integer,uuid[]),public.add_qa_comment(uuid,uuid,text),public.claim_qa_export(uuid),public.release_qa_export(uuid) from public,anon,authenticated;
grant execute on function public.create_qa_report(uuid),public.save_qa_triage(uuid,uuid,text,text,text,integer,uuid[]),public.add_qa_comment(uuid,uuid,text),public.claim_qa_export(uuid),public.release_qa_export(uuid) to authenticated;
commit;

