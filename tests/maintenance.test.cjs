const {test}=require('node:test');
const assert=require('node:assert/strict');
const ts=require('typescript');
const fs=require('node:fs');
const vm=require('node:vm');
const exportsObject={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/maintenance.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:exportsObject,Set});
const {isMaintenanceBlocked,maintenanceHeaders,maintenanceHtml}=exportsObject;
test('maintenance blocks app routes, authenticated pages, callbacks, APIs and unknown routes',()=>{
 for(const path of ['/','/login','/billing','/admin','/admin/menus','/liff','/auth/callback','/api/settings','/api/create-checkout-session','/api/webhooks/stripe','/api/webhook/line','/new-route']) assert.equal(isMaintenanceBlocked(path,'true'),true,path);
});
test('maintenance allows only exact public legal routes and normalizes trailing slash',()=>{
 for(const path of ['/terms','/privacy','/commercial-disclosure','/terms/']) assert.equal(isMaintenanceBlocked(path,'true'),false,path);
 for(const path of ['/terms/admin','/privacy-export','/api/terms']) assert.equal(isMaintenanceBlocked(path,'true'),true,path);
});
test('maintenance is off by default and errors are not cached or indexed',()=>{
 for(const mode of [undefined,'','false']) assert.equal(isMaintenanceBlocked('/admin',mode),false);
 assert.match(maintenanceHeaders['Cache-Control'],/no-store/);
 assert.equal(maintenanceHeaders['Retry-After'],'300');
 assert.equal(maintenanceHeaders['X-Robots-Tag'],'noindex');
 assert.match(maintenanceHtml,/メンテナンス中/);
});
