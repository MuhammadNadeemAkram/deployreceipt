begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create temp table scan_test_state(key text primary key,value jsonb);
grant all on scan_test_state to authenticated,service_role;
create function pg_temp.state(key_name text) returns jsonb language sql as $$select value from scan_test_state where key=key_name$$;
create function pg_temp.run_id() returns uuid language sql as $$select (pg_temp.state('run')#>>'{}')::uuid$$;
insert into auth.users(id,email) values
 ('31111111-1111-4111-8111-111111111111','scan-owner@example.test'),
 ('32222222-2222-4222-8222-222222222222','scan-other@example.test');
insert into public.projects(id,owner_id,name,website_url) values
 ('33333333-3333-4333-8333-333333333333','31111111-1111-4111-8111-111111111111','Fixture','http://fixture:8080/');
update public.scan_settings set mode='local';
select ok((select relrowsecurity from pg_class where oid='public.scan_runs'::regclass),'scan RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.scan_checks'::regclass),'check RLS enabled');
select is((select public from storage.buckets where id='scan-artifacts'),false,'screenshots are private');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"31111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select throws_ok($$select public.request_scan('33333333-3333-4333-8333-333333333333')$$,'P0001','verification_required','unverified scan denied');
select lives_ok($$select public.request_domain_verification('33333333-3333-4333-8333-333333333333')$$,'owner can queue verification');
select is((select length(token) from public.domain_verifications),64,'challenge has 256-bit random token');
select throws_ok($$update public.domain_verifications set status='verified'$$,'42501',null,'client cannot mark domain verified');
select throws_ok($$select public.request_domain_verification('33333333-3333-4333-8333-333333333333')$$,'P0001','verification_cooldown','verification rate limited');
select throws_ok($$select public.lease_scan_job()$$,'42501',null,'client cannot consume queue');

set local role service_role;
insert into scan_test_state values('verification_job',public.lease_scan_job());
select is(pg_temp.state('verification_job')->>'kind','verify','verification job leased');
select is(public.finish_verification('33333333-3333-4333-8333-333333333333',(pg_temp.state('verification_job')->>'lease')::uuid,true,'local_fixture'),true,'trusted worker records verification');
select is(public.ack_scan_job((pg_temp.state('verification_job')->>'message_id')::bigint),true,'verification acknowledged after persistence');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"32222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
select throws_ok($$select public.request_scan('33333333-3333-4333-8333-333333333333')$$,'42501','not_authorized','cross-user scan denied');
select is((select count(*) from public.domain_verifications),0::bigint,'cross-user challenges hidden');

