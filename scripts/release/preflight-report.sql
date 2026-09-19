-- Read-only legacy-release preflight, one result for connectors that retain
-- only the last SELECT. Counts/configuration only; no customer/Auth values.
begin read only;
select jsonb_build_object(
 'captured_at',statement_timestamp(),
 'prerequisites',jsonb_build_object(
   'stylist_without_auth',(select count(*) from public.stylists s left join auth.users u on u.id=s.id where u.id is null),
   'availability_duplicate_keys',(select count(*) from (select stylist_id,day_of_week,specific_date from public.availability_settings group by stylist_id,day_of_week,specific_date having count(*)>1) d),
   'availability_invalid_day_or_date',(select count(*) from public.availability_settings where
     ((day_of_week between 0 and 6 and specific_date is null) or (day_of_week is null and specific_date is not null)) is not true),
   'availability_invalid_open_hours',(select count(*) from public.availability_settings where not is_day_off and (start_time is null or end_time is null or start_time>=end_time)),
   'invalid_menu_values',(select count(*) from public.menus where name is null or length(trim(name))=0 or duration is null or duration not between 1 and 1440 or price is null or price not between 0 and 10000000),
   'invalid_blocked_interval',(select count(*) from public.blocked_time_slots where start_time is null or end_time is null or start_time>=end_time)
 ),
 'preserve_counts',jsonb_build_object(
   'auth_users',(select count(*) from auth.users),
   'customers',(select count(*) from public.customers),
   'medical_records',(select count(*) from public.medical_records),
   'record_photos',(select count(*) from public.record_photos),
   'storage_objects',(select count(*) from storage.objects),
   'legacy_subscriptions',(select count(*) from public.subscriptions)
 ),
 'photo_bucket',(select jsonb_build_object('public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types) from storage.buckets where id='record-photos'),
 'already_initialized_tables',(select coalesce(jsonb_agg(table_name order by table_name),'[]'::jsonb) from information_schema.tables where table_schema='public' and table_name in ('billing_accounts','stylist_customers','booking_requests','medical_record_requests','photo_deletion_jobs'))
) as release_preflight;
rollback;
