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
insert into auth.users(id,email) values ('cccccccc-0000-4000-8000-000000000001','booking-a@example.invalid'),('cccccccc-0000-4000-8000-000000000002','booking-b@example.invalid');
insert into public.stylists(id,name) values ('cccccccc-0000-4000-8000-000000000001','Synthetic A'),('cccccccc-0000-4000-8000-000000000002','Synthetic B');
insert into public.billing_accounts(stylist_id,is_master,stripe_status,period_end) values
('cccccccc-0000-4000-8000-000000000001',false,'trialing',now()+interval '1 day'),
('cccccccc-0000-4000-8000-000000000002',true,null,null);
insert into public.customers(id,line_user_id,display_name) values ('cccccccc-0000-4000-8000-000000000010','synthetic-booking-customer','Synthetic customer');
insert into public.stylist_customers(stylist_id,customer_id) values ('cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010');
insert into public.menus(id,stylist_id,name,duration,price) values
('cccccccc-0000-4000-8000-000000000020','cccccccc-0000-4000-8000-000000000001','Synthetic cut',60,4500),
('cccccccc-0000-4000-8000-000000000021','cccccccc-0000-4000-8000-000000000002','Foreign cut',60,9000);
set local role service_role;
do $$ declare b uuid; again uuid; version timestamptz; before_count bigint; begin
 b:=public.save_proxy_booking('cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','2026-10-01 10:00+09','2026-10-01 10:30+09',array['cccccccc-0000-4000-8000-000000000020']::uuid[],'test','cccccccc-0000-4000-8000-000000000030');
 again:=public.save_proxy_booking('cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','2026-10-01 10:00+09','2026-10-01 10:30+09',array['cccccccc-0000-4000-8000-000000000020']::uuid[],'test','cccccccc-0000-4000-8000-000000000030');
 if b<>again or not exists(select 1 from public.bookings where id=b and total_price=4500 and source='proxy' and status='confirmed' and selected_menus->0->>'name'='Synthetic cut') then raise exception 'Replay/price snapshot failed'; end if;
 select count(*) into before_count from public.bookings where stylist_id='cccccccc-0000-4000-8000-000000000001';
 if before_count<>1 then raise exception 'Duplicate booking'; end if;
 select updated_at into version from public.bookings where id=b;
 perform public.save_proxy_booking('cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','2026-10-01 11:00+09','2026-10-01 12:00+09',array[]::uuid[],'edited',null,b,version);
 begin
   perform public.save_proxy_booking('cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','2026-10-01 11:00+09','2026-10-01 12:00+09',array[]::uuid[],'stale',null,b,version);
   raise exception 'Stale edit accepted';
 exception when serialization_failure then null; end;
 -- A second overlapping reservation is intentionally allowed.
 perform public.save_proxy_booking('cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','2026-10-01 11:00+09','2026-10-01 12:00+09',array[]::uuid[],'overlap','cccccccc-0000-4000-8000-000000000031');
end $$;
reset role;
set local role service_role;
select pg_temp.expect_error($q$select public.save_proxy_booking('cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','2026-10-01 10:00+09','2026-10-01 10:30+09',array['cccccccc-0000-4000-8000-000000000020']::uuid[],'different','cccccccc-0000-4000-8000-000000000030')$q$,'40001');
select pg_temp.expect_error($q$select public.save_proxy_booking('cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','2026-10-01 10:00+09','2026-10-01 10:30+09',array['cccccccc-0000-4000-8000-000000000021']::uuid[],'test','cccccccc-0000-4000-8000-000000000032')$q$,'22023');
select pg_temp.expect_error($q$select public.save_proxy_booking('cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','2026-10-01 08:00+09','2026-10-01 10:30+09',array['cccccccc-0000-4000-8000-000000000020']::uuid[],'test','cccccccc-0000-4000-8000-000000000032')$q$,'22023');
select pg_temp.expect_error($q$select public.save_proxy_booking('cccccccc-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000010','2026-10-01 10:00+09','2026-10-01 10:30+09',array['cccccccc-0000-4000-8000-000000000020']::uuid[],'test','cccccccc-0000-4000-8000-000000000032')$q$,'P0002');
reset role;
insert into public.blocked_time_slots(stylist_id,start_time,end_time) values ('cccccccc-0000-4000-8000-000000000001','2026-10-01 10:00+09','2026-10-01 10:30+09');
set local role service_role;
select pg_temp.expect_error($q$select public.save_proxy_booking('cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','2026-10-01 10:00+09','2026-10-01 10:30+09',array['cccccccc-0000-4000-8000-000000000020']::uuid[],'test','cccccccc-0000-4000-8000-000000000032')$q$,'40001');
reset role;
update public.billing_accounts set period_end=now()-interval '1 second' where stylist_id='cccccccc-0000-4000-8000-000000000001';
set local role service_role;
select pg_temp.expect_error($q$select public.save_proxy_booking('cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','2026-10-01 10:00+09','2026-10-01 10:30+09',array['cccccccc-0000-4000-8000-000000000020']::uuid[],'test','cccccccc-0000-4000-8000-000000000032')$q$,'42501');
reset role;
set local role anon;
select pg_temp.expect_error($q$select public.save_proxy_booking('cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','2026-10-01 10:00+09','2026-10-01 10:30+09',array['cccccccc-0000-4000-8000-000000000020']::uuid[],'test','cccccccc-0000-4000-8000-000000000032')$q$,'42501');
select pg_temp.expect_error('select * from public.booking_requests','42501');
reset role;
set local role authenticated;
select pg_temp.expect_error($q$select public.save_proxy_booking('cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','2026-10-01 10:00+09','2026-10-01 10:30+09',array['cccccccc-0000-4000-8000-000000000020']::uuid[],'test','cccccccc-0000-4000-8000-000000000032')$q$,'42501');
select pg_temp.expect_error('select * from public.booking_requests','42501');
reset role;
select 'PASS: atomic booking, live prices, replay/conflict, stale edit, owner/menu isolation, blocked slots, hours, expiry, client denial; fixtures rolled back' as result;
rollback;
