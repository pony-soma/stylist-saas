begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create table public.photo_deletion_jobs (
 photo_id uuid primary key,
 stylist_id uuid not null references public.stylists(id),
 storage_path text not null,
 requested_at timestamptz not null default now(),
 completed_at timestamptz
);
alter table public.photo_deletion_jobs enable row level security;
revoke all on public.photo_deletion_jobs from public,anon,authenticated,service_role;
grant select,insert on public.photo_deletion_jobs to service_role;
grant update(completed_at) on public.photo_deletion_jobs to service_role;
create index photo_deletion_jobs_pending on public.photo_deletion_jobs(requested_at) where completed_at is null;
-- Retain jobs even after record deletion: they are the durable authorization and
-- exact object identity for retries, never arbitrary paths supplied by the caller.
create function public.request_photo_deletion(p_stylist_id uuid,p_photo_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 job public.photo_deletion_jobs%rowtype;
 photo public.record_photos%rowtype;
 account public.billing_accounts%rowtype;
 owner_id uuid;
begin
 if p_stylist_id is null or p_photo_id is null then raise exception 'Invalid request' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('lino:photo-delete:'||p_photo_id::text,0));
 select * into job from public.photo_deletion_jobs where photo_id=p_photo_id;
 if found then
   if job.stylist_id is distinct from p_stylist_id then raise exception 'Photo unavailable' using errcode='P0002'; end if;
   return to_jsonb(job);
 end if;
 select * into account from public.billing_accounts where stylist_id=p_stylist_id for share;
 if not found or (not account.is_master and not coalesce(account.stripe_status in ('active','trialing') and account.period_end>clock_timestamp(),false)) then
 raise exception 'Active access required' using errcode='42501'; end if;
 -- Block concurrent inserts/updates while checking legacy shared paths. Normal
 -- uploads use unique server-generated paths; a shared legacy object is rejected.
 lock table public.record_photos in share row exclusive mode;
 select * into photo from public.record_photos where id=p_photo_id for update;
 if not found then raise exception 'Photo unavailable' using errcode='P0002'; end if;
 select stylist_id into owner_id from public.medical_records where id=photo.record_id for share;
 if not found or owner_id is distinct from p_stylist_id then raise exception 'Photo unavailable' using errcode='P0002'; end if;
 if photo.storage_path is null or photo.storage_path='' or photo.storage_path like '/%' or
 photo.storage_path ~ '[\\[:cntrl:]]' or photo.storage_path ~ '(^|/)(\.{1,2})?(/|$)' then
 raise exception 'Invalid object path' using errcode='22023'; end if;
 if exists(select 1 from public.record_photos where storage_path=photo.storage_path and id<>p_photo_id) or
 exists(select 1 from public.photo_deletion_jobs where storage_path=photo.storage_path and photo_id<>p_photo_id) then
 raise exception 'Shared object' using errcode='40001'; end if;
 if not account.is_master and not coalesce(account.stripe_status in ('active','trialing') and account.period_end>clock_timestamp(),false) then
 raise exception 'Active access required' using errcode='42501'; end if;
 insert into public.photo_deletion_jobs(photo_id,stylist_id,storage_path)
 values(p_photo_id,p_stylist_id,photo.storage_path) returning * into job;
 delete from public.record_photos where id=p_photo_id;
 return to_jsonb(job);
end $$;
create function public.complete_photo_deletion(p_stylist_id uuid,p_photo_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 update public.photo_deletion_jobs set completed_at=coalesce(completed_at,clock_timestamp())
 where photo_id=p_photo_id and stylist_id=p_stylist_id;
 return found;
end $$;
revoke all on function public.request_photo_deletion(uuid,uuid),public.complete_photo_deletion(uuid,uuid) from public,anon,authenticated;
grant execute on function public.request_photo_deletion(uuid,uuid),public.complete_photo_deletion(uuid,uuid) to service_role;
commit;
