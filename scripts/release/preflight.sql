-- READ ONLY: inspect the legacy database immediately before initial cutover.
-- This checks data prerequisites, NOT authorization, backups or Stripe readiness.
-- Expected target: existing production legacy schema. No customer values returned.
-- BEGIN READ ONLY also prevents accidental writes if edited later.
begin read only;
select check_name, finding_count, interpretation from (
 select 'stylist_without_auth' as check_name, count(*) as finding_count,
   'Must be zero: billing bootstrap references auth.users' as interpretation
 from public.stylists s left join auth.users u on u.id=s.id where u.id is null
 union all
 select 'availability_duplicate_keys',count(*),'Must be zero for settings API: review duplicates without deleting automatically'
 from (select stylist_id,day_of_week,specific_date from public.availability_settings
       group by stylist_id,day_of_week,specific_date having count(*)>1) d
 union all
 select 'availability_invalid_day_or_date',count(*),'Must be zero: exactly one valid day-of-week or specific date'
 from public.availability_settings
 where not ((day_of_week between 0 and 6 and specific_date is null)
         or (day_of_week is null and specific_date is not null))
    or (day_of_week is null and specific_date is null)
 union all
 select 'availability_invalid_open_hours',count(*),'Must be zero: open days require start before end'
 from public.availability_settings
 where not is_day_off and (start_time is null or end_time is null or start_time >= end_time)
 union all
 select 'invalid_menu_values',count(*),'Review: new API requires nonempty name, duration 1..1440, price 0..10000000'
 from public.menus where length(trim(name))=0 or duration not between 1 and 1440 or price not between 0 and 10000000
 union all
 select 'invalid_blocked_interval',count(*),'Must be zero: block start before end'
 from public.blocked_time_slots where start_time >= end_time
 union all
 select 'legacy_medical_records',count(*),'Preserve: cutover leaves these records unassigned and hidden; not a deletion count'
 from public.medical_records
 union all
 select 'legacy_record_photos',count(*),'Preserve: no photo objects or rows deleted during cutover'
 from public.record_photos
 union all
 select 'legacy_subscription_rows',count(*),'Preserve legacy rows; do not import sandbox subscriptions as live paid accounts'
 from public.subscriptions
) findings order by check_name;
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id='record-photos';
select table_name from information_schema.tables
where table_schema='public' and table_name in ('billing_accounts','stylist_customers','booking_requests','medical_record_requests','photo_deletion_jobs');
-- Before initial cutover the final query must return no rows.
rollback;
