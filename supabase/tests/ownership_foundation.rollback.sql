-- STAGING ONLY: synthetic fixtures, no production rows. Entire test rolls back.
-- Execute as postgres after the ownership migration. Any failure aborts transaction.
begin;
set local statement_timeout = '30s';
create function pg_temp.assert_true(ok boolean, label text) returns void
language plpgsql security invoker as $$ begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
end $$;
create function pg_temp.assert_denied(statement text) returns void
language plpgsql security invoker as $$ begin
  begin
    execute statement;
  exception when insufficient_privilege then return;
  end;
  raise exception 'FAIL: unexpectedly permitted statement: %', statement;
end $$;
create function pg_temp.assert_fk(statement text) returns void
language plpgsql security invoker as $$ begin
  begin
    execute statement;
  exception when foreign_key_violation then return;
  end;
  raise exception 'FAIL: unexpectedly accepted invalid relationship';
end $$;
insert into auth.users (id, email) values ('eeeeeeee-0000-4000-8000-000000000001', 'ownership-1@example.invalid');
insert into public.stylists (id, name) values ('eeeeeeee-0000-4000-8000-000000000001', 'Synthetic 1');
insert into public.billing_accounts (stylist_id, is_master) values ('eeeeeeee-0000-4000-8000-000000000001', false);
insert into auth.users (id, email) values ('eeeeeeee-0000-4000-8000-000000000002', 'ownership-2@example.invalid');
insert into public.stylists (id, name) values ('eeeeeeee-0000-4000-8000-000000000002', 'Synthetic 2');
insert into public.billing_accounts (stylist_id, is_master) values ('eeeeeeee-0000-4000-8000-000000000002', false);
insert into auth.users (id, email) values ('eeeeeeee-0000-4000-8000-000000000003', 'ownership-3@example.invalid');
insert into public.stylists (id, name) values ('eeeeeeee-0000-4000-8000-000000000003', 'Synthetic 3');
insert into public.billing_accounts (stylist_id, is_master) values ('eeeeeeee-0000-4000-8000-000000000003', true);
insert into public.customers (id, line_user_id, display_name) values ('eeeeeeee-0000-4000-8000-000000000010','synthetic-ownership-10','Synthetic 10');
insert into public.customers (id, line_user_id, display_name) values ('eeeeeeee-0000-4000-8000-000000000011','synthetic-ownership-11','Synthetic 11');
insert into public.stylist_customers (stylist_id,customer_id) values ('eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000010');
insert into public.stylist_customers (stylist_id,customer_id) values ('eeeeeeee-0000-4000-8000-000000000002','eeeeeeee-0000-4000-8000-000000000010');
insert into public.bookings (id,stylist_id,customer_id,start_time,end_time,status) values ('eeeeeeee-0000-4000-8000-000000000020','eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000010',now(),now()+interval '1 hour','confirmed');
insert into public.medical_records (id,stylist_id,customer_id,visit_date) values ('eeeeeeee-0000-4000-8000-000000000030','eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000010',current_date);
insert into public.record_photos (id,record_id,storage_path) values ('eeeeeeee-0000-4000-8000-000000000040','eeeeeeee-0000-4000-8000-000000000030','synthetic/0.jpg');
insert into public.medical_records (id,stylist_id,customer_id,visit_date) values ('eeeeeeee-0000-4000-8000-000000000031','eeeeeeee-0000-4000-8000-000000000002','eeeeeeee-0000-4000-8000-000000000010',current_date);
insert into public.record_photos (id,record_id,storage_path) values ('eeeeeeee-0000-4000-8000-000000000041','eeeeeeee-0000-4000-8000-000000000031','synthetic/1.jpg');
insert into public.medical_records (id,stylist_id,customer_id,visit_date) values ('eeeeeeee-0000-4000-8000-000000000032',null,'eeeeeeee-0000-4000-8000-000000000010',current_date);
insert into public.record_photos (id,record_id,storage_path) values ('eeeeeeee-0000-4000-8000-000000000042','eeeeeeee-0000-4000-8000-000000000032','synthetic/2.jpg');
select pg_temp.assert_fk($q$update public.medical_records set booking_id='eeeeeeee-0000-4000-8000-000000000020' where id='eeeeeeee-0000-4000-8000-000000000031'$q$);
select pg_temp.assert_fk($q$update public.medical_records set customer_id='eeeeeeee-0000-4000-8000-000000000011' where id='eeeeeeee-0000-4000-8000-000000000030'$q$);
select pg_temp.assert_fk($q$update public.bookings set customer_id='eeeeeeee-0000-4000-8000-000000000011' where id='eeeeeeee-0000-4000-8000-000000000020'$q$);
select pg_temp.assert_fk($q$delete from public.stylist_customers where stylist_id='eeeeeeee-0000-4000-8000-000000000001'$q$);

