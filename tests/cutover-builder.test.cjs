const {test}=require('node:test');
const assert=require('node:assert/strict');
const {build,body}=require('../scripts/release/build-cutover.cjs');
test('rejects missing or SQL-injected master IDs',()=>{
 for(const id of ['',undefined,"x');drop table users;--"]) assert.throws(()=>build(id));
});
test('single atomic guarded transaction without legacy ownership/billing transfer',()=>{
 const sql=build('aaaaaaaa-0000-4000-8000-000000000001');
 assert.equal((sql.match(/^begin;$/gm)||[]).length,1);
 assert.equal((sql.match(/^commit;$/gm)||[]).length,1);
 assert.match(sql,/Explicit release approval marker required/);
 assert.match(sql,/Already initialized or unexpected schema/);
 assert.match(sql,/Legacy row counts changed/);
 assert.doesNotMatch(sql,/truncate |update public\.medical_records set stylist_id/i);
 assert.match(sql,/Expected exactly one master/);
});
test('refuses source files with unexpected transaction layout',()=>{
 assert.throws(()=>body('select 1;'));
 assert.throws(()=>body('begin;\nbegin;\ncommit;'));
});
