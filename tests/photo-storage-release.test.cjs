const {test}=require('node:test');
const assert=require('node:assert/strict');
const {main}=require('../scripts/setup-private-photo-storage.cjs');
const ref='abcdefghijklmnopqrst';
const env={NEXT_PUBLIC_SUPABASE_URL:`https://${ref}.supabase.co`,SUPABASE_SERVICE_ROLE_KEY:'synthetic'};
const insecure={id:'record-photos',public:true};
const secure={id:'record-photos',public:false,file_size_limit:10485760,allowed_mime_types:['image/png']};
function client(final=secure){let updates=0;return {get updates(){return updates}, make:()=>({storage:{listBuckets:async()=>({data:[insecure]}),updateBucket:async(id,opts)=>{assert.equal(id,'record-photos');assert.equal(opts.public,false);updates++;return {}},getBucket:async()=>({data:final})}})}}
test('default mode never changes an insecure bucket',async()=>{const c=client();await assert.rejects(main(['--project-ref',ref],env,c.make));assert.equal(c.updates,0)});
test('hardening requires target match and explicit marker before making requests',async()=>{const c=client();await assert.rejects(main(['--project-ref',ref,'--harden'],env,c.make));assert.equal(c.updates,0)});
test('hardening verifies the returned bucket and fails closed if still public',async()=>{const c=client(insecure);await assert.rejects(main(['--project-ref',ref,'--harden'],{...env,LINO_STORAGE_RELEASE_APPROVAL:ref},c.make));assert.equal(c.updates,1)});
test('hardening sets privacy and size/type restrictions',async()=>{const c=client();await main(['--project-ref',ref,'--harden'],{...env,LINO_STORAGE_RELEASE_APPROVAL:ref},c.make);assert.equal(c.updates,1)});
