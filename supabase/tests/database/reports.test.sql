begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create temp table qa_test_state(key text primary key,value uuid);
grant all on qa_test_state to authenticated,service_role;
create function pg_temp.qa_id() returns uuid language sql as $$select value from qa_test_state where key='report'$$;
create function pg_temp.check_id(kind text) returns uuid language sql as $$select id from public.scan_checks where scan_run_id='41111111-1111-4111-8111-111111111111' and check_type=kind$$;
insert into auth.users(id,email) values('11114444-1111-4111-8111-111111111111','report-a@example.test'),('22224444-2222-4222-8222-222222222222','report-b@example.test');
insert into public.projects(id,owner_id,name,website_url) values
 ('31111111-1111-4111-8111-111111111111','11114444-1111-4111-8111-111111111111','Report fixture','http://fixture:8080/current'),
 ('32222222-2222-4222-8222-222222222222','22224444-2222-4222-8222-222222222222','Other project','http://fixture:8080/');
insert into public.domain_verifications(project_id,domain,status,method,verified_at,expires_at)
 values('31111111-1111-4111-8111-111111111111','fixture','verified','local_fixture',now(),now()+interval '24 hours');
insert into public.scan_runs(id,project_id,requested_by,target_url,status,started_at,completed_at,passed_count,failed_count,warning_count)
 values('41111111-1111-4111-8111-111111111111','31111111-1111-4111-8111-111111111111','11114444-1111-4111-8111-111111111111','http://fixture:8080/recorded','completed',now()-interval '8 seconds',now(),3,1,2);
insert into public.scan_checks(scan_run_id,check_type,outcome,description,details,screenshot_path)
 select '41111111-1111-4111-8111-111111111111',kind,
 case when kind in ('availability','desktop','mobile') then 'pass' when kind='links' then 'fail' else 'warning' end,
 'Persisted fixture observation',jsonb_build_object('fixture',true),case when kind in ('desktop','mobile') then '41111111-1111-4111-8111-111111111111/1/'||kind||'.png' else null end
 from unnest(array['availability','desktop','mobile','javascript','links','network']) kind;
insert into storage.objects(bucket_id,name) values('scan-artifacts','41111111-1111-4111-8111-111111111111/1/desktop.png'),('scan-artifacts','41111111-1111-4111-8111-111111111111/1/mobile.png');
insert into public.scan_runs(id,project_id,requested_by,target_url,status)
 values('42222222-2222-4222-8222-222222222222','31111111-1111-4111-8111-111111111111','11114444-1111-4111-8111-111111111111','http://fixture:8080/','queued');
insert into public.scan_runs(id,project_id,requested_by,target_url,status,completed_at)
 values('43333333-3333-4333-8333-333333333333','31111111-1111-4111-8111-111111111111','11114444-1111-4111-8111-111111111111','http://fixture:8080/','timed_out',now()),
 ('44444444-4444-4444-8444-444444444444','31111111-1111-4111-8111-111111111111','11114444-1111-4111-8111-111111111111','http://fixture:8080/','completed',now()),
 ('45555555-5555-4555-8555-555555555555','32222222-2222-4222-8222-222222222222','22224444-2222-4222-8222-222222222222','http://fixture:8080/','failed',now());
insert into public.scan_checks(scan_run_id,check_type,outcome,description,screenshot_path)
 values('45555555-5555-4555-8555-555555555555','desktop','warning','Foreign evidence','45555555-5555-4555-8555-555555555555/1/desktop.png');
