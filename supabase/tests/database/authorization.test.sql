begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();
create function pg_temp.affected(statement text) returns bigint language plpgsql as $$
declare affected_rows bigint;
begin execute statement; get diagnostics affected_rows = row_count; return affected_rows; end;
$$;

insert into auth.users (id, email, raw_user_meta_data) values
 ('11111111-1111-4111-8111-111111111111', 'first@example.test', '{"full_name":"First"}'),
 ('22222222-2222-4222-8222-222222222222', 'second@example.test', '{"full_name": {"unexpected":true}}');
select is((select count(*) from public.profiles where id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')), 2::bigint, 'profiles created before email confirmation');
select is((select full_name from public.profiles where id='22222222-2222-4222-8222-222222222222'), null::text, 'malformed name metadata is safe');
select ok((select relrowsecurity from pg_class where oid='public.profiles'::regclass), 'profiles RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.projects'::regclass), 'projects RLS enabled');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select is((select count(*) from public.profiles), 1::bigint, 'only own profile is visible');
select lives_ok($$update public.profiles set full_name='Updated' where id=auth.uid()$$, 'own profile editable');
select is((select full_name from public.profiles where id=auth.uid()), 'Updated', 'profile update persisted');
select is(pg_temp.affected($$update public.profiles set full_name='Intrusion' where id='22222222-2222-4222-8222-222222222222'$$), 0::bigint, 'cannot update another profile');
select throws_ok($$delete from public.profiles$$, '42501', null, 'profiles cannot be deleted through public API');
select throws_ok($$insert into public.profiles(id) values ('33333333-3333-4333-8333-333333333333')$$, '42501', null, 'profiles cannot be inserted through public API');
select throws_ok($$update public.profiles set id='22222222-2222-4222-8222-222222222222'$$, '42501', null, 'profile identity is immutable');
select lives_ok($$insert into public.projects(name, website_url) values ('First project','https://example.com/')$$, 'owner can create project without supplying owner');
select is((select owner_id from public.projects where name='First project'), auth.uid(), 'owner derived from verified JWT');
select throws_ok($$insert into public.projects(owner_id,name,website_url) values ('22222222-2222-4222-8222-222222222222','Forged','https://example.com')$$, '42501', null, 'client cannot supply another owner');
select throws_ok($$update public.projects set owner_id='22222222-2222-4222-8222-222222222222'$$, '42501', null, 'ownership cannot be changed');
select throws_ok($$update public.projects set created_at=now()$$, '42501', null, 'creation timestamp is immutable');
select throws_ok($$insert into public.projects(name,website_url) values ('','https://example.com')$$, '23514', null, 'blank name rejected');
select throws_ok($$insert into public.projects(name,website_url) values ('Unsafe','javascript:alert(1)')$$, '23514', null, 'non HTTP URL rejected');
select lives_ok($$update public.projects set name='Edited' where name='First project'$$, 'owner can edit');
select is((select name from public.projects limit 1), 'Edited', 'edit persisted');

select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select is((select count(*) from public.projects), 0::bigint, 'second user cannot read first user projects');
select is(pg_temp.affected($$update public.projects set name='Intrusion'$$), 0::bigint, 'cross-user update denied');
select is(pg_temp.affected($$delete from public.projects$$), 0::bigint, 'cross-user delete denied');
select lives_ok($$insert into public.projects(name, website_url) values ('Second project','http://example.org/')$$, 'second user can create own project');
select is((select count(*) from public.projects), 1::bigint, 'second user sees only own project');
select lives_ok($$delete from public.projects where name='Second project'$$, 'owner can delete project');
select is((select count(*) from public.projects), 0::bigint, 'deleted project no longer exists');

select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":true}', true);
select is((select count(*) from public.projects), 0::bigint, 'anonymous auth user cannot read projects');
select is((select count(*) from public.profiles), 0::bigint, 'anonymous auth user cannot read profiles');
select throws_ok($$insert into public.projects(name,website_url) values ('Anonymous','https://example.com')$$, '42501', null, 'anonymous auth user cannot create projects');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select * from public.profiles$$, '42501', null, 'unauthenticated profile access denied');
select throws_ok($$select * from public.projects$$, '42501', null, 'unauthenticated project access denied');
select throws_ok($$insert into public.projects(name,website_url) values ('Anon','https://example.com')$$, '42501', null, 'unauthenticated project creation denied');
select throws_ok($$update public.projects set name='Anon'$$, '42501', null, 'unauthenticated project update denied');
select throws_ok($$delete from public.projects$$, '42501', null, 'unauthenticated project deletion denied');
select * from finish();
rollback;
