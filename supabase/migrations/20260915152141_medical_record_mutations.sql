-- Staging first. No ownership backfill and no client write grants.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.medical_records add column revision bigint not null default 0 check (revision >= 0);
-- Original create payload survives subsequent edits, making retries deterministic.
create table public.medical_record_requests (
  id uuid primary key references public.medical_records(id) on delete cascade,
  stylist_id uuid not null references public.stylists(id),
  payload jsonb not null
);
alter table public.medical_record_requests enable row level security;
revoke all on public.medical_record_requests from public, anon, authenticated;
grant select, insert on public.medical_record_requests to service_role;
create function public.save_medical_record(
 p_stylist_id uuid, p_action text, p_id uuid, p_customer_id uuid,
 p_visit_date date, p_treatment_menu text, p_chemicals_used text, p_notes text, p_expected_revision bigint
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
 account public.billing_accounts%rowtype;
 previous public.medical_records%rowtype;
 customer uuid;
 payload jsonb;
 original jsonb;
begin
 if p_stylist_id is null or p_id is null or p_action is null or p_action not in ('create','update') or
 p_visit_date is null or p_visit_date < date '1900-01-01' or p_visit_date > date '9999-12-31' or
 p_treatment_menu is null or length(btrim(p_treatment_menu)) not between 1 and 255 or
 p_chemicals_used is null or length(p_chemicals_used)>5000 or p_notes is null or length(p_notes)>10000 or
 (p_action='create' and (p_customer_id is null or p_expected_revision is not null)) or
 (p_action='update' and (p_customer_id is not null or p_expected_revision is null or p_expected_revision<0 or p_expected_revision>9007199254740991)) then
 raise exception 'Invalid medical record' using errcode='22023'; end if;
 select * into account from public.billing_accounts where stylist_id=p_stylist_id for share;
 if not found then raise exception 'Active access required' using errcode='42501'; end if;
 if not account.is_master and not coalesce(account.stripe_status in ('active','trialing') and account.period_end>clock_timestamp(),false) then
 raise exception 'Active access required' using errcode='42501'; end if;
 -- Serializes first creation (where no row exists yet), updates and duplicate requests.
 perform pg_advisory_xact_lock(hashtextextended('lino:medical:'||p_id::text,0));
 select * into previous from public.medical_records where id=p_id for update;
 if found then
   if previous.stylist_id is distinct from p_stylist_id then raise exception 'Record unavailable' using errcode='P0002'; end if;
   customer:=previous.customer_id;
 elsif p_action='update' then raise exception 'Record unavailable' using errcode='P0002';
 else customer:=p_customer_id; end if;
 if p_action='create' and customer is distinct from p_customer_id then raise exception 'Conflicting request' using errcode='40001'; end if;
 perform 1 from public.stylist_customers where stylist_id=p_stylist_id and customer_id=customer for share;
 if not found then raise exception 'Customer unavailable' using errcode='P0002'; end if;
 -- Recheck real wall-clock expiry after waiting for all record/relationship locks.
 if not account.is_master and not coalesce(account.stripe_status in ('active','trialing') and account.period_end>clock_timestamp(),false) then
 raise exception 'Active access required' using errcode='42501'; end if;
 if p_action='create' then
   payload:=jsonb_build_object('customer_id',customer,'visit_date',p_visit_date,'treatment_menu',btrim(p_treatment_menu),'chemicals_used',p_chemicals_used,'notes',p_notes);
   if previous.id is not null then
     select r.payload into original from public.medical_record_requests r where r.id=p_id and r.stylist_id=p_stylist_id;
     if not found or original is distinct from payload then raise exception 'Conflicting request' using errcode='40001'; end if;
     return p_id;
   end if;
   insert into public.medical_records(id,stylist_id,customer_id,visit_date,treatment_menu,chemicals_used,notes)
   values(p_id,p_stylist_id,customer,p_visit_date,btrim(p_treatment_menu),p_chemicals_used,p_notes);
   insert into public.medical_record_requests(id,stylist_id,payload) values(p_id,p_stylist_id,payload);
 else
   update public.medical_records set visit_date=p_visit_date,treatment_menu=btrim(p_treatment_menu),chemicals_used=p_chemicals_used,notes=p_notes,revision=revision+1
   where id=p_id and stylist_id=p_stylist_id and revision=p_expected_revision;
   if not found then raise exception 'Record changed' using errcode='40001'; end if;
 end if;
 return p_id;
end $$;
revoke all on function public.save_medical_record(uuid,text,uuid,uuid,date,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.save_medical_record(uuid,text,uuid,uuid,date,text,text,text,bigint) to service_role;
commit;
