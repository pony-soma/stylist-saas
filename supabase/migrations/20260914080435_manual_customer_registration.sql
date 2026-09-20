-- STAGING ONLY. Requires ownership_foundation and protected billing_accounts.
-- Does not assign existing customer/record ownership or merge identities.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create function public.create_manual_customer(
  p_stylist_id uuid,
  p_display_name text,
  p_phone_number text default null,
  p_birth_date date default null,
  p_gender text default 'unspecified',
  p_memo text default null
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  account public.billing_accounts%rowtype;
  customer_id uuid := gen_random_uuid();
begin
  if p_display_name is null or length(btrim(p_display_name)) not between 1 and 50
    or p_display_name ~ '[[:cntrl:]]'
    or (p_phone_number is not null and p_phone_number !~ '^[+0-9() -]{3,20}$')
    or (p_birth_date is not null and (p_birth_date < date '1900-01-01' or p_birth_date > current_date))
    or p_gender is null or p_gender not in ('unspecified', 'male', 'female', 'other')
    or coalesce(length(p_memo), 0) > 5000 then
    raise exception 'Invalid customer details' using errcode = '22023';
  end if;
  -- Lock against concurrent billing webhook changes; clock_timestamp also catches
  -- access expiring while waiting for this lock. No user-controlled master claim.
  select * into account from public.billing_accounts where stylist_id = p_stylist_id for share;
  if not found then raise exception 'Active access required' using errcode = '42501'; end if;
  if not account.is_master and not coalesce(
    account.stripe_status in ('active', 'trialing') and account.period_end > clock_timestamp(), false
  ) then raise exception 'Active access required' using errcode = '42501'; end if;
  -- New manual identities never reuse a caller-provided LINE ID or existing customer.
  insert into public.customers(id, line_user_id, display_name, phone_number)
  values (customer_id, 'manual_' || customer_id::text, btrim(p_display_name), p_phone_number);
  insert into public.stylist_customers(stylist_id, customer_id) values (p_stylist_id, customer_id);
  insert into public.customer_memos(stylist_id, customer_id, memo, birth_date, gender)
  values (p_stylist_id, customer_id, p_memo, p_birth_date, p_gender);
  return customer_id;
end;
$$;
revoke all on function public.create_manual_customer(uuid,text,text,date,text,text) from public, anon, authenticated;
grant execute on function public.create_manual_customer(uuid,text,text,date,text,text) to service_role;
commit;