-- Actor 1.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"eeeeeeee-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','eeeeeeee-0000-4000-8000-000000000001',true);
select pg_temp.assert_true((select count(*)=1 from public.customers where id::text like 'eeeeeeee-%'),'actor 1 customers only own rows');
select pg_temp.assert_denied($q$insert into public.customers default values$q$);
select pg_temp.assert_denied($q$update public.customers set id=id$q$);
select pg_temp.assert_denied($q$delete from public.customers$q$);
select pg_temp.assert_true((select count(*)=1 from public.stylist_customers where customer_id::text like 'eeeeeeee-%'),'actor 1 stylist_customers only own rows');
select pg_temp.assert_denied($q$insert into public.stylist_customers default values$q$);
select pg_temp.assert_denied($q$update public.stylist_customers set customer_id=customer_id$q$);
select pg_temp.assert_denied($q$delete from public.stylist_customers$q$);
select pg_temp.assert_true((select count(*)=1 from public.medical_records where id::text like 'eeeeeeee-%'),'actor 1 medical_records only own rows');
select pg_temp.assert_true(exists(select 1 from public.medical_records where id='eeeeeeee-0000-4000-8000-000000000030'),'actor 1 correct row identity');
select pg_temp.assert_denied($q$insert into public.medical_records default values$q$);
select pg_temp.assert_denied($q$update public.medical_records set id=id$q$);
select pg_temp.assert_denied($q$delete from public.medical_records$q$);
select pg_temp.assert_true((select count(*)=1 from public.record_photos where id::text like 'eeeeeeee-%'),'actor 1 record_photos only own rows');
select pg_temp.assert_true(exists(select 1 from public.record_photos where id='eeeeeeee-0000-4000-8000-000000000040'),'actor 1 correct row identity');
select pg_temp.assert_denied($q$insert into public.record_photos default values$q$);
select pg_temp.assert_denied($q$update public.record_photos set id=id$q$);
select pg_temp.assert_denied($q$delete from public.record_photos$q$);
select pg_temp.assert_denied($q$update public.stylist_customers set stylist_id='eeeeeeee-0000-4000-8000-000000000001'$q$);
reset role;

-- Actor 2.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"eeeeeeee-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','eeeeeeee-0000-4000-8000-000000000002',true);
select pg_temp.assert_true((select count(*)=1 from public.customers where id::text like 'eeeeeeee-%'),'actor 2 customers only own rows');
select pg_temp.assert_denied($q$insert into public.customers default values$q$);
select pg_temp.assert_denied($q$update public.customers set id=id$q$);
select pg_temp.assert_denied($q$delete from public.customers$q$);
select pg_temp.assert_true((select count(*)=1 from public.stylist_customers where customer_id::text like 'eeeeeeee-%'),'actor 2 stylist_customers only own rows');
select pg_temp.assert_denied($q$insert into public.stylist_customers default values$q$);
select pg_temp.assert_denied($q$update public.stylist_customers set customer_id=customer_id$q$);
select pg_temp.assert_denied($q$delete from public.stylist_customers$q$);
select pg_temp.assert_true((select count(*)=1 from public.medical_records where id::text like 'eeeeeeee-%'),'actor 2 medical_records only own rows');
select pg_temp.assert_true(exists(select 1 from public.medical_records where id='eeeeeeee-0000-4000-8000-000000000031'),'actor 2 correct row identity');
select pg_temp.assert_denied($q$insert into public.medical_records default values$q$);
select pg_temp.assert_denied($q$update public.medical_records set id=id$q$);
select pg_temp.assert_denied($q$delete from public.medical_records$q$);
select pg_temp.assert_true((select count(*)=1 from public.record_photos where id::text like 'eeeeeeee-%'),'actor 2 record_photos only own rows');
select pg_temp.assert_true(exists(select 1 from public.record_photos where id='eeeeeeee-0000-4000-8000-000000000041'),'actor 2 correct row identity');
select pg_temp.assert_denied($q$insert into public.record_photos default values$q$);
select pg_temp.assert_denied($q$update public.record_photos set id=id$q$);
select pg_temp.assert_denied($q$delete from public.record_photos$q$);
select pg_temp.assert_denied($q$update public.stylist_customers set stylist_id='eeeeeeee-0000-4000-8000-000000000002'$q$);
reset role;

