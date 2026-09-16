'use strict';
// Creates an isolated schema and synthetic rows, then always rolls back.
// Does not touch public application tables or any production identities.
const fs=require('node:fs');
const path=require('node:path');
const {build,body,tables}=require('./build-cutover.cjs');
const root=path.resolve(__dirname,'../..');
const baseline=fs.readFileSync(path.join(root,'tests/e2e/setup-schema.sql'),'utf8');
const legacy=baseline.slice(baseline.indexOf('create table public."availability_settings"'),baseline.indexOf('alter table public."availability_settings" enable row level security;'));
const master='dddddddd-1111-4111-8111-111111111111';
const tester='dddddddd-2222-4222-8222-222222222222';
const customer='dddddddd-3333-4333-8333-333333333333';
const record='dddddddd-4444-4444-8444-444444444444';
const photo='dddddddd-5555-4555-8555-555555555555';
const rewrite=s=>s.replaceAll('storage.objects','lino_cutover_rehearsal.storage_objects').replaceAll('storage.buckets','lino_cutover_rehearsal.storage_buckets').replaceAll('public.','lino_cutover_rehearsal.').replaceAll("schemaname='public'","schemaname='lino_cutover_rehearsal'").replaceAll("schemaname = 'public'","schemaname = 'lino_cutover_rehearsal'");
const sql=`begin;
set local statement_timeout='60s';
create schema lino_cutover_rehearsal;
set local search_path=lino_cutover_rehearsal,pg_catalog;
grant usage on schema lino_cutover_rehearsal to authenticated,anon,service_role;
${rewrite(legacy)}
create table lino_cutover_rehearsal.storage_buckets(id text primary key,public boolean);
insert into lino_cutover_rehearsal.storage_buckets values ('record-photos',false);
create table lino_cutover_rehearsal.storage_objects(id int primary key,bucket_id text);
insert into lino_cutover_rehearsal.storage_objects values (1,'record-photos'),(2,'unrelated');
alter table lino_cutover_rehearsal.storage_objects enable row level security;
grant all on lino_cutover_rehearsal.storage_objects to anon,authenticated;
create policy legacy_storage_all on lino_cutover_rehearsal.storage_objects for all using(true) with check(true);
insert into auth.users(id,email,email_confirmed_at) values
('${master}','cutover-master@example.invalid',now()),('${tester}','cutover-tester@example.invalid',now());
insert into lino_cutover_rehearsal.stylists(id,name) values ('${master}','Synthetic master'),('${tester}','Synthetic tester');
insert into lino_cutover_rehearsal.customers(id,line_user_id,display_name) values ('${customer}','synthetic-cutover-customer','Synthetic customer');
insert into lino_cutover_rehearsal.medical_records(id,customer_id,visit_date) values ('${record}','${customer}',current_date);
insert into lino_cutover_rehearsal.record_photos(id,record_id,storage_path) values ('${photo}','${record}','synthetic.jpg');
${tables.map(t=>`create policy legacy_allow_all on lino_cutover_rehearsal.${t} for all using(true) with check(true);`).join('\n')}
set local lino.release_approval='lino-initial-cutover-v1';
${rewrite(body(build(master)))}
create function pg_temp.check_result(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception '%',label; end if; end $$;
select pg_temp.check_result((select count(*)=1 from lino_cutover_rehearsal.billing_accounts where is_master),'Exactly one master');
select pg_temp.check_result((select not is_master and stripe_customer_id is null from lino_cutover_rehearsal.billing_accounts where stylist_id='${tester}'),'Tester is not exempt; no sandbox transfer');
select pg_temp.check_result((select count(*)=1 from lino_cutover_rehearsal.medical_records),'Legacy records preserved');
set local role authenticated;
select set_config('request.jwt.claim.sub','${master}',true);
select set_config('request.jwt.claims','{"sub":"${master}","role":"authenticated"}',true);
select pg_temp.check_result((select count(*)=0 from lino_cutover_rehearsal.medical_records),'Unassigned records hidden from master');
select pg_temp.check_result((select count(*)=0 from lino_cutover_rehearsal.record_photos),'Unassigned photos hidden from master');
select pg_temp.check_result((select count(*)=1 from lino_cutover_rehearsal.billing_accounts),'Billing owner only');
select pg_temp.check_result((select count(*)=0 from lino_cutover_rehearsal.storage_objects where bucket_id='record-photos'),'Broad old storage policy cannot expose photos');
select pg_temp.check_result((select count(*)=1 from lino_cutover_rehearsal.storage_objects where bucket_id='unrelated'),'Other buckets unaffected');
do $$ begin
 begin
  insert into lino_cutover_rehearsal.storage_objects values (3,'record-photos');
  raise exception 'Unexpected upload permission';
 exception when insufficient_privilege then null;
 end;
end $$;
with changed as (update lino_cutover_rehearsal.storage_objects set bucket_id='unrelated' where id=1 returning id)
select pg_temp.check_result((select count(*)=0 from changed),'Cannot update photo');
with removed as (delete from lino_cutover_rehearsal.storage_objects where id=1 returning id)
select pg_temp.check_result((select count(*)=0 from removed),'Cannot delete photo');
reset role;
set local role anon;
select pg_temp.check_result((select count(*)=0 from lino_cutover_rehearsal.storage_objects where bucket_id='record-photos'),'Anonymous photos denied');
reset role;
select pg_temp.check_result((select count(*)=1 from lino_cutover_rehearsal.storage_objects where id=1),'Photo metadata preserved');
rollback;
select 'PASS: atomic cutover rehearsal; one master; tester not exempt; legacy rows preserved and hidden; restrictive photo policy denies client access; all synthetic changes rolled back' as result;
`;
if(require.main===module) process.stdout.write(sql);
module.exports={sql};
