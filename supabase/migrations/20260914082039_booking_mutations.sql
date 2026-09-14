-- STAGING ONLY. Requires ownership, billing and business_owner_reads migrations.
-- All future schedule/blocked-slot writers MUST use this same advisory-lock key
-- before validating bookings and writing. Direct client schedule writes stay denied.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create table public.booking_requests (
  stylist_id uuid not null references public.stylists(id),
  request_id uuid not null,
  payload jsonb not null,
  booking_id uuid not null references public.bookings(id),
  created_at timestamptz not null default now(),
  primary key (stylist_id, request_id)
);
alter table public.booking_requests enable row level security;
revoke all on public.booking_requests from public, anon, authenticated;
grant all on public.booking_requests to service_role;
create function public.save_proxy_booking(
  p_stylist_id uuid, p_customer_id uuid, p_start_time timestamptz, p_end_time timestamptz,
  p_menu_ids uuid[], p_menu_note text, p_request_id uuid default null,
  p_booking_id uuid default null, p_expected_updated_at timestamptz default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  account public.billing_accounts%rowtype;
  previous public.bookings%rowtype;
  replay public.booking_requests%rowtype;
  payload jsonb;
  result_id uuid;
  menu_snapshot jsonb;
  menu_count integer;
  total bigint;
  local_start timestamp := p_start_time at time zone 'Asia/Tokyo';
  local_end timestamp := p_end_time at time zone 'Asia/Tokyo';
  hours public.availability_settings%rowtype;
  hours_count integer;
  opening time := time '09:00';
  closing time := time '21:00';
begin
  if p_stylist_id is null or p_customer_id is null or p_start_time is null or p_end_time is null
    or not isfinite(p_start_time) or not isfinite(p_end_time)
    or p_end_time <= p_start_time or local_start::date <> local_end::date
    or p_menu_ids is null or cardinality(p_menu_ids) > 20 or array_position(p_menu_ids,null) is not null
    or cardinality(p_menu_ids) <> (select count(distinct x) from unnest(p_menu_ids) x)
    or coalesce(length(p_menu_note),0) > 5000
    or (p_booking_id is null and (p_request_id is null or p_expected_updated_at is not null))
    or (p_booking_id is not null and (p_expected_updated_at is null or p_request_id is not null)) then
    raise exception 'Invalid booking' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('lino:schedule:' || p_stylist_id::text,0));
  select * into account from public.billing_accounts where stylist_id=p_stylist_id for share;
  if not found or (not account.is_master and not coalesce(account.stripe_status in ('active','trialing')
      and account.period_end > clock_timestamp(),false)) then
    raise exception 'Active access required' using errcode='42501';
  end if;
  perform 1 from public.stylist_customers where stylist_id=p_stylist_id and customer_id=p_customer_id for share;
  if not found then raise exception 'Customer unavailable' using errcode='P0002'; end if;
  payload := jsonb_build_object('customer',p_customer_id,'start',p_start_time,'end',p_end_time,
    'menus',to_jsonb(p_menu_ids),'note',coalesce(p_menu_note,''));
  if p_booking_id is null then
    select * into replay from public.booking_requests where stylist_id=p_stylist_id and request_id=p_request_id;
    if found then
      if replay.payload <> payload then raise exception 'Request conflict' using errcode='40001'; end if;
      return replay.booking_id;
    end if;
    result_id := gen_random_uuid();
  else
    select * into previous from public.bookings where id=p_booking_id and stylist_id=p_stylist_id for update;
    if not found or previous.customer_id <> p_customer_id then raise exception 'Booking unavailable' using errcode='P0002'; end if;
    if previous.status not in ('pending','confirmed') or previous.updated_at <> p_expected_updated_at then
      raise exception 'Booking changed' using errcode='40001';
    end if;
    result_id := previous.id;
  end if;
  -- Snapshot live menu data under row locks. Caller cannot set names, prices or ownership.
  select count(*), coalesce(sum(m.price),0), coalesce(jsonb_agg(jsonb_build_object(
      'id',m.id,'stylist_id',m.stylist_id,'name',m.name,'duration',m.duration,'price',m.price,'created_at',m.created_at
    ) order by m.id),'[]'::jsonb)
    into menu_count,total,menu_snapshot
    from (select * from public.menus where stylist_id=p_stylist_id and id=any(p_menu_ids) order by id for share) m;
  if menu_count <> cardinality(p_menu_ids) or total not between 0 and 2147483647
    or exists(select 1 from public.menus where id=any(p_menu_ids) and (price<0 or duration<=0)) then
    raise exception 'Invalid menus' using errcode='22023';
  end if;
  -- Existing proxy UI supports manually adjusted duration, including shorter slots.
  -- Preserve that behavior; LIFF creation will derive end time from live menu duration.
  -- Specific-date settings override weekly settings. Missing settings retain existing 09:00-21:00 default.
  select count(*) into hours_count from public.availability_settings
    where stylist_id=p_stylist_id and specific_date=local_start::date;
  if hours_count > 0 then
    if hours_count <> 1 then raise exception 'Ambiguous opening hours' using errcode='22023'; end if;
    select * into hours from public.availability_settings where stylist_id=p_stylist_id and specific_date=local_start::date for share;
  else
    select count(*) into hours_count from public.availability_settings where stylist_id=p_stylist_id
      and specific_date is null and day_of_week=extract(dow from local_start)::integer;
    if hours_count > 1 then raise exception 'Ambiguous opening hours' using errcode='22023'; end if;
    select * into hours from public.availability_settings where stylist_id=p_stylist_id
      and specific_date is null and day_of_week=extract(dow from local_start)::integer for share;
  end if;
  if hours_count > 0 then
    if hours.is_day_off or hours.start_time is null or hours.end_time is null or hours.end_time<=hours.start_time then
      raise exception 'Outside opening hours' using errcode='22023';
    end if;
    opening:=hours.start_time; closing:=hours.end_time;
  end if;
  if local_start::time < opening or local_end::time > closing then
    raise exception 'Outside opening hours' using errcode='22023';
  end if;
  perform 1 from public.blocked_time_slots where stylist_id=p_stylist_id
    and start_time<p_end_time and end_time>p_start_time for share;
  if found then raise exception 'Blocked time' using errcode='40001'; end if;
  -- Recheck wall-clock expiry after all potentially blocking row locks.
  if not account.is_master and not coalesce(account.period_end>clock_timestamp(),false) then
    raise exception 'Active access required' using errcode='42501';
  end if;
  if p_booking_id is null then
    insert into public.bookings(id,stylist_id,customer_id,start_time,end_time,status,source,menu_note,selected_menus,total_price)
    values(result_id,p_stylist_id,p_customer_id,p_start_time,p_end_time,'confirmed','proxy',p_menu_note,menu_snapshot,total::integer);
    insert into public.booking_requests(stylist_id,request_id,payload,booking_id)
    values(p_stylist_id,p_request_id,payload,result_id);
  else
    update public.bookings set start_time=p_start_time,end_time=p_end_time,menu_note=p_menu_note,
      selected_menus=menu_snapshot,total_price=total::integer,updated_at=clock_timestamp()
    where id=result_id and stylist_id=p_stylist_id;
  end if;
  return result_id;
end $$;
revoke all on function public.save_proxy_booking(uuid,uuid,timestamptz,timestamptz,uuid[],text,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.save_proxy_booking(uuid,uuid,timestamptz,timestamptz,uuid[],text,uuid,uuid,timestamptz) to service_role;
commit;
