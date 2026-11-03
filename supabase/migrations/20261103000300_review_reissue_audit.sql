begin;
-- Direct authenticated reissue must record expiry too, without relying on a page visit.
create or replace function public.manage_release_review(p_id uuid,p_action text) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.release_reviews; i public.review_invitations; iid uuid;
begin
 if not public.owns_release_review(p_id) then raise exception 'not_authorized' using errcode='42501'; end if;
 select * into r from public.release_reviews where id=p_id for update;
 if r.status in ('draft','pending_review') and r.expires_at<=clock_timestamp() then
  update public.release_reviews set status='expired' where id=r.id;
  update public.review_invitations set status='expired' where review_id=r.id and status in ('pending','accepted');
  insert into public.review_events(review_id,actor_id,event_type) values(r.id,auth.uid(),'review_expired');
  r.status:='expired';
 end if;

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
commit;
