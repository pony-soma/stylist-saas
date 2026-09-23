begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Server-only entry point. LINE identity must be verified by the API, never by the browser.
-- Existing ownership policies and anonymous table access stay unchanged.
create function public.save_verified_liff_booking(p_stylist_id uuid, p_line_user_id text, p_display_name text,
  p_start_time timestamptz, p_menu_ids uuid[], p_menu_note text, p_request_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  customer_id uuid;
  result_id uuid;
  replay public.booking_requests%rowtype;
  menu_count integer;
  duration_minutes bigint;
  account public.billing_accounts%rowtype;
begin
  if p_stylist_id is null or p_request_id is null or p_line_user_id is null or p_line_user_id !~ '^U[0-9a-fA-F]{32}$'
    or p_display_name is null or length(trim(p_display_name)) not between 1 and 50
    or p_menu_ids is null or cardinality(p_menu_ids) not between 1 and 20
    or array_position(p_menu_ids,null) is not null or cardinality(p_menu_ids)<>(select count(distinct x) from unnest(p_menu_ids) x)
    or p_start_time is null or not isfinite(p_start_time) or coalesce(length(p_menu_note),0)>5000 then
    raise exception 'Invalid request' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('lino:schedule:'||p_stylist_id::text,0));
  select * into account from public.billing_accounts where stylist_id=p_stylist_id for share;
  if not found or (not account.is_master and not coalesce(account.stripe_status in ('active','trialing') and account.period_end>clock_timestamp(),false)) then
    raise exception 'Active access required' using errcode='42501';
  end if;
  select * into replay from public.booking_requests where stylist_id=p_stylist_id and request_id=p_request_id;
  if found then
    -- A replay cannot reassign another customer's booking or reopen a cancelled booking.
    if not exists(select 1 from public.bookings b join public.customers c on c.id=b.customer_id
      where b.id=replay.booking_id and b.stylist_id=p_stylist_id and b.source='liff' and c.line_user_id=p_line_user_id)
      or replay.payload->'start' is distinct from to_jsonb(p_start_time)
      or replay.payload->'menus' is distinct from to_jsonb(p_menu_ids)
      or replay.payload->>'note' is distinct from coalesce(p_menu_note,'') then
      raise exception 'Request conflict' using errcode='40001';
    end if;
    return replay.booking_id;
  end if;
  if p_start_time<=clock_timestamp() then raise exception 'Past time' using errcode='22023'; end if;
  select count(*),sum(m.duration) into menu_count,duration_minutes
    from (select duration from public.menus where stylist_id=p_stylist_id and id=any(p_menu_ids) for share) m;
  if menu_count<>cardinality(p_menu_ids) or duration_minutes not between 1 and 1440 then
    raise exception 'Invalid menus' using errcode='22023';
  end if;
  insert into public.customers(line_user_id,display_name) values(p_line_user_id,p_display_name)
    on conflict(line_user_id) do nothing;
  select id into customer_id from public.customers where line_user_id=p_line_user_id;
  insert into public.stylist_customers(stylist_id,customer_id) values(p_stylist_id,customer_id) on conflict do nothing;
  result_id:=public.save_proxy_booking(p_stylist_id,customer_id,p_start_time,
    p_start_time+make_interval(mins=>duration_minutes::integer),p_menu_ids,coalesce(p_menu_note,''),p_request_id);
  update public.bookings set source='liff',status='pending' where id=result_id;
  return result_id;
end $$;
revoke all on function public.save_verified_liff_booking(uuid,text,text,timestamptz,uuid[],text,uuid) from public,anon,authenticated;
grant execute on function public.save_verified_liff_booking(uuid,text,text,timestamptz,uuid[],text,uuid) to service_role;
commit;