-- Actor master (billing exemption only).
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"eeeeeeee-0000-4000-8000-000000000003","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','eeeeeeee-0000-4000-8000-000000000003',true);
select pg_temp.assert_true((select count(*)=0 from public.customers where id::text like 'eeeeeeee-%'),'actor 3 customers only own rows');
select pg_temp.assert_denied($q$insert into public.customers default values$q$);
select pg_temp.assert_denied($q$update public.customers set id=id$q$);
select pg_temp.assert_denied($q$delete from public.customers$q$);
select pg_temp.assert_true((select count(*)=0 from public.stylist_customers where customer_id::text like 'eeeeeeee-%'),'actor 3 stylist_customers only own rows');
select pg_temp.assert_denied($q$insert into public.stylist_customers default values$q$);
select pg_temp.assert_denied($q$update public.stylist_customers set customer_id=customer_id$q$);
select pg_temp.assert_denied($q$delete from public.stylist_customers$q$);
select pg_temp.assert_true((select count(*)=0 from public.medical_records where id::text like 'eeeeeeee-%'),'actor 3 medical_records only own rows');
select pg_temp.assert_denied($q$insert into public.medical_records default values$q$);
select pg_temp.assert_denied($q$update public.medical_records set id=id$q$);
select pg_temp.assert_denied($q$delete from public.medical_records$q$);
select pg_temp.assert_true((select count(*)=0 from public.record_photos where id::text like 'eeeeeeee-%'),'actor 3 record_photos only own rows');
select pg_temp.assert_denied($q$insert into public.record_photos default values$q$);
select pg_temp.assert_denied($q$update public.record_photos set id=id$q$);
select pg_temp.assert_denied($q$delete from public.record_photos$q$);
select pg_temp.assert_denied($q$update public.stylist_customers set stylist_id='eeeeeeee-0000-4000-8000-000000000003'$q$);
reset role;

set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select set_config('request.jwt.claim.sub','',true);
select pg_temp.assert_denied($q$select * from public.customers$q$);
select pg_temp.assert_denied($q$insert into public.customers default values$q$);
select pg_temp.assert_denied($q$delete from public.customers$q$);
select pg_temp.assert_denied($q$select * from public.stylist_customers$q$);
select pg_temp.assert_denied($q$insert into public.stylist_customers default values$q$);
select pg_temp.assert_denied($q$delete from public.stylist_customers$q$);
select pg_temp.assert_denied($q$select * from public.medical_records$q$);
select pg_temp.assert_denied($q$insert into public.medical_records default values$q$);
select pg_temp.assert_denied($q$delete from public.medical_records$q$);
select pg_temp.assert_denied($q$select * from public.record_photos$q$);
select pg_temp.assert_denied($q$insert into public.record_photos default values$q$);
select pg_temp.assert_denied($q$delete from public.record_photos$q$);
reset role;
select 'PASS: ownership isolation, unassigned denial, master isolation, write denial, FK integrity; fixtures rolled back' as result;
rollback;
