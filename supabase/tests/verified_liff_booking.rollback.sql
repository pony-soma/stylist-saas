-- Isolated CI fixtures only; never retain test users or bookings.
begin;
set local statement_timeout='30s';
create function pg_temp.expect_liff_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then if sqlstate=expected then return; end if; raise; end;
  raise exception 'Expected SQLSTATE %',expected;
end $$;
insert into auth.users(id,email) values('eeeeeeee-0000-4000-8000-000000000001','liff-check@example.invalid');
insert into public.stylists(id,name) values('eeeeeeee-0000-4000-8000-000000000001','Synthetic LINE stylist');
insert into public.billing_accounts(stylist_id,is_master) values('eeeeeeee-0000-4000-8000-000000000001',true);
insert into public.menus(id,stylist_id,name,duration,price) values('eeeeeeee-0000-4000-8000-000000000020','eeeeeeee-0000-4000-8000-000000000001','Test',45,3000);
set local role service_role;
do $$ declare saved_id uuid; again uuid; begin
  saved_id:=public.save_verified_liff_booking('eeeeeeee-0000-4000-8000-000000000001','Ueeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','Synthetic guest','2035-01-03 10:00+09',array['eeeeeeee-0000-4000-8000-000000000020']::uuid[],'','eeeeeeee-0000-4000-8000-000000000030');
  if not exists(select 1 from public.bookings where bookings.id=saved_id and source='liff' and status='pending' and total_price=3000 and end_time-start_time=interval '45 minutes') then raise exception 'Invalid saved booking'; end if;
  update public.bookings set status='cancelled' where bookings.id=saved_id;
  again:=public.save_verified_liff_booking('eeeeeeee-0000-4000-8000-000000000001','Ueeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','Synthetic guest','2035-01-03 10:00+09',array['eeeeeeee-0000-4000-8000-000000000020']::uuid[],'','eeeeeeee-0000-4000-8000-000000000030');
  if again<>saved_id or not exists(select 1 from public.bookings where bookings.id=saved_id and status='cancelled') then raise exception 'Replay changed booking'; end if;
  if (select count(*) from public.customers where line_user_id='Ueeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')<>1 then raise exception 'Duplicate customer'; end if;
end $$;
select pg_temp.expect_liff_error($q$select public.save_verified_liff_booking('eeeeeeee-0000-4000-8000-000000000001','Uffffffffffffffffffffffffffffffff','Other guest','2035-01-03 10:00+09',array['eeeeeeee-0000-4000-8000-000000000020']::uuid[],'','eeeeeeee-0000-4000-8000-000000000030')$q$,'40001');
select pg_temp.expect_liff_error($q$select public.save_verified_liff_booking('eeeeeeee-0000-4000-8000-000000000001','Uffffffffffffffffffffffffffffffff','Other guest','2000-01-03 10:00+09',array['eeeeeeee-0000-4000-8000-000000000020']::uuid[],'','eeeeeeee-0000-4000-8000-000000000031')$q$,'22023');
reset role;
insert into public.availability_settings(stylist_id,specific_date,is_day_off) values('eeeeeeee-0000-4000-8000-000000000001','2035-01-04',true);
set local role service_role;
select pg_temp.expect_liff_error($q$select public.save_verified_liff_booking('eeeeeeee-0000-4000-8000-000000000001','Uffffffffffffffffffffffffffffffff','Other guest','2035-01-04 10:00+09',array['eeeeeeee-0000-4000-8000-000000000020']::uuid[],'','eeeeeeee-0000-4000-8000-000000000031')$q$,'22023');
do $$ begin if exists(select 1 from public.customers where line_user_id='Uffffffffffffffffffffffffffffffff') then raise exception 'Failed booking left customer behind'; end if; end $$;
reset role;
set local role anon;
select pg_temp.expect_liff_error($q$select public.save_verified_liff_booking('eeeeeeee-0000-4000-8000-000000000001','Uffffffffffffffffffffffffffffffff','Other guest','2035-01-03 10:00+09',array['eeeeeeee-0000-4000-8000-000000000020']::uuid[],'','eeeeeeee-0000-4000-8000-000000000031')$q$,'42501');
reset role;
set local role authenticated;
select pg_temp.expect_liff_error($q$select public.save_verified_liff_booking('eeeeeeee-0000-4000-8000-000000000001','Uffffffffffffffffffffffffffffffff','Other guest','2035-01-03 10:00+09',array['eeeeeeee-0000-4000-8000-000000000020']::uuid[],'','eeeeeeee-0000-4000-8000-000000000031')$q$,'42501');
reset role;
select 'PASS verified LINE booking, pending status, live price/duration, idempotency, identity isolation, closed days, rollback and client denial';
rollback;