select is((select mode from public.scan_settings),'disabled','report migration keeps scanning disabled');
select ok((select relrowsecurity from pg_class where oid='public.qa_reports'::regclass),'report RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.qa_finding_triage'::regclass),'triage RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.qa_comments'::regclass),'comment RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.qa_finding_evidence'::regclass),'evidence RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.qa_export_leases'::regclass),'export lease RLS enabled');
select is((select configuration_snapshot from public.scan_runs where id='41111111-1111-4111-8111-111111111111'),null::jsonb,'historic execution configuration not invented');
select is((select verification_snapshot->>'domain' from public.scan_runs where id='41111111-1111-4111-8111-111111111111'),'fixture','authorization recorded at request');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11114444-1111-4111-8111-111111111111","role":"authenticated"}',true);
insert into qa_test_state values('report',public.create_qa_report('41111111-1111-4111-8111-111111111111'));
select is(public.create_qa_report('41111111-1111-4111-8111-111111111111'),pg_temp.qa_id(),'report creation is idempotent');
select is((select count(*) from public.qa_reports),1::bigint,'one report for one scan');
select is((select target_url from public.qa_reports where id=pg_temp.qa_id()),'http://fixture:8080/recorded','report uses persisted target, not current project URL');
select is((select count(*) from public.qa_finding_triage where report_id=pg_temp.qa_id()),6::bigint,'triage references each actual check');
select is((select count(*) from public.qa_finding_triage where severity is not null),0::bigint,'no invented automated severity');
select throws_ok($$select public.create_qa_report('42222222-2222-4222-8222-222222222222')$$,'P0001','scan_not_terminal','queued scans cannot masquerade as reports');
select throws_ok($$select public.create_qa_report('44444444-4444-4444-8444-444444444444')$$,'P0001','scan_data_inconsistent','incomplete completed records rejected');
select lives_ok($$select public.create_qa_report('43333333-3333-4333-8333-333333333333')$$,'timed out scans can produce diagnostics');
select is((select kind from public.qa_reports where scan_run_id='43333333-3333-4333-8333-333333333333'),'diagnostic','failed coverage labeled diagnostic');
select throws_ok($$update public.qa_reports set kind='qa'$$,'42501',null,'client cannot relabel diagnostics');
select throws_ok($$insert into public.qa_reports(scan_run_id,project_id,project_name,target_url,kind,created_by) values ('45555555-5555-4555-8555-555555555555','32222222-2222-4222-8222-222222222222','Forged','https://evil.invalid','qa',auth.uid())$$,'42501',null,'client cannot forge report metadata');
select throws_ok($$update public.scan_checks set outcome='pass'$$,'42501',null,'automated observations immutable to clients');
select lives_ok($$select public.save_qa_triage(pg_temp.qa_id(),pg_temp.check_id('links'),'high','investigating','Reproduce the fixture failure.',1,'{}')$$,'owner can triage');
select is((select outcome from public.scan_checks where id=pg_temp.check_id('links')),'fail','manual triage preserves automated failure');
select is((select failed_count from public.scan_runs where id='41111111-1111-4111-8111-111111111111'),1,'automated counts preserved');
select is((select severity from public.qa_finding_triage where report_id=pg_temp.qa_id() and scan_check_id=pg_temp.check_id('links')),'high','human severity stored separately');
select throws_ok($$select public.save_qa_triage(pg_temp.qa_id(),pg_temp.check_id('links'),'low','open','Stale',1,'{}')$$,'P0001','stale_triage','lost updates prevented');
select throws_ok($$select public.save_qa_triage(pg_temp.qa_id(),pg_temp.check_id('links'),'automatic-critical','open','Bad',2,'{}')$$,'P0001','invalid_triage','invalid severity rejected');
select throws_ok($$select public.save_qa_triage(pg_temp.qa_id(),pg_temp.check_id('links'),'high','passed','Bad',2,'{}')$$,'P0001','invalid_triage','invalid resolution rejected');
select lives_ok($$select public.save_qa_triage(pg_temp.qa_id(),pg_temp.check_id('links'),'medium','resolved','<img src="http://127.0.0.1/secret"> is plain text.',2,array[pg_temp.check_id('desktop')])$$,'owner can resolve and attach existing screenshot');
select is((select count(*) from public.qa_finding_evidence where report_id=pg_temp.qa_id()),1::bigint,'existing evidence reference attached');
select throws_ok($$select public.save_qa_triage(pg_temp.qa_id(),pg_temp.check_id('links'),'medium','resolved','Bad evidence',3,array[(select id from public.scan_checks where scan_run_id='45555555-5555-4555-8555-555555555555')])$$,'P0001','invalid_evidence','cross-user screenshot rejected');
select lives_ok($$select public.add_qa_comment(pg_temp.qa_id(),pg_temp.check_id('links'),'Developer investigation note.')$$,'owner can append a comment');
select is((select author_id from public.qa_comments limit 1),auth.uid(),'comment author derived from auth');
select throws_ok($$update public.qa_comments set body='Rewritten history'$$,'42501',null,'comments append-only');
select throws_ok($$update public.qa_finding_triage set resolution='ignored'$$,'42501',null,'triage cannot bypass revision checks');
insert into qa_test_state values('export',public.claim_qa_export(pg_temp.qa_id()));
select throws_ok($$select public.claim_qa_export(pg_temp.qa_id())$$,'P0001','export_busy','concurrent export blocked');
select throws_ok($$select * from public.qa_export_leases$$,'42501',null,'export lease internals private');
select set_config('request.jwt.claims','{"sub":"22224444-2222-4222-8222-222222222222","role":"authenticated"}',true);
select is((select count(*) from public.qa_reports),0::bigint,'cross-user reports hidden');
select is((select count(*) from public.qa_finding_triage),0::bigint,'cross-user triage hidden');
select is((select count(*) from public.qa_comments),0::bigint,'cross-user comments hidden');
select is((select count(*) from public.qa_finding_evidence),0::bigint,'cross-user evidence hidden');
select throws_ok($$select public.create_qa_report('41111111-1111-4111-8111-111111111111')$$,'42501','not_authorized','cross-user report generation denied');
select throws_ok($$select public.save_qa_triage(pg_temp.qa_id(),pg_temp.check_id('links'),'critical','ignored','Intrusion',3,'{}')$$,'42501','not_authorized','cross-user triage denied');
select throws_ok($$select public.add_qa_comment(pg_temp.qa_id(),pg_temp.check_id('links'),'Intrusion')$$,'42501','not_authorized','cross-user comments denied');
select throws_ok($$select public.claim_qa_export(pg_temp.qa_id())$$,'42501','not_authorized','cross-user PDF export denied');
select lives_ok($$select public.release_qa_export((select value from qa_test_state where key='export'))$$,'foreign token release has no effect');
select set_config('request.jwt.claims','{"sub":"11114444-1111-4111-8111-111111111111","role":"authenticated"}',true);
select throws_ok($$select public.claim_qa_export(pg_temp.qa_id())$$,'P0001','export_busy','other user cannot release an export');
select lives_ok($$select public.release_qa_export((select value from qa_test_state where key='export'))$$,'owner releases export');
select throws_ok($$select public.claim_qa_export(pg_temp.qa_id())$$,'P0001','export_cooldown','PDF cooldown enforced');

