'use strict';
// Restrictive policy ANDs with existing permissive rules; unrelated buckets retain their policies.
const photoPolicy = `
do $$ begin
 if not exists(select 1 from storage.buckets where id='record-photos' and public=false) then
  raise exception 'Private photo bucket required before cutover'; end if;
end $$;
create policy lino_photos_server_only on storage.objects as restrictive
 for all to anon, authenticated
 using (bucket_id <> 'record-photos') with check (bucket_id <> 'record-photos');
`;
module.exports={photoPolicy};
