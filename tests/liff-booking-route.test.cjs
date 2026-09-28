const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
const stylist='aaaaaaaa-0000-4000-8000-000000000001',menu='aaaaaaaa-0000-4000-8000-000000000002';
const valid={action:'save',stylistId:stylist,startTime:'2035-01-03T01:00:00.000Z',menuIds:[menu],menuNote:'',requestId:'aaaaaaaa-0000-4000-8000-000000000003'};
function fixture(options={}){
  const exports={},calls=[],logs=[];class AuthError extends Error{constructor(){super('private-token');this.reason='channel_mismatch';}} 
  const mocks={
    '@/lib/booking-notification':{notifyBookingRequest:async(req)=>{calls.push({notification:await req.json()});if(options.notifyThrows)throw Error('private-provider-error');return Response.json({}, {status:options.notifyFails?503:200});}},
    'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
    '@/lib/line-booking-auth':{LineBookingAuthError:AuthError,verifiedLineProfile:async()=>{if(options.noAuth)throw new AuthError();return {userId:'U'+'1'.repeat(32),displayName:'Verified'};}},
    '@/lib/billing':{assertBillingOrigin:()=>{if(options.badOrigin)throw Error();},getBillingStatus:async()=>({status:options.expired?'expired':'master'}),billingAdmin:()=>({
      from:table=>{calls.push(table);const q={select:(columns)=>{calls.push({table,columns});return q;},eq:()=>q,lt:(column,value)=>{calls.push({lt:column,value});return q;},gt:(column,value)=>{calls.push({gt:column,value});return q;},then:resolve=>resolve({data:[],error:null}),maybeSingle:async()=>({data:{id:stylist,name:'Salon'},error:null})};return q;},
      rpc:async(name,args)=>{calls.push({name,args});return {data:'saved',error:options.dbError};}
    })}
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/liff/booking/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:id=>mocks[id],console:{error(){},warn:(...args)=>logs.push(args),info:(...args)=>logs.push(args)},Date,Request});
  return {calls,logs,run:(body=valid)=>exports.POST(new Request('https://example.test/api/liff/booking',{method:'POST',body:JSON.stringify(body)}))};
}
test('LINE reservation rejects forged identity, customer, price and end time',async()=>{
 for(const extra of [{customerId:menu},{lineUserId:'spoof'},{displayName:'spoof'},{totalPrice:1},{endTime:valid.startTime}]){
  const f=fixture();assert.equal((await f.run({...valid,...extra})).status,400);assert.equal(f.calls.length,0);
 }
});
test('LINE reservation requires verified identity, origin and active stylist',async()=>{
 for(const [options,status] of [[{noAuth:true},401],[{badOrigin:true},403],[{expired:true},403]]){const f=fixture(options);assert.equal((await f.run()).status,status);assert.equal(f.calls.length,0);}
});
test('LINE reservation delegates atomic save using only verified identity',async()=>{
 const f=fixture();assert.equal((await f.run()).status,201);const call=f.calls.find(x=>x.name);assert.equal(call.name,'save_verified_liff_booking');assert.equal(call.args.p_line_user_id,'U'+'1'.repeat(32));assert.equal(call.args.p_display_name,'Verified');assert.equal(call.args.p_stylist_id,stylist);assert.equal('p_price' in call.args,false);
});
test('LINE database failures never expose provider or customer details',async()=>{
 for(const code of ['42501','40001','22023','XX000']){const response=await fixture({dbError:{code,message:'private-value',details:'private-value'}}).run();assert.equal((await response.text()).includes('private-value'),false);}
});

test('LINE auth diagnostic logs only safe reason and never identity or token',async()=>{const f=fixture({noAuth:true});const r=await f.run();assert.equal(r.status,401);assert.equal(f.logs[0][1].reason,'channel_mismatch');assert.equal(JSON.stringify(f.logs).includes('private-token'),false);assert.equal((await r.text()).includes('channel_mismatch'),false);});

test('saved reservation stays successful when notification fails or throws',async()=>{for(const options of [{notifyFails:true},{notifyThrows:true},{}]){const f=fixture(options);const r=await f.run();assert.equal(r.status,201);const b=await r.json();assert.equal(b.id,'saved');assert.equal(b.notification,options.notifyFails||options.notifyThrows?'unavailable':'accepted');assert.deepEqual(f.calls.find(x=>x.notification).notification,{bookingId:'saved'});}});

test('month availability is bounded to JST month and returns only unavailable intervals',async()=>{
 const f=fixture();const r=await f.run({action:'slots',stylistId:stylist,month:'2032-02'});
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{blocks:[]});
 assert.deepEqual(f.calls.find(x=>x.lt),{lt:'start_time',value:'2032-02-29T15:00:00.000Z'});
 assert.deepEqual(f.calls.find(x=>x.gt),{gt:'end_time',value:'2032-01-31T15:00:00.000Z'});
 assert.equal(f.calls.find(x=>x.table==='blocked_time_slots').columns,'start_time,end_time');
 assert.equal(r.headers.get('cache-control'),'no-store');
});
test('month availability rejects invalid months and ambiguous day/month requests',async()=>{
 for(const args of [{month:'2032-13'},{month:'2032-00'},{month:'2032-2'},{month:3},{month:'2032-02',date:'2032-02-03'},{date:'2031-02-29'}]) {
   assert.equal((await fixture().run({action:'slots',stylistId:stylist,...args})).status,400);
 }
 for(const options of [{noAuth:true},{expired:true}]) assert.notEqual((await fixture(options).run({action:'slots',stylistId:stylist,month:'2032-02'})).status,200);
});
