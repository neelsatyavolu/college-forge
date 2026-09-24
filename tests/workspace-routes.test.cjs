const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (mod,file) => mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021,esModuleInterop:true,resolveJsonModule:true}}).outputText,file);
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request,...args) { return resolve.call(this,request.startsWith('@/') ? path.join(__dirname,'..',request.slice(2))+'.ts' : request,...args); };
const {NextRequest} = require('next/server');
const store = require('../lib/store.ts');
const shares = require('../lib/share-store.ts');
const workspace = require('../app/api/workspace/route.ts');
const colleges = require('../app/api/workspace/colleges/route.ts');
const advisor = require('../app/api/share/[token]/route.ts');
function req(body,method='PATCH',pathname='/api/workspace') {return new NextRequest('http://localhost'+pathname,{method,headers:{cookie:'cf_workspace=route-test-workspace','content-type':'application/json'},body:JSON.stringify(body)});}
async function isolated(run) {
 const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'forge-routes-'));
 const prev=process.env.CF_DATA_DIR,blob=process.env.BLOB_READ_WRITE_TOKEN;process.env.CF_DATA_DIR=dir;delete process.env.BLOB_READ_WRITE_TOKEN;
 try {await store.getWorkspace('route-test-workspace');await run(dir);}finally{if(prev===undefined)delete process.env.CF_DATA_DIR;else process.env.CF_DATA_DIR=prev;if(blob===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=blob;await fs.promises.rm(dir,{recursive:true,force:true});}
}
test('simultaneous checklist, draft, and college route writes all survive',()=>isolated(async()=>{
 const jobs=Array.from({length:12},(_,i)=>workspace.PATCH(req({plannerToggle:{key:`task-${i}`,done:true}})));
 jobs.push(workspace.PATCH(req({essayDraft:{id:'personal',text:'Keep my essay'}})));
 jobs.push(colleges.POST(req({college:{name:'Test College',slug:'test-college',short:'Test'}},'POST','/api/workspace/colleges')));
 const responses=await Promise.all(jobs);assert.ok(responses.every(r=>r.status===200));
 const ws=await store.getWorkspace('route-test-workspace');
 assert.equal(Object.keys(ws.plannerDone).length,12);assert.equal(ws.essayDrafts.personal,'Keep my essay');assert.equal(ws.colleges.length,1);
}));
test('workspace recovery never returns the bearer workspace identifier in JSON',()=>isolated(async()=>{
 const created=await (await workspace.POST(req({action:'create-recovery'},'POST'))).json();
 const response=await workspace.POST(req({action:'claim-recovery',code:created.code},'POST'));
 const body=await response.json();assert.equal(response.status,200);assert.equal('workspaceId' in body,false);assert.match(response.headers.get('set-cookie'),/HttpOnly/);
}));
test('invalid JSON shapes produce validation errors, not empty or corrupt workspaces',()=>isolated(async()=>{
 for(const body of [null,[],123,'invalid']) {
   assert.equal((await workspace.PATCH(req(body))).status,400);
   assert.equal((await workspace.POST(req(body,'POST'))).status,400);
   assert.equal((await colleges.POST(req(body,'POST','/api/workspace/colleges'))).status,400);
 }
}));
test('an advisor note must not reactivate a share revoked while the note is saving',()=>isolated(async()=>{
 const created=await (await workspace.POST(req({action:'create-share'},'POST'))).json();const token=created.token;
 const name=store.updateWorkspace ? 'updateWorkspace' : 'saveWorkspace';const original=store[name];
 store[name]=async(...args)=>{const value=await original(...args);await shares.putShare({token,workspaceId:'route-test-workspace',label:'Advisor',createdAt:1,revokedAt:2});return value;};
 try {
   const response=await advisor.POST(req({body:'Helpful note'},'POST','/api/share/'+token),{params:Promise.resolve({token})});assert.equal(response.status,200);
   assert.equal((await shares.getShare(token)).revokedAt,2);
   assert.equal((await advisor.GET(req({},'POST'),{params:Promise.resolve({token})})).status,404);
 } finally {store[name]=original;}
}));

test('reset invalidates prior share links and recovery codes',()=>isolated(async()=>{
 const shared=await (await workspace.POST(req({action:'create-share'},'POST'))).json();
 const recovery=await (await workspace.POST(req({action:'create-recovery'},'POST'))).json();
 assert.equal((await advisor.GET(req({},'POST'),{params:Promise.resolve({token:shared.token})})).status,200);
 await workspace.POST(req({action:'reset'},'POST'));
 await workspace.PATCH(req({applicant:{name:'New private profile'}}));
 assert.equal((await advisor.GET(req({},'POST'),{params:Promise.resolve({token:shared.token})})).status,404);
 assert.equal((await advisor.POST(req({body:'Old link note'},'POST'),{params:Promise.resolve({token:shared.token})})).status,404);
 assert.equal((await workspace.POST(req({action:'claim-recovery',code:recovery.code},'POST'))).status,404);
}));
