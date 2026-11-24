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

test('profile PATCH validates fields and keeps both SAT copies in step',()=>isolated(async()=>{
 const bad=await workspace.PATCH(req({applicant:{gpaUnweighted:'4.5'}}));
 assert.equal(bad.status,400);assert.match((await bad.json()).error,/Unweighted GPA must be a number from 0 to 4/);
 assert.equal((await workspace.PATCH(req({profile:{gradYear:'27'}}))).status,400);
 assert.equal((await workspace.PATCH(req({profile:{activities:[{name:'Robotics',type:'Academic',desc:'x'.repeat(151)}]}}))).status,400);
 const ok=await workspace.PATCH(req({applicant:{gpaUnweighted:'3.9',sat:'1450',awards:9},profile:{residency:'tx',counselor:''}}));
 assert.equal(ok.status,200);const ws=(await ok.json()).data;
 assert.equal(ws.profile.testing.sat,'1450');assert.equal(ws.applicant.sat,'1450');assert.equal(ws.profile.residency,'TX');assert.equal(ws.applicant.awards,0);
 const cleared=(await (await workspace.PATCH(req({applicant:{sat:''}}))).json()).data;
 assert.equal(cleared.applicant.sat,'—');assert.equal(cleared.profile.testing.sat,'—');
}));
test('a Profile save from an older revision cannot replace lists the copilot changed',()=>isolated(async()=>{
 const start=await store.getWorkspace('route-test-workspace');
 await workspace.PATCH(req({profile:{activities:[{name:'Robotics',type:'Academic'}]}}));
 const stale=await workspace.PATCH(req({baseRevision:start.revision,profile:{activities:[{name:'Debate',type:'Academic'}]}}));
 assert.equal(stale.status,409);const body=await stale.json();
 assert.match(body.error,/changed while you were editing/);assert.equal(body.data.profile.activities[0].name,'Robotics');
 // Scalar edits and current revisions still save.
 assert.equal((await workspace.PATCH(req({baseRevision:start.revision,profile:{intended:'History'}}))).status,200);
 const current=await store.getWorkspace('route-test-workspace');
 assert.equal((await workspace.PATCH(req({baseRevision:current.revision,profile:{activities:[{name:'Debate',type:'Academic'}]}}))).status,200);
 assert.equal((await workspace.PATCH(req({baseRevision:'old'}))).status,400);
}));
test('complete-onboarding saves residency, ACT and list fit, and rejects a bad GPA',()=>isolated(async()=>{
 const body={action:'complete-onboarding',applicant:{name:'Sample Student',gpaUnweighted:'3.7'},profile:{hs:'Sample High',intended:'Biology',gradYear:'2027',residency:'WA'},testing:{act:'31'},listPrefs:{ambition:'balanced',budget:'15-30',needAid:true,ed:'no'}};
 const badRes=await workspace.POST(req({...body,applicant:{...body.applicant,gpaUnweighted:'7'}},'POST'));
 assert.equal(badRes.status,400);
 const res=await workspace.POST(req(body,'POST'));assert.equal(res.status,200);
 const ws=(await res.json()).data;
 assert.equal(ws.profile.residency,'WA');assert.equal(ws.profile.testing.act,'31');
 assert.equal(ws.onboarding.listPrefs.budget,'15-30');assert.equal(ws.onboarding.listPrefs.needAid,true);assert.equal(ws.onboarding.listPrefs.ed,'no');
 const rebalanced=await workspace.POST(req({action:'rebalance'},'POST'));assert.equal(rebalanced.status,200);
 const out=await rebalanced.json();assert.ok(Array.isArray(out.gaps));assert.ok(out.data.colleges.length>0);
 assert.ok(Array.isArray(out.added));assert.ok(Array.isArray(out.removed));assert.deepEqual(out.data.onboarding.listGaps,out.gaps);
}));
test('MCP tools ignore Codex-style filled arguments for yes/no flags',()=>isolated(async()=>{
 const {callTool}=require('../lib/mcp-tools.ts');
 await workspace.PATCH(req({applicant:{name:'Sample Student',gpaUnweighted:'3.7'},profile:{hs:'Sample High',intended:'Physics'}}));
 await callTool('route-test-workspace','update_profile',{test_optional:'yes'});
 const fill=await callTool('route-test-workspace','update_profile',{gpa_unweighted:'3.8',sat:'',sat_note:'',act:'',test_optional:''});
 assert.ok(!fill.isError,fill.content[0].text);assert.equal(fill.structuredContent.test_optional,true);
 assert.equal((await callTool('route-test-workspace','update_profile',{test_optional:false})).isError,true);
 await callTool('route-test-workspace','update_list_preferences',{need_aid:'yes'});
 const prefs=await callTool('route-test-workspace','update_list_preferences',{ambition:'balanced',app_count:0,budget:'',need_aid:'',early_decision:''});
 assert.ok(!prefs.isError,prefs.content[0].text);assert.equal(prefs.structuredContent.list_preferences.need_aid,true);
 await callTool('route-test-workspace','upsert_honor',{title:'AIME',level:'National',top:'yes'});
 const honor=await callTool('route-test-workspace','upsert_honor',{match:'AIME',year:'2026',top:'',level:''});
 assert.ok(!honor.isError,honor.content[0].text);assert.equal((await store.getWorkspace('route-test-workspace')).profile.honors[0].top,true);
 const unstar=await callTool('route-test-workspace','upsert_honor',{match:'AIME',top:'no'});assert.ok(!unstar.isError);
 assert.equal((await store.getWorkspace('route-test-workspace')).profile.honors[0].top,false);
}));
test('MCP update_profile changes only the fields it is given',()=>isolated(async()=>{
 const {callTool}=require('../lib/mcp-tools.ts');
 await workspace.PATCH(req({applicant:{name:'Sample Student',gpaUnweighted:'3.8',sat:'1400'},profile:{hs:'Sample High',intended:'Physics'}}));
 const r=await callTool('route-test-workspace','update_profile',{sat:'1500',name:'',gpa_weighted:'',grad_year:0,test_optional:''});
 assert.ok(!r.isError,r.content[0].text);
 const ws=await store.getWorkspace('route-test-workspace');
 assert.equal(ws.applicant.name,'Sample Student');assert.equal(ws.applicant.gpaUnweighted,'3.8');assert.equal(ws.profile.intended,'Physics');
 assert.equal(ws.applicant.sat,'1500');assert.equal(ws.profile.testing.sat,'1500');
 const bad=await callTool('route-test-workspace','update_profile',{gpa_unweighted:'5'});assert.equal(bad.isError,true);assert.match(bad.content[0].text,/Unweighted GPA/);
 const opt=await callTool('route-test-workspace','update_profile',{test_optional:'yes'});assert.equal(opt.structuredContent.test_optional,true);
 const off=await callTool('route-test-workspace','update_profile',{test_optional:'no'});assert.equal(off.structuredContent.sat_note,null);
 const prof=await callTool('route-test-workspace','get_profile',{});
 assert.equal(prof.structuredContent.high_school,'Sample High');assert.ok('list_preferences' in prof.structuredContent);
 const act=await callTool('route-test-workspace','upsert_activity',{name:'Robotics',type:'Academic',description:'Built a robot',rank:0});
 assert.ok(!act.isError,act.content[0].text);assert.equal(act.structuredContent.activities[0].description,'Built a robot');
 const early=await callTool('route-test-workspace','complete_onboarding',{});assert.equal(early.isError,true);assert.match(early.content[0].text,/Graduation year/);
 await callTool('route-test-workspace','update_profile',{grad_year:'2027'});
 const done=await callTool('route-test-workspace','complete_onboarding',{});assert.ok(!done.isError,done.content[0].text);
 assert.equal((await store.getWorkspace('route-test-workspace')).onboarding.completed,true);
}));
