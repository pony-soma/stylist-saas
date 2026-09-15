-- STAGING ONLY: synthetic fixtures are rolled back.
begin;
set local statement_timeout = '30s';
create function pg_temp.expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if sqlstate = expected then return; end if;
    raise;
  end;
  raise exception 'Expected SQLSTATE %',expected;
end $$;
insert into auth.users(id,email) values ('eeeeeeee-0000-4000-8000-000000000001','medical-a@example.invalid'),('eeeeeeee-0000-4000-8000-000000000002','medical-b@example.invalid');
insert into public.stylists(id,name) values ('eeeeeeee-0000-4000-8000-000000000001','Synthetic A'),('eeeeeeee-0000-4000-8000-000000000002','Synthetic B');
insert into public.billing_accounts(stylist_id,is_master,stripe_status,period_end) values
('eeeeeeee-0000-4000-8000-000000000001',false,'trialing',now()+interval '1 day'),
('eeeeeeee-0000-4000-8000-000000000002',true,null,null);
insert into public.customers(id,line_user_id,display_name) values ('eeeeeeee-0000-4000-8000-000000000010','synthetic-medical-customer','Synthetic customer');
insert into public.stylist_customers(stylist_id,customer_id) values ('eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000010');
set local role service_role;
select public.save_medical_record('eeeeeeee-0000-4000-8000-000000000001','create','eeeeeeee-0000-4000-8000-000000000030','eeeeeeee-0000-4000-8000-000000000010','2026-09-15','Cut','','',null);
select public.save_medical_record('eeeeeeee-0000-4000-8000-000000000001','create','eeeeeeee-0000-4000-8000-000000000030','eeeeeeee-0000-4000-8000-000000000010','2026-09-15','Cut','','',null);
do $$ begin if (select count(*) from public.medical_records where id='eeeeeeee-0000-4000-8000-000000000030')<>1 then raise exception 'Duplicate'; end if; end $$;
select public.save_medical_record('eeeeeeee-0000-4000-8000-000000000001','update','eeeeeeee-0000-4000-8000-000000000030',null,'2026-09-15','Cut','','edited','0');
select public.save_medical_record('eeeeeeee-0000-4000-8000-000000000001','create','eeeeeeee-0000-4000-8000-000000000030','eeeeeeee-0000-4000-8000-000000000010','2026-09-15','Cut','','',null);
do $$ begin if not exists(select 1 from public.medical_records where id='eeeeeeee-0000-4000-8000-000000000030' and revision=1 and notes='edited') then raise exception 'Replay overwrote edit'; end if; end $$;
select pg_temp.expect_error($q$select public.save_medical_record('eeeeeeee-0000-4000-8000-000000000001','create','eeeeeeee-0000-4000-8000-000000000030','eeeeeeee-0000-4000-8000-000000000010','2026-09-15','Cut','','different',null)$q$,'40001');
select pg_temp.expect_error($q$select public.save_medical_record('eeeeeeee-0000-4000-8000-000000000001','update','eeeeeeee-0000-4000-8000-000000000030',null,'2026-09-15','Cut','','','0')$q$,'40001');
select pg_temp.expect_error($q$select public.save_medical_record('eeeeeeee-0000-4000-8000-000000000002','create','eeeeeeee-0000-4000-8000-000000000030','eeeeeeee-0000-4000-8000-000000000010','2026-09-15','Cut','','',null)$q$,'P0002');
select pg_temp.expect_error($q$select public.save_medical_record('eeeeeeee-0000-4000-8000-000000000002','update','eeeeeeee-0000-4000-8000-000000000030',null,'2026-09-15','Cut','','','1')$q$,'P0002');
select pg_temp.expect_error($q$select public.save_medical_record('eeeeeeee-0000-4000-8000-000000000001','update','eeeeeeee-0000-4000-8000-000000000030','eeeeeeee-0000-4000-8000-000000000010','2026-09-15','Cut','','','1')$q$,'22023');
select pg_temp.expect_error($q$select public.save_medical_record('eeeeeeee-0000-4000-8000-000000000001','create','eeeeeeee-0000-4000-8000-000000000030','eeeeeeee-0000-4000-8000-000000000010','2026-09-15',' ','','',null)$q$,'22023');
select pg_temp.expect_error($q$select public.save_medical_record('eeeeeeee-0000-4000-8000-000000000001','create','eeeeeeee-0000-4000-8000-000000000030','eeeeeeee-0000-4000-8000-000000000010','2026-02-30','Cut','','',null)$q$,'22008');
select pg_temp.expect_error($q$select public.save_medical_record('eeeeeeee-0000-4000-8000-000000000002','create','eeeeeeee-0000-4000-8000-000000000031','eeeeeeee-0000-4000-8000-000000000010','2026-09-15','Cut','','',null)$q$,'P0002');
reset role;
update public.billing_accounts set period_end=now()-interval '1 second' where stylist_id='eeeeeeee-0000-4000-8000-000000000001';
set local role service_role;
select pg_temp.expect_error($q$select public.save_medical_record('eeeeeeee-0000-4000-8000-000000000001','create','eeeeeeee-0000-4000-8000-000000000030','eeeeeeee-0000-4000-8000-000000000010','2026-09-15','Cut','','',null)$q$,'42501');
select pg_temp.expect_error($q$select public.save_medical_record('eeeeeeee-0000-4000-8000-000000000001','update','eeeeeeee-0000-4000-8000-000000000030',null,'2026-09-15','Cut','','','1')$q$,'42501');
reset role;
set local role anon;
select pg_temp.expect_error($q$select public.save_medical_record('eeeeeeee-0000-4000-8000-000000000001','create','eeeeeeee-0000-4000-8000-000000000030','eeeeeeee-0000-4000-8000-000000000010','2026-09-15','Cut','','',null)$q$,'42501');
select pg_temp.expect_error($q$select * from public.medical_record_requests$q$,'42501');
reset role;
set local role authenticated;
select pg_temp.expect_error($q$select public.save_medical_record('eeeeeeee-0000-4000-8000-000000000001','create','eeeeeeee-0000-4000-8000-000000000030','eeeeeeee-0000-4000-8000-000000000010','2026-09-15','Cut','','',null)$q$,'42501');
select pg_temp.expect_error($q$select * from public.medical_record_requests$q$,'42501');
reset role;
select 'PASS: medical create replay survives edit, changed payload conflict, stale revision, foreign owner/customer isolation, validation, expired/client denial; fixtures rolled back' as result;
rollback;
