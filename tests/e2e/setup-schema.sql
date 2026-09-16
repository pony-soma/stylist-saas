-- CI ONLY: structural baseline for a fresh, disposable local Supabase instance.
-- Derived from the deny-only staging bootstrap; contains no customer/Auth rows,
-- production identities, credentials, or production's permissive policies.
-- Apply this INSTEAD OF the incomplete May-July legacy migration chain, then
-- apply all tracked migrations starting with 20260913224403 in filename order.
-- The runner must reject non-loopback database/API URLs before applying SQL.
-- Refuses any existing public tables; never use as a hosted deployment migration.
begin;
set local search_path = public, pg_catalog;
do $$ begin if exists(select 1 from pg_tables where schemaname='public') then raise exception 'Expected empty public schema; refusing overwrite'; end if; end $$;
create table public."availability_settings" (
  "id" uuid default gen_random_uuid() not null,
  "stylist_id" uuid not null,
  "day_of_week" integer,
  "specific_date" date,
  "start_time" time without time zone,
  "end_time" time without time zone,
  "is_day_off" boolean default false not null
);
create table public."blocked_time_slots" (
  "id" uuid default gen_random_uuid() not null,
  "stylist_id" uuid not null,
  "title" character varying(100) default '予約不可'::character varying not null,
  "start_time" timestamp with time zone not null,
  "end_time" timestamp with time zone not null,
  "created_at" timestamp with time zone default now() not null
);
create table public."bookings" (
  "id" uuid default gen_random_uuid() not null,
  "customer_id" uuid not null,
  "stylist_id" uuid not null,
  "start_time" timestamp with time zone not null,
  "end_time" timestamp with time zone not null,
  "status" character varying(20) not null,
  "menu_note" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "source" character varying(50) default 'liff'::character varying,
  "selected_menus" jsonb default '[]'::jsonb,
  "total_price" integer default 0
);
create table public."customer_memos" (
  "id" uuid default gen_random_uuid() not null,
  "stylist_id" uuid not null,
  "customer_id" uuid not null,
  "memo" text default ''::text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "birth_date" date,
  "address" text,
  "gender" character varying(50)
);
create table public."customers" (
  "id" uuid default gen_random_uuid() not null,
  "line_user_id" character varying(255) not null,
  "display_name" character varying(50) not null,
  "phone_number" character varying(20),
  "created_at" timestamp with time zone default now() not null,
  "line_picture_url" text
);
create table public."medical_records" (
  "id" uuid default gen_random_uuid() not null,
  "customer_id" uuid not null,
  "booking_id" uuid,
  "visit_date" date not null,
  "treatment_menu" character varying(255),
  "chemicals_used" text,
  "notes" text,
  "created_at" timestamp with time zone default now() not null
);
create table public."menus" (
  "id" uuid default gen_random_uuid() not null,
  "stylist_id" uuid not null,
  "name" character varying(100) not null,
  "duration" integer not null,
  "price" integer not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."record_photos" (
  "id" uuid default gen_random_uuid() not null,
  "record_id" uuid not null,
  "storage_path" text not null,
  "uploaded_at" timestamp with time zone default now() not null
);
create table public."stylists" (
  "id" uuid not null,
  "name" character varying(50) not null,
  "payment_customer_id" character varying(255),
  "created_at" timestamp with time zone default now() not null,
  "line_user_id" character varying(255),
  "theme" character varying(20) default 'light'::character varying
);
create table public."subscriptions" (
  "id" uuid default gen_random_uuid() not null,
  "stylist_id" uuid not null,
  "status" character varying(50) not null,
  "plan_id" character varying(100) not null,
  "current_period_start" timestamp with time zone not null,
  "current_period_end" timestamp with time zone not null,
  "cancel_at_period_end" boolean default false,
  "updated_at" timestamp with time zone default now() not null
);
alter table public."availability_settings" add constraint "availability_settings_day_of_week_check" CHECK (day_of_week >= 0 AND day_of_week <= 6);
alter table public."availability_settings" add constraint "availability_settings_pkey" PRIMARY KEY (id);
alter table public."blocked_time_slots" add constraint "blocked_time_slots_pkey" PRIMARY KEY (id);
alter table public."bookings" add constraint "bookings_pkey" PRIMARY KEY (id);
alter table public."bookings" add constraint "bookings_status_check" CHECK (status::text = ANY (ARRAY['pending'::character varying, 'confirmed'::character varying, 'completed'::character varying, 'cancelled'::character varying]::text[]));
alter table public."customer_memos" add constraint "customer_memos_pkey" PRIMARY KEY (id);
alter table public."customer_memos" add constraint "customer_memos_stylist_id_customer_id_key" UNIQUE (stylist_id, customer_id);
alter table public."customers" add constraint "customers_line_user_id_key" UNIQUE (line_user_id);
alter table public."customers" add constraint "customers_pkey" PRIMARY KEY (id);
alter table public."medical_records" add constraint "medical_records_pkey" PRIMARY KEY (id);
alter table public."menus" add constraint "menus_pkey" PRIMARY KEY (id);
alter table public."record_photos" add constraint "record_photos_pkey" PRIMARY KEY (id);
alter table public."stylists" add constraint "stylists_payment_customer_id_key" UNIQUE (payment_customer_id);
alter table public."stylists" add constraint "stylists_pkey" PRIMARY KEY (id);
alter table public."subscriptions" add constraint "subscriptions_pkey" PRIMARY KEY (id);
alter table public."subscriptions" add constraint "subscriptions_status_check" CHECK (status::text = ANY (ARRAY['active'::character varying, 'trialing'::character varying, 'past_due'::character varying, 'canceled'::character varying]::text[]));
alter table public."subscriptions" add constraint "subscriptions_stylist_id_key" UNIQUE (stylist_id);
alter table public."availability_settings" add constraint "availability_settings_stylist_id_fkey" FOREIGN KEY (stylist_id) REFERENCES stylists(id) ON DELETE CASCADE;
alter table public."blocked_time_slots" add constraint "blocked_time_slots_stylist_id_fkey" FOREIGN KEY (stylist_id) REFERENCES stylists(id) ON DELETE CASCADE;
alter table public."bookings" add constraint "bookings_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
alter table public."bookings" add constraint "bookings_stylist_id_fkey" FOREIGN KEY (stylist_id) REFERENCES stylists(id) ON DELETE CASCADE;
alter table public."customer_memos" add constraint "customer_memos_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
alter table public."customer_memos" add constraint "customer_memos_stylist_id_fkey" FOREIGN KEY (stylist_id) REFERENCES stylists(id) ON DELETE CASCADE;
alter table public."medical_records" add constraint "medical_records_booking_id_fkey" FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL;
alter table public."medical_records" add constraint "medical_records_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
alter table public."menus" add constraint "menus_stylist_id_fkey" FOREIGN KEY (stylist_id) REFERENCES stylists(id) ON DELETE CASCADE;
alter table public."record_photos" add constraint "record_photos_record_id_fkey" FOREIGN KEY (record_id) REFERENCES medical_records(id) ON DELETE CASCADE;
alter table public."subscriptions" add constraint "subscriptions_stylist_id_fkey" FOREIGN KEY (stylist_id) REFERENCES stylists(id) ON DELETE CASCADE;
alter table public."availability_settings" enable row level security;
revoke all on public."availability_settings" from public, anon, authenticated;
grant all on public."availability_settings" to service_role;
alter table public."blocked_time_slots" enable row level security;
revoke all on public."blocked_time_slots" from public, anon, authenticated;
grant all on public."blocked_time_slots" to service_role;
alter table public."bookings" enable row level security;
revoke all on public."bookings" from public, anon, authenticated;
grant all on public."bookings" to service_role;
alter table public."customer_memos" enable row level security;
revoke all on public."customer_memos" from public, anon, authenticated;
grant all on public."customer_memos" to service_role;
alter table public."customers" enable row level security;
revoke all on public."customers" from public, anon, authenticated;
grant all on public."customers" to service_role;
alter table public."medical_records" enable row level security;
revoke all on public."medical_records" from public, anon, authenticated;
grant all on public."medical_records" to service_role;
alter table public."menus" enable row level security;
revoke all on public."menus" from public, anon, authenticated;
grant all on public."menus" to service_role;
alter table public."record_photos" enable row level security;
revoke all on public."record_photos" from public, anon, authenticated;
grant all on public."record_photos" to service_role;
alter table public."stylists" enable row level security;
revoke all on public."stylists" from public, anon, authenticated;
grant all on public."stylists" to service_role;
alter table public."subscriptions" enable row level security;
revoke all on public."subscriptions" from public, anon, authenticated;
grant all on public."subscriptions" to service_role;
grant select, insert, update on public.stylists to authenticated;
create policy stylist_read_self on public.stylists for select to authenticated using ((select auth.uid()) = id);
create policy stylist_insert_self on public.stylists for insert to authenticated with check ((select auth.uid()) = id);
create policy stylist_update_self on public.stylists for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create table public.billing_accounts (
  stylist_id uuid primary key references auth.users(id) on delete restrict,
  is_master boolean not null default false,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_status text,
  period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  trial_started_at timestamptz,
  trial_ended_at timestamptz,
  checkout_attempt uuid,
  checkout_session_id text,
  checkout_expires_at timestamptz,
  checkout_trial boolean,
  consent_at timestamptz,
  consent_version text,
  lock_token uuid,
  lock_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.billing_accounts enable row level security;
revoke all on public.billing_accounts from public, anon, authenticated;
grant select on public.billing_accounts to authenticated;
grant all on public.billing_accounts to service_role;
create policy "Read own billing account" on public.billing_accounts for select to authenticated using ((select auth.uid()) = stylist_id);
create function public.acquire_billing_lock(account_id uuid) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare token uuid := gen_random_uuid();
begin
  update public.billing_accounts set lock_token = token, lock_until = now() + interval '2 minutes'
  where stylist_id = account_id and (lock_until is null or lock_until < now());
  if found then return token; end if;
  return null;
end;
$$;
revoke all on function public.acquire_billing_lock(uuid) from public, anon, authenticated;
grant execute on function public.acquire_billing_lock(uuid) to service_role;
-- Storage objects are written by the server's service role and read through
-- the authenticated application API. There are intentionally no client policies.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('record-photos', 'record-photos', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp']);
commit;