select set_config('request.jwt.claims','{"sub":"31111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
insert into scan_test_state values('run',to_jsonb(public.request_scan('33333333-3333-4333-8333-333333333333')));
select is((select target_url from public.scan_runs where id=pg_temp.run_id()),'http://fixture:8080/','target taken from stored project');
select throws_ok($$select public.request_scan('33333333-3333-4333-8333-333333333333')$$,'P0001','scan_already_active','one active scan per project');
select throws_ok($$insert into public.scan_runs(project_id,requested_by,target_url) values ('33333333-3333-4333-8333-333333333333',auth.uid(),'https://evil.test')$$,'42501',null,'client cannot forge runs');
select throws_ok($$update public.scan_runs set status='completed'$$,'42501',null,'client cannot forge completion');
select throws_ok($$insert into public.scan_checks(scan_run_id,check_type,outcome,description) values (pg_temp.run_id(),'availability','pass','Forged')$$,'42501',null,'client cannot forge checks');

set local role service_role;
insert into scan_test_state values('first_job',public.lease_scan_job());
select is((select status from public.scan_runs where id=pg_temp.run_id()),'running','claim transitions to running');
select is(public.ack_scan_job((pg_temp.state('first_job')->>'message_id')::bigint),false,'active job cannot be acknowledged');
select is(public.finish_scan(pg_temp.run_id(),(pg_temp.state('first_job')->>'lease')::uuid,'completed',
 (select jsonb_agg(jsonb_build_object('check_type',type,'outcome',case when type in ('availability','desktop') then 'pass' when type in ('mobile','links') then 'fail' else 'warning' end,'description','Test observation','details','{}'::jsonb))
 from unnest(array['availability','desktop','mobile','javascript','links','network']) as type)),true,'all checks and terminal status stored atomically');
select is((select passed_count from public.scan_runs where id=pg_temp.run_id()),2,'pass count derived from actual checks');
select is((select failed_count from public.scan_runs where id=pg_temp.run_id()),2,'fail count derived from actual checks');
select is((select warning_count from public.scan_runs where id=pg_temp.run_id()),2,'warning count derived from actual checks');
select is(public.finish_scan(pg_temp.run_id(),(pg_temp.state('first_job')->>'lease')::uuid,'completed','[]'),false,'duplicate completion is idempotently rejected');
select is(public.ack_scan_job((pg_temp.state('first_job')->>'message_id')::bigint),true,'terminal job acknowledged');
insert into storage.objects(bucket_id,name) values('scan-artifacts',pg_temp.run_id()::text||'/1/desktop.png');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"31111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select is((select count(*) from public.scan_checks),6::bigint,'owner can read findings');
select is((select count(*) from storage.objects where bucket_id='scan-artifacts'),1::bigint,'owner can read private artifact');
select throws_ok($$select public.request_scan('33333333-3333-4333-8333-333333333333')$$,'P0001','scan_cooldown','scan rate limited');
select set_config('request.jwt.claims','{"sub":"32222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
select is((select count(*) from public.scan_runs),0::bigint,'cross-user runs hidden');
select is((select count(*) from public.scan_checks),0::bigint,'cross-user findings hidden');
select is((select count(*) from storage.objects where bucket_id='scan-artifacts'),0::bigint,'cross-user private artifacts hidden');

reset role;
update public.scan_runs set created_at=now()-interval '2 minutes';
update public.scan_settings set daily_allowance=1;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"31111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select throws_ok($$select public.request_scan('33333333-3333-4333-8333-333333333333')$$,'P0001','daily_allowance','daily quota enforced');
reset role;
update public.scan_settings set daily_allowance=10;
set local role authenticated;
update scan_test_state set value=to_jsonb(public.request_scan('33333333-3333-4333-8333-333333333333')) where key='run';
set local role service_role;
insert into scan_test_state values('crash_job',public.lease_scan_job());
reset role;
update public.scan_runs set lease_until=now()-interval '1 second' where id=pg_temp.run_id();
select pgmq.set_vt('scan_jobs',(pg_temp.state('crash_job')->>'message_id')::bigint,0);
set local role service_role;
insert into scan_test_state values('recovered_job',public.lease_scan_job());
select is((select attempts from public.scan_runs where id=pg_temp.run_id()),2,'expired worker lease reclaimed');
select is(public.finish_scan(pg_temp.run_id(),(pg_temp.state('crash_job')->>'lease')::uuid,'timed_out','[]'),false,'stale worker cannot write after recovery');
select is(public.retry_scan(pg_temp.run_id(),(pg_temp.state('recovered_job')->>'lease')::uuid),true,'recoverable error queues retry');
select is(public.ack_scan_job((pg_temp.state('recovered_job')->>'message_id')::bigint),false,'retry is not acknowledged');
reset role;
select pgmq.set_vt('scan_jobs',(pg_temp.state('recovered_job')->>'message_id')::bigint,0);
set local role service_role;
insert into scan_test_state values('last_job',public.lease_scan_job());
select is(public.finish_scan(pg_temp.run_id(),(pg_temp.state('last_job')->>'lease')::uuid,'timed_out','[]'),true,'timeout durably recorded');
select is((select status from public.scan_runs where id=pg_temp.run_id()),'timed_out','timeout status visible');
select is(public.ack_scan_job((pg_temp.state('last_job')->>'message_id')::bigint),true,'timeout acknowledged after durable failure');
reset role;
update public.scan_runs set created_at=now()-interval '2 minutes';
set local role authenticated;
update scan_test_state set value=to_jsonb(public.request_scan('33333333-3333-4333-8333-333333333333')) where key='run';
reset role;
update public.scan_runs set attempts=3 where id=pg_temp.run_id();
set local role service_role;
select is(public.lease_scan_job(),null::jsonb,'retry limit is terminal');
select is((select status from public.scan_runs where id=pg_temp.run_id()),'failed','exhausted scan marked failed');
reset role;
insert into public.scan_runs(project_id,requested_by,target_url,status,started_at,lease_until)
 values('33333333-3333-4333-8333-333333333333','31111111-1111-4111-8111-111111111111','http://fixture:8080/','running',now(),now()+interval '3 minutes');
set local role authenticated;
update public.projects set website_url='https://example.com/' where id='33333333-3333-4333-8333-333333333333';
select is((select count(*) from public.domain_verifications),0::bigint,'URL changes invalidate domain verification');
select is((select count(*) from public.scan_runs where status in ('queued','running')),0::bigint,'URL changes cancel active runs');
reset role;
update public.scan_settings set mode='disabled';
set local role authenticated;
select throws_ok($$select public.request_scan('33333333-3333-4333-8333-333333333333')$$,'P0001','scanning_disabled','public scanning stays disabled');
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select throws_ok($$select public.request_scan('33333333-3333-4333-8333-333333333333')$$,'42501',null,'anonymous scan request denied');
select throws_ok($$select * from public.scan_runs$$,'42501',null,'anonymous scan reads denied');
select * from finish();
rollback;