reset role;
update public.scan_runs set created_at=now()-interval '40 days' where id='41111111-1111-4111-8111-111111111111';
insert into public.qa_comments(report_id,scan_check_id,author_id,body)
 select pg_temp.qa_id(),pg_temp.check_id('links'),'11114444-1111-4111-8111-111111111111','Bounded fixture comment '||n from generate_series(1,29) n;
update public.scan_runs set status='running',started_at=now(),lease_token='88888888-8888-4888-8888-888888888888',lease_until=now()+interval '3 minutes' where id='42222222-2222-4222-8222-222222222222';
set local role service_role;
select is(public.record_scan_configuration('42222222-2222-4222-8222-222222222222','88888888-8888-4888-8888-888888888888','{"mode":"local","max_links":5}'),true,'worker records actual leased execution configuration');
select is(public.record_scan_configuration('42222222-2222-4222-8222-222222222222','99999999-9999-4999-8999-999999999999','{"mode":"local"}'),false,'stale worker cannot overwrite execution context');
reset role;
select is((select configuration_snapshot->>'source' from public.scan_runs where id='42222222-2222-4222-8222-222222222222'),'worker_attempt','context provenance explicit');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11114444-1111-4111-8111-111111111111","role":"authenticated"}',true);
select is((select count(*) from storage.objects where bucket_id='scan-artifacts'),0::bigint,'report does not extend artifact retention');
select lives_ok($$select public.save_qa_triage(pg_temp.qa_id(),pg_temp.check_id('links'),'medium','resolved','Retain metadata reference only.',3,array[pg_temp.check_id('desktop')])$$,'existing expired reference preserved without access extension');
select throws_ok($$select public.save_qa_triage(pg_temp.qa_id(),pg_temp.check_id('links'),'medium','resolved','New expired attachment',4,array[pg_temp.check_id('mobile')])$$,'P0001','evidence_unavailable','new expired evidence cannot be attached');
select throws_ok($$select public.add_qa_comment(pg_temp.qa_id(),pg_temp.check_id('links'),'Comment 31')$$,'P0001','comment_limit','comment storage bounded');
select throws_ok($$select public.record_scan_configuration('42222222-2222-4222-8222-222222222222','88888888-8888-4888-8888-888888888888','{}')$$,'42501',null,'client cannot forge execution configuration');
delete from public.projects where id='31111111-1111-4111-8111-111111111111';
select is((select count(*) from public.qa_reports),0::bigint,'report access removed after project deletion');
select throws_ok($$select public.claim_qa_export(pg_temp.qa_id())$$,'42501','not_authorized','deleted project cannot be exported');
reset role;
select is((select count(*) from public.qa_reports where id=pg_temp.qa_id()),0::bigint,'report metadata cascades with deleted scan/project');
select is((select count(*) from public.qa_comments),0::bigint,'deleted report comments cascade');
select is((select count(*) from public.qa_finding_evidence),0::bigint,'deleted report evidence links cascade');
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select throws_ok($$select * from public.qa_reports$$,'42501',null,'anonymous report access denied');
select throws_ok($$select public.create_qa_report('41111111-1111-4111-8111-111111111111')$$,'42501',null,'anonymous report creation denied');
select * from finish();
rollback;

