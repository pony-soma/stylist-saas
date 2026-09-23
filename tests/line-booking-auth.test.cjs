const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function fixture(options = {}) {
  const exports = {}, calls = [];
  const code = ts.transpileModule(fs.readFileSync('lib/line-booking-auth.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,process:{env:{LINE_LOGIN_CHANNEL_ID:'expected-channel'}},AbortSignal,fetch:async (url, init)=>{
    calls.push({url,init});
    return url.includes('/verify?') ? Response.json({client_id:options.wrongChannel?'other':'expected-channel',expires_in:options.expired?0:300},{status:options.invalid?401:200})
      : Response.json({userId:options.badProfile?'spoof':'U'+'1'.repeat(32),displayName:'Verified guest'});
  }});
  return {calls,run:()=>exports.verifiedLineProfile(new Request('https://example.test',{headers:options.missing?{}:{Authorization:'Bearer test-token'}}))};
}
for(const mode of ['missing','invalid','wrongChannel','expired','badProfile']) test('LINE identity rejects '+mode, async()=>{
  const f=fixture({[mode]:true}); await assert.rejects(f.run());
  if(mode==='missing') assert.equal(f.calls.length,0);
  if(['invalid','wrongChannel','expired'].includes(mode))assert.equal(f.calls.length,1);
});
test('LINE identity comes only from verified provider profile',async()=>{
  const f=fixture();const p=await f.run();assert.equal(p.userId,'U'+'1'.repeat(32));assert.equal(p.displayName,'Verified guest');
  assert.equal(f.calls[1].init.headers.Authorization,'Bearer test-token');
});
