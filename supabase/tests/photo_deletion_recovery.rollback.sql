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
insert into public.medical_records(id,stylist_id,customer_id,visit_date,treatment_menu) values
('eeeeeeee-0000-4000-8000-000000000030','eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000010','2026-09-15','Cut');
insert into public.record_photos(id,record_id,storage_path) values
('eeeeeeee-0000-4000-8000-000000000040','eeeeeeee-0000-4000-8000-000000000030','synthetic/a.jpg'),
('eeeeeeee-0000-4000-8000-000000000041','eeeeeeee-0000-4000-8000-000000000030','synthetic/shared.jpg'),
('eeeeeeee-0000-4000-8000-000000000042','eeeeeeee-0000-4000-8000-000000000030','synthetic/shared.jpg'),
('eeeeeeee-0000-4000-8000-000000000043','eeeeeeee-0000-4000-8000-000000000030','../unsafe.jpg');
set local role service_role;
select pg_temp.expect_error($q$select public.request_photo_deletion('eeeeeeee-0000-4000-8000-000000000002','eeeeeeee-0000-4000-8000-000000000040')$q$,'P0002');
select pg_temp.expect_error($q$select public.request_photo_deletion('eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000041')$q$,'40001');
select pg_temp.expect_error($q$select public.request_photo_deletion('eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000043')$q$,'22023');
select public.request_photo_deletion('eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000040');
select pg_temp.expect_error($q$update public.photo_deletion_jobs set storage_path='wrong.jpg' where photo_id='eeeeeeee-0000-4000-8000-000000000040'$q$,'42501');
select pg_temp.expect_error($q$update public.photo_deletion_jobs set stylist_id='eeeeeeee-0000-4000-8000-000000000002' where photo_id='eeeeeeee-0000-4000-8000-000000000040'$q$,'42501');
select pg_temp.expect_error($q$update public.photo_deletion_jobs set photo_id='eeeeeeee-0000-4000-8000-000000000049' where photo_id='eeeeeeee-0000-4000-8000-000000000040'$q$,'42501');
select pg_temp.expect_error($q$delete from public.photo_deletion_jobs where photo_id='eeeeeeee-0000-4000-8000-000000000040'$q$,'42501');
do $$ begin
 if public.complete_photo_deletion('eeeeeeee-0000-4000-8000-000000000002','eeeeeeee-0000-4000-8000-000000000040') is distinct from false then raise exception 'Foreign completion accepted'; end if;
 if exists(select 1 from public.photo_deletion_jobs where photo_id='eeeeeeee-0000-4000-8000-000000000040' and completed_at is not null) then raise exception 'Foreign completion changed job'; end if;
end $$;

select public.request_photo_deletion('eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000040');
do $$ begin
 if exists(select 1 from public.record_photos where id='eeeeeeee-0000-4000-8000-000000000040') or
 (select count(*) from public.photo_deletion_jobs where photo_id='eeeeeeee-0000-4000-8000-000000000040' and storage_path='synthetic/a.jpg' and completed_at is null)<>1 then raise exception 'Intent not atomic or replay duplicated'; end if;
end $$;
reset role;
update public.billing_accounts set period_end=now()-interval '1 second' where stylist_id='eeeeeeee-0000-4000-8000-000000000001';
set local role service_role;
select public.request_photo_deletion('eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000040');
select pg_temp.expect_error($q$select public.request_photo_deletion('eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000041')$q$,'42501');
select pg_temp.expect_error($q$select public.request_photo_deletion('eeeeeeee-0000-4000-8000-000000000002','eeeeeeee-0000-4000-8000-000000000040')$q$,'P0002');
select public.complete_photo_deletion('eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000040');
select public.complete_photo_deletion('eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000040');
select public.request_photo_deletion('eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000040');
do $$ begin if not exists(select 1 from public.photo_deletion_jobs where photo_id='eeeeeeee-0000-4000-8000-000000000040' and completed_at is not null) then raise exception 'Completion not retained'; end if; end $$;
reset role;
set local role anon;
select pg_temp.expect_error($q$select public.request_photo_deletion('eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000040')$q$,'42501');
select pg_temp.expect_error($q$select * from public.photo_deletion_jobs$q$,'42501');
select pg_temp.expect_error($q$select public.complete_photo_deletion('eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000040')$q$,'42501');
reset role;
set local role authenticated;
select pg_temp.expect_error($q$select public.request_photo_deletion('eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000040')$q$,'42501');
select pg_temp.expect_error($q$select * from public.photo_deletion_jobs$q$,'42501');
select pg_temp.expect_error($q$select public.complete_photo_deletion('eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000040')$q$,'42501');
reset role;
select 'PASS: durable atomic deletion, shared-path denial, master isolation, initial expiry denial, expired retry, completion replay, client denial; rolled back' as result;
rollback;
