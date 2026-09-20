-- STAGING ONLY: requires the deny-only staging bootstrap.
-- Production needs a separately reviewed migration that removes its broad policies.
-- Existing data is not changed. Reads remain available after billing expiration.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$ begin
  if exists (select 1 from pg_policies where schemaname = 'public'
    and tablename in ('bookings','menus','availability_settings','blocked_time_slots','customer_memos')) then
    raise exception 'Expected staging deny-only policies; refusing unknown policy composition';
  end if;
end $$;

alter table public.bookings enable row level security;
revoke all on public.bookings from public, anon, authenticated;
grant select on public.bookings to authenticated;
grant all on public.bookings to service_role;
create policy bookings_read_owner on public.bookings
  for select to authenticated using (stylist_id = (select auth.uid()));

alter table public.menus enable row level security;
revoke all on public.menus from public, anon, authenticated;
grant select on public.menus to authenticated;
grant all on public.menus to service_role;
create policy menus_read_owner on public.menus
  for select to authenticated using (stylist_id = (select auth.uid()));

alter table public.availability_settings enable row level security;
revoke all on public.availability_settings from public, anon, authenticated;
grant select on public.availability_settings to authenticated;
grant all on public.availability_settings to service_role;
create policy availability_settings_read_owner on public.availability_settings
  for select to authenticated using (stylist_id = (select auth.uid()));

alter table public.blocked_time_slots enable row level security;
revoke all on public.blocked_time_slots from public, anon, authenticated;
grant select on public.blocked_time_slots to authenticated;
grant all on public.blocked_time_slots to service_role;
create policy blocked_time_slots_read_owner on public.blocked_time_slots
  for select to authenticated using (stylist_id = (select auth.uid()));

alter table public.customer_memos enable row level security;
revoke all on public.customer_memos from public, anon, authenticated;
grant select on public.customer_memos to authenticated;
grant all on public.customer_memos to service_role;
create policy customer_memos_read_owner on public.customer_memos
  for select to authenticated using (stylist_id = (select auth.uid()));

-- No master bypass, client writes, public booking details, or billing checks.
commit;
