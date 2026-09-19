-- STAGING ONLY. Production requires a separate reviewed migration and ownership mapping.
-- Prerequisite: staging bootstrap, including service-only business writes.
-- Existing bookings/records remain untouched. NOT VALID preserves legacy data;
-- new/updated rows are constrained immediately. Validate after explicit mapping.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$ begin
  if exists (select 1 from pg_policies where schemaname = 'public'
    and tablename in ('customers', 'medical_records', 'record_photos')) then
    raise exception 'Expected staging deny-only policies; refusing unknown policy composition';
  end if;
end $$;

create table public.stylist_customers (
  stylist_id uuid not null references public.stylists(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (stylist_id, customer_id)
);
create index stylist_customers_customer_idx on public.stylist_customers(customer_id);
alter table public.medical_records add column stylist_id uuid;
alter table public.bookings add constraint bookings_id_stylist_customer_key
  unique (id, stylist_id, customer_id);
alter table public.bookings add constraint bookings_stylist_customer_fkey
  foreign key (stylist_id, customer_id)
  references public.stylist_customers(stylist_id, customer_id) not valid;
alter table public.medical_records add constraint medical_records_stylist_customer_fkey
  foreign key (stylist_id, customer_id)
  references public.stylist_customers(stylist_id, customer_id) not valid;
alter table public.medical_records add constraint medical_records_booking_owner_fkey
  foreign key (booking_id, stylist_id, customer_id)
  references public.bookings(id, stylist_id, customer_id) not valid;
create index medical_records_stylist_customer_idx on public.medical_records(stylist_id, customer_id);
create index medical_records_booking_owner_idx on public.medical_records(booking_id, stylist_id, customer_id);
create index bookings_stylist_customer_idx on public.bookings(stylist_id, customer_id);

alter table public.stylist_customers enable row level security;
alter table public.customers enable row level security;
alter table public.medical_records enable row level security;
alter table public.record_photos enable row level security;
revoke all on public.stylist_customers, public.customers, public.medical_records,
  public.record_photos from public, anon, authenticated;
grant select on public.stylist_customers, public.customers, public.medical_records,
  public.record_photos to authenticated;
grant all on public.stylist_customers, public.customers, public.medical_records,
  public.record_photos to service_role;

create policy stylist_customers_read_self on public.stylist_customers
  for select to authenticated using (stylist_id = (select auth.uid()));
create policy customers_read_related on public.customers
  for select to authenticated using (exists (
    select 1 from public.stylist_customers sc
    where sc.customer_id = customers.id and sc.stylist_id = (select auth.uid())
  ));
create policy medical_records_read_owner on public.medical_records
  for select to authenticated using (stylist_id = (select auth.uid()));
create policy record_photos_read_record_owner on public.record_photos
  for select to authenticated using (exists (
    select 1 from public.medical_records mr
    where mr.id = record_photos.record_id and mr.stylist_id = (select auth.uid())
  ));
-- No billing/master exemption: master is free billing, not cross-tenant access.
-- Other business tables retain their existing deny-only grants and policies.
-- A null stylist_id intentionally remains possible for unassigned historical records;
-- all clients are denied access to such records. Only service_role may write.
commit;
