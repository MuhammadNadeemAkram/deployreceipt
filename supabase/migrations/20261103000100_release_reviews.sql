begin;
create table public.release_reviews (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 report_id uuid not null references public.qa_reports(id) on delete cascade,
 scan_run_id uuid not null references public.scan_runs(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 root_id uuid not null, previous_id uuid references public.release_reviews(id),
 version integer not null check(version>0), title text not null check(char_length(title) between 1 and 120),
 release_notes text not null check(char_length(release_notes)<=4000),
 status text not null default 'draft' check(status in ('draft','pending_review','changes_requested','approved','revoked','expired')),
 snapshot jsonb not null, snapshot_digest text not null check(length(snapshot_digest)=64),
 created_at timestamptz not null default now(), submitted_at timestamptz, completed_at timestamptz,
 expires_at timestamptz not null default now()+interval '3 days', unique(root_id,version)
);
create index release_reviews_owner_created on public.release_reviews(owner_id,created_at desc);
create table public.review_invitations (
 id uuid primary key default gen_random_uuid(), review_id uuid not null references public.release_reviews(id) on delete cascade,
 invited_email text not null check(char_length(invited_email) between 3 and 254), reviewer_user_id uuid references auth.users(id) on delete set null,
 status text not null default 'pending' check(status in ('pending','accepted','revoked','expired')),
 expires_at timestamptz not null, revoked_at timestamptz, accepted_at timestamptz, created_at timestamptz not null default now()
);
create unique index one_primary_review_invite on public.review_invitations(review_id) where status in ('pending','accepted');
create index review_invite_email on public.review_invitations(invited_email,expires_at);
create table public.release_review_evidence (
 review_id uuid not null references public.release_reviews(id) on delete cascade, check_id uuid not null,
 path text not null, kind text not null check(kind in ('desktop','mobile')), expires_at timestamptz not null,
 primary key(review_id,check_id)
);
create table public.review_comments (
 id uuid primary key default gen_random_uuid(), review_id uuid not null references public.release_reviews(id) on delete cascade,
 finding_id uuid, parent_id uuid, author_id uuid not null references auth.users(id), author_role text not null check(author_role in ('developer','reviewer')),
 content text not null check(char_length(btrim(content)) between 1 and 2000), kind text not null check(kind in ('comment','change_request')),
 created_at timestamptz not null default now(), resolved_at timestamptz, unique(id,review_id),
 foreign key(parent_id,review_id) references public.review_comments(id,review_id)
);
create index review_comments_chronological on public.review_comments(review_id,created_at);
create table public.review_decisions (
 id uuid primary key default gen_random_uuid(), review_id uuid not null unique references public.release_reviews(id) on delete cascade,
 reviewer_id uuid not null references auth.users(id), version integer not null, snapshot_digest text not null,
 decision text not null check(decision in ('approved','changes_requested')), scope_ack boolean not null,
 observations_ack boolean not null, evidence_ack boolean not null, notes text not null check(char_length(notes)<=2000),
 created_at timestamptz not null default now()
);
create table public.review_events (
 id bigint generated always as identity primary key, review_id uuid not null references public.release_reviews(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null, event_type text not null, metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create index review_events_timeline on public.review_events(review_id,id);

-- Use current Auth records, not user-editable metadata or stale email claims.
create function public.review_verified_email() returns text language sql stable security definer set search_path='' as $$
 select lower(u.email) from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null
 and not coalesce(u.is_anonymous,false) and coalesce((auth.jwt()->>'is_anonymous')::boolean,false)=false;
$$;
create function public.owns_release_review(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.review_verified_email() is not null and exists(select 1 from public.release_reviews r join public.projects p on p.id=r.project_id where r.id=p_id and r.owner_id=auth.uid() and p.owner_id=auth.uid());
$$;
create function public.is_release_reviewer(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.review_invitations i join public.release_reviews r on r.id=i.review_id join public.projects p on p.id=r.project_id
 where r.id=p_id and r.status in ('pending_review','approved','changes_requested') and r.expires_at>now()
 and i.status='accepted' and i.expires_at>now() and i.reviewer_user_id=auth.uid() and i.invited_email=public.review_verified_email() and p.owner_id=r.owner_id);
$$;
create function public.can_read_release_review(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.owns_release_review(p_id) or public.is_release_reviewer(p_id);
$$;
create function public.can_read_review_evidence(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.release_review_evidence e join public.release_reviews r on r.id=e.review_id join public.scan_runs s on s.id=r.scan_run_id
 where e.path=p_path and e.expires_at>now() and s.created_at>now()-make_interval(days=>(select retention_days from public.scan_settings)) and public.can_read_release_review(r.id));
$$;

alter table public.release_reviews enable row level security;
alter table public.review_invitations enable row level security;
alter table public.release_review_evidence enable row level security;
alter table public.review_comments enable row level security;
alter table public.review_decisions enable row level security;
alter table public.review_events enable row level security;
revoke all on public.release_reviews,public.review_invitations,public.release_review_evidence,public.review_comments,public.review_decisions,public.review_events from public,anon,authenticated;
grant select on public.release_reviews,public.review_invitations,public.release_review_evidence,public.review_comments,public.review_decisions,public.review_events to authenticated;
create policy review_read on public.release_reviews for select to authenticated using(public.can_read_release_review(id));
create policy invitation_read on public.review_invitations for select to authenticated using(public.owns_release_review(review_id) or (invited_email=public.review_verified_email() and status in ('pending','accepted') and expires_at>now()));
create policy review_evidence_read on public.release_review_evidence for select to authenticated using(public.can_read_release_review(review_id));
create policy review_comment_read on public.review_comments for select to authenticated using(public.can_read_release_review(review_id));
create policy review_decision_read on public.review_decisions for select to authenticated using(public.can_read_release_review(review_id));
create policy review_event_read on public.review_events for select to authenticated using(public.owns_release_review(review_id));
create policy invited_review_artifact_read on storage.objects for select to authenticated using(bucket_id='scan-artifacts' and public.can_read_review_evidence(storage.objects.name));

create function public.create_release_review(p_report uuid,p_title text,p_notes text,p_email text,p_previous uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare q public.qa_reports; s public.scan_runs; prev public.release_reviews; rid uuid:=gen_random_uuid(); root uuid; ver integer:=1; snap jsonb; checks jsonb; email text:=lower(btrim(p_email));
begin
 if public.review_verified_email() is null then raise exception 'verified_account_required' using errcode='42501'; end if;
 if p_title is null or char_length(btrim(p_title)) not between 1 and 120 or p_notes is null or char_length(p_notes)>4000 or email is null or email!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or char_length(email)>254 or email=public.review_verified_email() then raise exception 'invalid_review'; end if;
 -- Lock the report so concurrent versions and triage saves serialize around snapshot creation.
 select * into q from public.qa_reports where id=p_report for update;
 if not found or not public.owns_qa_report(q.id) then raise exception 'not_authorized' using errcode='42501'; end if;
 select * into s from public.scan_runs where id=q.scan_run_id;
 if q.kind<>'qa' or s.status<>'completed' or (select count(*) from public.scan_checks where scan_run_id=s.id)<>6 then raise exception 'report_not_eligible'; end if;
 root:=rid;
 if p_previous is not null then
  select * into prev from public.release_reviews where id=p_previous for update;
  if not found or not public.owns_release_review(prev.id) or prev.project_id<>q.project_id then raise exception 'not_authorized' using errcode='42501'; end if;
  if prev.status not in ('changes_requested','approved','revoked','expired') then raise exception 'invalid_transition'; end if;
  -- One linear successor; a stale revision cannot branch or inherit a decision.
  perform pg_advisory_xact_lock(hashtextextended(prev.root_id::text,42));
  if exists(select 1 from public.release_reviews where previous_id=prev.id) then raise exception 'revision_already_exists'; end if;
  root:=prev.root_id; ver:=prev.version+1;
 end if;
 select jsonb_agg(jsonb_build_object('id',c.id,'type',c.check_type,'outcome',c.outcome,'description',c.description,'details',c.details,'duration_ms',c.duration_ms,
 'severity',t.severity,'resolution',t.resolution,'notes',t.notes,'triage_revision',t.revision,
 'comments',coalesce((select jsonb_agg(jsonb_build_object('body',m.body,'created_at',m.created_at) order by m.created_at,m.id) from public.qa_comments m where m.report_id=q.id and m.scan_check_id=c.id),'[]'),
 'evidence_ids',coalesce((select jsonb_agg(e.evidence_check_id order by e.evidence_check_id) from public.qa_finding_evidence e where e.report_id=q.id and e.finding_check_id=c.id),'[]')) order by c.check_type)
 into checks from public.scan_checks c join public.qa_finding_triage t on t.scan_check_id=c.id and t.report_id=q.id where c.scan_run_id=s.id;
 if jsonb_array_length(checks) is distinct from 6 or s.passed_count<>(select count(*) from public.scan_checks where scan_run_id=s.id and outcome='pass') or s.failed_count<>(select count(*) from public.scan_checks where scan_run_id=s.id and outcome='fail') or s.warning_count<>(select count(*) from public.scan_checks where scan_run_id=s.id and outcome='warning') then raise exception 'report_data_inconsistent'; end if;
 snap:=jsonb_build_object('schema',1,'review_id',rid,'version',ver,'title',btrim(p_title),'release_notes',p_notes,
 'report_id',q.id,'scan_id',s.id,'project_id',q.project_id,'project_name',q.project_name,'target_url',q.target_url,
 'scan_date',s.created_at,'started_at',s.started_at,'completed_at',s.completed_at,'scan_status',s.status,
 'configuration',s.configuration_snapshot,'authorization',s.verification_snapshot,
 'passed',s.passed_count,'failed',s.failed_count,'warnings',s.warning_count,'findings',checks,
 'limitations',jsonb_build_array('One target, two viewports and at most five internal links. Third-party requests may be blocked.','This is not a security certification, accessibility audit, deployment, or proof that every test passed.','Human severity and resolution do not change automated outcomes. Historical configuration may be unrecorded.','Screenshot access expires independently and is never reconstructed.'));
 if octet_length(snap::text)>524288 then raise exception 'snapshot_limit'; end if;
 insert into public.release_reviews(id,project_id,report_id,scan_run_id,owner_id,root_id,previous_id,version,title,release_notes,snapshot,snapshot_digest)
 values(rid,q.project_id,q.id,s.id,auth.uid(),root,p_previous,ver,btrim(p_title),p_notes,snap,encode(extensions.digest(convert_to(snap::text,'UTF8'),'sha256'),'hex'));
 insert into public.release_review_evidence(review_id,check_id,path,kind,expires_at)
 select rid,c.id,c.screenshot_path,c.check_type,s.created_at+make_interval(days=>(select retention_days from public.scan_settings)) from public.scan_checks c where c.scan_run_id=s.id and c.screenshot_path is not null and c.check_type in ('desktop','mobile');
 insert into public.review_invitations(review_id,invited_email,expires_at) values(rid,email,now()+interval '3 days');
 insert into public.review_events(review_id,actor_id,event_type,metadata) values(rid,auth.uid(),'draft_created',jsonb_build_object('version',ver)),(rid,auth.uid(),'invitation_created','{}');
 if p_previous is not null then insert into public.review_events(review_id,actor_id,event_type,metadata) values(prev.id,auth.uid(),'new_version_created',jsonb_build_object('review_id',rid,'version',ver)); end if;
 return rid;
end;$$;

create function public.expire_release_reviews() returns void language plpgsql security definer set search_path='' as $$
declare r public.release_reviews;
begin
 for r in select * from public.release_reviews where status in ('draft','pending_review') and expires_at<=now() and (owner_id=auth.uid() or exists(select 1 from public.review_invitations i where i.review_id=release_reviews.id and i.invited_email=public.review_verified_email())) for update loop
  update public.release_reviews set status='expired' where id=r.id;
  update public.review_invitations set status='expired' where review_id=r.id and status in ('pending','accepted');
  insert into public.review_events(review_id,actor_id,event_type) values(r.id,auth.uid(),'review_expired');
 end loop;
end;$$;
create function public.manage_release_review(p_id uuid,p_action text) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.release_reviews; i public.review_invitations; iid uuid;
begin
 if not public.owns_release_review(p_id) then raise exception 'not_authorized' using errcode='42501'; end if;
 select * into r from public.release_reviews where id=p_id for update;
 select * into i from public.review_invitations where review_id=r.id order by created_at desc,id desc limit 1;
 if p_action='submit' then
  if r.status<>'draft' or r.expires_at<=now() then raise exception 'invalid_transition'; end if;
  update public.release_reviews set status='pending_review',submitted_at=now() where id=r.id;
  insert into public.review_events(review_id,actor_id,event_type) values(r.id,auth.uid(),'review_submitted');
 elsif p_action='revoke' then
  if r.status in ('revoked','expired') then raise exception 'invalid_transition'; end if;
  update public.release_reviews set status='revoked' where id=r.id;
  update public.review_invitations set status='revoked',revoked_at=now() where review_id=r.id and status in ('pending','accepted');
  insert into public.review_events(review_id,actor_id,event_type) values(r.id,auth.uid(),'invitation_revoked'),(r.id,auth.uid(),'review_revoked');
 elsif p_action='reissue' then
  if not ((r.status in ('draft','pending_review') and r.expires_at<=now()) or r.status='expired') or r.completed_at is not null then raise exception 'invalid_transition'; end if;
  update public.review_invitations set status='expired' where review_id=r.id and status in ('pending','accepted');
  update public.release_reviews set status=case when submitted_at is null then 'draft' else 'pending_review' end,expires_at=now()+interval '3 days' where id=r.id;
  insert into public.review_invitations(review_id,invited_email,expires_at) values(r.id,i.invited_email,now()+interval '3 days') returning id into iid;
  insert into public.review_events(review_id,actor_id,event_type,metadata) values(r.id,auth.uid(),'invitation_reissued',jsonb_build_object('invitation_id',iid));
 else raise exception 'invalid_transition'; end if;
 return coalesce(iid,i.id);
end;$$;
create function public.accept_review_invitation(p_invitation uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare i public.review_invitations; r public.release_reviews;
begin
 select * into i from public.review_invitations where id=p_invitation;
 if not found or i.invited_email is distinct from public.review_verified_email() then raise exception 'not_authorized' using errcode='42501'; end if;
 select * into r from public.release_reviews where id=i.review_id for update;
 select * into i from public.review_invitations where id=p_invitation for update;
 if r.status<>'pending_review' or r.expires_at<=now() or i.expires_at<=now() or i.status not in ('pending','accepted') or r.owner_id=auth.uid() then raise exception 'invitation_unavailable'; end if;
 if i.status='accepted' and i.reviewer_user_id is distinct from auth.uid() then raise exception 'not_authorized' using errcode='42501'; end if;
 if i.status='pending' then
  update public.review_invitations set status='accepted',reviewer_user_id=auth.uid(),accepted_at=now() where id=i.id;
  insert into public.review_events(review_id,actor_id,event_type) values(r.id,auth.uid(),'invitation_accepted');
 end if;
 return r.id;
end;$$;
create function public.add_review_comment(p_id uuid,p_content text,p_finding uuid default null,p_parent uuid default null,p_kind text default 'comment') returns uuid language plpgsql security definer set search_path='' as $$
declare r public.release_reviews; cid uuid; own boolean;
begin
 if not public.can_read_release_review(p_id) then raise exception 'not_authorized' using errcode='42501'; end if;
 select * into r from public.release_reviews where id=p_id for update;
 if not public.can_read_release_review(p_id) then raise exception 'not_authorized' using errcode='42501'; end if;
 own:=public.owns_release_review(p_id);
 if r.status not in ('pending_review','approved','changes_requested') or p_kind not in ('comment','change_request') or p_content is null or char_length(btrim(p_content)) not between 1 and 2000 then raise exception 'invalid_comment'; end if;
 if p_finding is not null and not exists(select 1 from jsonb_array_elements(r.snapshot->'findings') f where f->>'id'=p_finding::text) then raise exception 'invalid_finding'; end if;
 if p_parent is not null and not exists(select 1 from public.review_comments where id=p_parent and review_id=r.id) then raise exception 'invalid_reply'; end if;
 if (select count(*) from public.review_comments where review_id=r.id)>=100 then raise exception 'comment_limit'; end if;
 insert into public.review_comments(review_id,finding_id,parent_id,author_id,author_role,content,kind) values(r.id,p_finding,p_parent,auth.uid(),case when own then 'developer' else 'reviewer' end,btrim(p_content),p_kind) returning id into cid;
 insert into public.review_events(review_id,actor_id,event_type,metadata) values(r.id,auth.uid(),'comment_added',jsonb_build_object('comment_id',cid));
 return cid;
end;$$;
create function public.resolve_review_feedback(p_id uuid,p_comment uuid,p_resolved boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.owns_release_review(p_id) then raise exception 'not_authorized' using errcode='42501'; end if;
 perform 1 from public.release_reviews where id=p_id for update;
 update public.review_comments set resolved_at=case when p_resolved then now() else null end where id=p_comment and review_id=p_id;
 if not found then raise exception 'invalid_comment'; end if;
 insert into public.review_events(review_id,actor_id,event_type,metadata) values(p_id,auth.uid(),'feedback_resolution_changed',jsonb_build_object('comment_id',p_comment,'resolved',p_resolved));
end;$$;
create function public.decide_release_review(p_id uuid,p_version integer,p_digest text,p_decision text,p_scope_ack boolean,p_observations_ack boolean,p_evidence_ack boolean,p_notes text) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.release_reviews; did uuid;
begin
 select * into r from public.release_reviews where id=p_id for update;
 if not found or not public.is_release_reviewer(p_id) then raise exception 'not_authorized' using errcode='42501'; end if;
 if r.status<>'pending_review' then raise exception 'decision_already_recorded'; end if;
 if p_version is distinct from r.version or p_digest is distinct from r.snapshot_digest then raise exception 'review_version_mismatch'; end if;
 if p_decision is null or p_decision not in ('approved','changes_requested') or p_notes is null or char_length(p_notes)>2000 then raise exception 'invalid_decision'; end if;
 if p_decision='approved' and (p_scope_ack is distinct from true or p_observations_ack is distinct from true or p_evidence_ack is distinct from true) then raise exception 'acknowledgement_required'; end if;
 if p_decision='changes_requested' and btrim(p_notes)='' then raise exception 'feedback_required'; end if;
 insert into public.review_decisions(review_id,reviewer_id,version,snapshot_digest,decision,scope_ack,observations_ack,evidence_ack,notes)
 values(r.id,auth.uid(),r.version,r.snapshot_digest,p_decision,coalesce(p_scope_ack,false),coalesce(p_observations_ack,false),coalesce(p_evidence_ack,false),btrim(p_notes)) returning id into did;
 update public.release_reviews set status=p_decision,completed_at=now() where id=r.id;
 insert into public.review_events(review_id,actor_id,event_type,metadata) values(r.id,auth.uid(),case when p_decision='approved' then 'release_approved' else 'changes_requested' end,jsonb_build_object('decision_id',did,'digest',r.snapshot_digest,'version',r.version));
 return did;
end;$$;
-- Only narrow authenticated operations; ordinary users cannot write snapshots, authors, decisions or events.
revoke all on function public.review_verified_email(),public.owns_release_review(uuid),public.is_release_reviewer(uuid),public.can_read_release_review(uuid),public.can_read_review_evidence(text),public.create_release_review(uuid,text,text,text,uuid),public.expire_release_reviews(),public.manage_release_review(uuid,text),public.accept_review_invitation(uuid),public.add_review_comment(uuid,text,uuid,uuid,text),public.resolve_review_feedback(uuid,uuid,boolean),public.decide_release_review(uuid,integer,text,text,boolean,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.review_verified_email(),public.owns_release_review(uuid),public.is_release_reviewer(uuid),public.can_read_release_review(uuid),public.can_read_review_evidence(text),public.create_release_review(uuid,text,text,text,uuid),public.expire_release_reviews(),public.manage_release_review(uuid,text),public.accept_review_invitation(uuid),public.add_review_comment(uuid,text,uuid,uuid,text),public.resolve_review_feedback(uuid,uuid,boolean),public.decide_release_review(uuid,integer,text,text,boolean,boolean,boolean,text) to authenticated;
commit;
