-- STAGING ONLY: execute as postgres after migration. All synthetic changes roll back.
begin;
set local statement_timeout = '30s';
create function pg_temp.assert_true(ok boolean, label text) returns void language plpgsql as $$ begin
 if ok is distinct from true then raise exception 'FAIL: %', label; end if;
end $$;
insert into auth.users(id,email) values
 ('dddddddd-0000-4000-8000-000000000001','manual-owner@example.invalid'),
 ('dddddddd-0000-4000-8000-000000000002','manual-expired@example.invalid'),
 ('dddddddd-0000-4000-8000-000000000003','manual-master@example.invalid'),
 ('dddddddd-0000-4000-8000-000000000004','manual-no-profile@example.invalid');
insert into public.stylists(id,name) values
 ('dddddddd-0000-4000-8000-000000000001','Manual Owner'),
 ('dddddddd-0000-4000-8000-000000000002','Manual Expired'),
 ('dddddddd-0000-4000-8000-000000000003','Manual Master');
insert into public.billing_accounts(stylist_id,is_master,stripe_status,period_end) values
 ('dddddddd-0000-4000-8000-000000000001',false,'trialing',now()+interval '1 day'),
 ('dddddddd-0000-4000-8000-000000000002',false,'active',now()-interval '1 second'),
 ('dddddddd-0000-4000-8000-000000000003',true,null,null),
 ('dddddddd-0000-4000-8000-000000000004',true,null,null);
select pg_temp.assert_true(not has_function_privilege('anon','public.create_manual_customer(uuid,text,text,date,text,text)','execute'), 'anon RPC denied');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.create_manual_customer(uuid,text,text,date,text,text)','execute'), 'authenticated RPC denied');
select pg_temp.assert_true(has_function_privilege('service_role','public.create_manual_customer(uuid,text,text,date,text,text)','execute'), 'service RPC granted');
select pg_temp.assert_true(not (select prosecdef from pg_proc where oid='public.create_manual_customer(uuid,text,text,date,text,text)'::regprocedure), 'INVOKER');
set local role service_role;
do $$ declare created uuid; before_count bigint; begin
  created := public.create_manual_customer('dddddddd-0000-4000-8000-000000000001','Manual Synthetic','090-1234-5678',date '2000-02-29','female','Synthetic memo');
  if not exists(select 1 from public.customers c join public.stylist_customers sc on sc.customer_id=c.id
    join public.customer_memos cm on cm.customer_id=c.id and cm.stylist_id=sc.stylist_id
    where c.id=created and sc.stylist_id='dddddddd-0000-4000-8000-000000000001'
      and c.line_user_id='manual_'||created::text and cm.memo='Synthetic memo') then
    raise exception 'FAIL: atomic customer/relation/memo missing';
  end if;
  perform public.create_manual_customer('dddddddd-0000-4000-8000-000000000003','Master Synthetic');
  select count(*) into before_count from public.customers;
  begin
    perform public.create_manual_customer('dddddddd-0000-4000-8000-000000000002','Expired Synthetic');
    raise exception 'FAIL: expired allowed';
  exception when insufficient_privilege then null; end;
  -- FK fails after the customer insert: all inserts must roll back together.
  begin
    perform public.create_manual_customer('dddddddd-0000-4000-8000-000000000004','Missing Profile Synthetic');
    raise exception 'FAIL: missing stylist allowed';
  exception when foreign_key_violation then null; end;
  if (select count(*) from public.customers) <> before_count then raise exception 'FAIL: partial customer left behind'; end if;
end $$;
reset role;
select 'PASS: atomic registration, billing expiry, server identity, INVOKER privileges and failed-insert rollback; fixtures rolled back' as result;
rollback;
