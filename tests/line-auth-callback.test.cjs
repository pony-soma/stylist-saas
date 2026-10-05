const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
function fixture(o={}) {
 const writes=[],calls=[],logs=[];
 const query={update:v=>{writes.push(v);return query},eq:(k,v)=>{assert.equal(k,'id');assert.equal(v,'owner');return query},select:()=>query,single:async()=>({data:o.noRow?null:{id:'owner'},error:o.dbError?{}:null})};
 const cookie={get:()=>({value:'state'}),delete:()=>{}};
 const mocks={'next/server':{NextResponse:{redirect:u=>Response.redirect(u,307)}},'next/headers':{cookies:()=>cookie},'@/lib/supabase/server':{createClient:()=>({auth:{getUser:async()=>({data:{user:o.noUser?null:{id:'owner'}}})},from:t=>{assert.equal(t,'stylists');return query}})}};
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/auth/line/callback/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:id=>mocks[id],URL,URLSearchParams,process:{env:{NEXT_PUBLIC_APP_URL:'https://example.test',LINE_LOGIN_CHANNEL_ID:'channel',LINE_LOGIN_CHANNEL_SECRET:'secret'}},console:{error:(...v)=>logs.push(v)},fetch:async(url)=>{calls.push(url);return url.endsWith('/token')?Response.json(o.badClient?{error:'invalid_client',error_description:'sensitive secret'}:o.missingToken?{}:{id_token:'private-token'},{status:o.badClient?400:200}):Response.json(o.badVerify?{error:'invalid_token'}:{sub:'line-owner'},{status:o.badVerify?400:200});}});
 return {writes,calls,logs,run:(state='state')=>exports.GET(new Request('https://example.test/api/auth/line/callback?code=private-code&state='+state))};
}
for(const [option,error] of [['badClient','line_client_invalid'],['missingToken','line_id_token_missing'],['badVerify','line_verification_failed'],['noUser','not_authenticated'],['noRow','line_save_failed'],['dbError','line_save_failed']]) test(option+' returns visible LINE settings error',async()=>{const f=fixture({[option]:true}); const r=await f.run();assert.equal(r.headers.get('location'),'https://example.test/admin/settings/line?error='+error);if(!['noRow','dbError'].includes(option))assert.equal(f.writes.length,0);assert.ok(!JSON.stringify(f.logs).includes('sensitive'));});
test('invalid state never calls provider or DB',async()=>{const f=fixture();const r=await f.run('wrong');assert.ok(r.headers.get('location').endsWith('error=invalid_state'));assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);});
test('successful verification saves only current owner and returns LINE settings',async()=>{const f=fixture();const r=await f.run();assert.equal(r.headers.get('location'),'https://example.test/admin/settings/line?success=line_linked');assert.equal(f.writes[0].line_user_id,'line-owner');});
