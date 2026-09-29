begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
-- Archive is private to each stylist. Existing ownership, records and photos remain intact.
-- Existing RLS permits only owner reads; writes remain service_role-only.
alter table public.stylist_customers add column archived_at timestamptz;
comment on column public.stylist_customers.archived_at is
  'Hidden from this stylist customer list; null restores visibility. Does not cancel bookings or erase records.';
commit;
