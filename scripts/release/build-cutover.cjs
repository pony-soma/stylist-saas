'use strict';
// Offline SQL builder: no network/database connection and no automatic deployment.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const tables = ['availability_settings','blocked_time_slots','bookings','customer_memos','customers','medical_records','menus','record_photos','stylists','subscriptions'];
const migrationNames = [
 '20260913224403_ownership_foundation.sql', '20260914080405_business_owner_reads.sql',
 '20260914080435_manual_customer_registration.sql', '20260914082039_booking_mutations.sql',
 '20260915152141_medical_record_mutations.sql', '20260915222819_photo_deletion_recovery.sql',
];
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function body(sql) {
 if ((sql.match(/^begin;\s*$/gmi)||[]).length!==1 || (sql.match(/^commit;\s*$/gmi)||[]).length!==1) throw Error('Unexpected transaction boundaries');
 return sql.replace(/^begin;\s*$/gmi,'').replace(/^commit;\s*$/gmi,'');
}
function build(masterId) {
 if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(masterId||'')) throw Error('An explicitly verified master UUID is required');
 const baseline=read('tests/e2e/setup-schema.sql');
 const start=baseline.indexOf('create table public.billing_accounts (');
 const end=baseline.indexOf('-- Storage objects are written');
 if(start<0 || end<start) throw Error('Billing source boundaries changed');
 const billing=baseline.slice(start,end);
 const changes=migrationNames.map(name=>{
   const sql=read('supabase/migrations/'+name);
   return `-- Source: ${name}; sha256=${crypto.createHash('sha256').update(sql).digest('hex')}\n${body(sql)}`;
 }).join('\n');
 return `-- REVIEWED RELEASE ONLY. Generated offline; generation is not deployment approval.
-- Requires an operator-verified target, backup and separate application cutover.
-- Set lino.release_approval to lino-initial-cutover-v1 in the approved execution session.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
 if current_setting('lino.release_approval', true) is distinct from 'lino-initial-cutover-v1' then
  raise exception 'Explicit release approval marker required'; end if;
 if to_regclass('public.billing_accounts') is not null or to_regclass('public.stylist_customers') is not null then
  raise exception 'Already initialized or unexpected schema; refusing overwrite'; end if;
 if not exists(select 1 from auth.users u join public.stylists s on s.id=u.id where u.id='${masterId}'::uuid and u.email_confirmed_at is not null) then
  raise exception 'Approved master must be an existing verified account'; end if;
end $$;
lock table ${tables.map(t=>'public.'+t).join(', ')} in access exclusive mode;
create temporary table lino_before_counts on commit drop as
select (select count(*) from public.medical_records) records, (select count(*) from public.record_photos) photos,
 (select count(*) from public.customers) customers, (select count(*) from public.subscriptions) subscriptions;
-- Replace old public policies only on these ten application tables.
do $$ declare p record; begin
 for p in select tablename,policyname from pg_policies where schemaname='public'
 and tablename in (${tables.map(t=>"'"+t+"'").join(',')}) loop
 execute format('drop policy %I on public.%I',p.policyname,p.tablename);
 end loop;
end $$;
${tables.map(t=>`alter table public.${t} enable row level security;
revoke all on public.${t} from public, anon, authenticated;
grant all on public.${t} to service_role;`).join('\n')}
grant select, insert, update on public.stylists to authenticated;
create policy stylist_read_self on public.stylists for select to authenticated using ((select auth.uid())=id);
create policy stylist_insert_self on public.stylists for insert to authenticated with check ((select auth.uid())=id);
create policy stylist_update_self on public.stylists for update to authenticated using ((select auth.uid())=id) with check ((select auth.uid())=id);
${billing}
-- Do not copy sandbox customer/subscription IDs or infer free access from active status.
insert into public.billing_accounts(stylist_id,is_master)
select id, id='${masterId}'::uuid from public.stylists;
${changes}
-- Preserve old bookings' explicit relationships. Never infer historical record ownership.
insert into public.stylist_customers(stylist_id,customer_id)
select distinct stylist_id,customer_id from public.bookings on conflict do nothing;
alter table public.bookings validate constraint bookings_stylist_customer_fkey;
alter table public.medical_records validate constraint medical_records_stylist_customer_fkey;
alter table public.medical_records validate constraint medical_records_booking_owner_fkey;
-- Unassigned historical records remain NULL and are denied by owner policies.
do $$ begin
 if exists(select 1 from public.medical_records where stylist_id is not null) then raise exception 'Unexpected historical owner assignment'; end if;
 if (select count(*) from public.billing_accounts where is_master) <> 1 then raise exception 'Expected exactly one master'; end if;
 if exists(select 1 from lino_before_counts where records<>(select count(*) from public.medical_records)
 or photos<>(select count(*) from public.record_photos) or customers<>(select count(*) from public.customers)
 or subscriptions<>(select count(*) from public.subscriptions)) then raise exception 'Legacy row counts changed'; end if;
end $$;
-- STORAGE IS A SEPARATE RELEASE GATE: make record-photos private using Storage API,
-- review its policies and prove anonymous URLs are denied before opening traffic.
notify pgrst, 'reload schema';
commit;
`;
}
if(require.main===module) {
 try { if(process.argv.length!==3) throw Error('Usage: node scripts/release/build-cutover.cjs <verified-master-uuid>'); process.stdout.write(build(process.argv[2])); }
 catch(e) { console.error(e.message); process.exitCode=1; }
}
module.exports={build,body,tables};
