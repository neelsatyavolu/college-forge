const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ts = require('typescript');
const Module = require('node:module');
require.extensions['.ts'] = (mod,file) => mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021,esModuleInterop:true,resolveJsonModule:true}}).outputText,file);
let providerRun;
const originalLoad = Module._load;
Module._load = function(request, parent, ...args) {
  if (request === '@/lib/providers') return {runChat: params => providerRun(params)};
  if (request.startsWith('@/')) request = path.join(__dirname, '..', request.slice(2)) + '.ts';
  return originalLoad.call(this, request, parent, ...args);
};
const { POST } = require('../app/api/ai/chat/route.ts');
Module._load = originalLoad;
const { emptyWorkspace, getWorkspace, updateWorkspace } = require('../lib/store.ts');
const { makeHubTools } = require('../lib/hub-tools.ts');

async function workspace(run) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-ai-'));
  const oldDir = process.env.CF_DATA_DIR, oldToken = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.CF_DATA_DIR = directory; delete process.env.BLOB_READ_WRITE_TOKEN;
  const id = 'ai-regression-workspace';
  const ws = emptyWorkspace();ws.applicant.gpaUnweighted='3.4';ws.applicant.sat='1350';ws.profile.intended='Computer Science';
  ws.colleges=[{name:'Princeton University',short:'Princeton',slug:'princeton-university',scorecardId:186131,tier:'reach'}];
  await updateWorkspace(id, () => ws);
  const saved = await getWorkspace(id); // Compare normalized reader snapshots, including generated essay groups.
  try { await run(id,saved); } finally {
    if(oldDir===undefined)delete process.env.CF_DATA_DIR;else process.env.CF_DATA_DIR=oldDir;
    if(oldToken===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=oldToken;
    await fs.promises.rm(directory,{recursive:true,force:true});
  }
}
const reply = {text:'A grounded reply.',provider:'codex',model:'test-fixture',finishReason:'stop',rounds:1,truncated:false};
const request = (id,body) => ({json:async()=>body,cookies:{get:()=>({value:id})}});
async function events(response) { return (await response.text()).trim().split('\n').map(line=>JSON.parse(line)); }

test('asking a read-only shortlist question never prunes saved schools', async()=>workspace(async(id,before)=>{
  providerRun=async ({emit})=>{emit({type:'delta',text:'Consider your options.'});return reply;};
  const response=await POST(request(id,{messages:[{role:'user',content:'How balanced is my shortlist? Please only explain.'}]}));
  assert.equal(response.status,200);assert.equal((await events(response)).at(-1).type,'done');
  assert.deepEqual(await getWorkspace(id),before);
}));
test('grounded tool read and explicit save preserve evidence and existing choices', async()=>workspace(async(id,before)=>{
  let chosen;
  providerRun=async ({executeTool,instructions})=>{
    assert.match(instructions,/Grounded fair-ranking recommendations/);
    const result=JSON.parse(await executeTool('get_college_recommendations','{}'));
    chosen=result.recommendations.find(r=>r.fit.tier==='target');assert.ok(chosen.evidence.fairRank);
    assert.match(await executeTool('upsert_college',JSON.stringify(chosen.college)),/^Saved/);
    return reply;
  };
  const response=await POST(request(id,{messages:[{role:'user',content:'Recommend a target school and add it to my shortlist. Keep the rest.'}]}));
  assert.equal((await events(response)).at(-1).type,'done');
  const after=await getWorkspace(id);
  assert.equal(after.revision,before.revision+1);
  assert.deepEqual(after.colleges[0],before.colleges[0]);
  const saved=after.colleges.find(c=>c.scorecardId===chosen.college.scorecardId);
  assert.equal(saved.tier,chosen.fit.tier);assert.equal(saved.netPrice,chosen.college.netPrice);
}));
test('parallel AI edits merge into the latest workspace without dropping fields', async()=>workspace(async(id,before)=>{
  const {executeTool}=makeHubTools(id);
  await Promise.all([
    executeTool('set_profile_identity',JSON.stringify({intended:'Journalism'})),
    executeTool('set_financial_aid',JSON.stringify({fafsaStatus:'submitted'})),
    executeTool('set_applicant_snapshot',JSON.stringify({name:'Test Student'})),
  ]);
  const ws=await getWorkspace(id);assert.equal(ws.revision,before.revision+3);assert.equal(ws.profile.intended,'Journalism');assert.equal(ws.financialAid.fafsaStatus,'submitted');assert.equal(ws.applicant.name,'Test Student');
}));
test('provider failures stream an error and leave the saved workspace intact', async()=>workspace(async(id,before)=>{
  providerRun=async()=>{throw Error('Test provider unavailable');};
  const response=await POST(request(id,{messages:[{role:'user',content:'Review my college list'}]}));
  const output=await events(response);assert.equal(output.at(-1).type,'error');assert.match(output.at(-1).message,/Test provider unavailable/);assert.ok(!output.some(e=>e.type==='done'));
  assert.deepEqual(await getWorkspace(id),before);
}));
test('invalid request and tool bodies produce controlled errors', async()=>workspace(async(id)=>{
  const response=await POST(request(id,null));assert.equal(response.status,400);
  const {executeTool}=makeHubTools(id);
  assert.match(await executeTool('set_applicant_snapshot','null'),/Invalid.*object/i);
  assert.match(await executeTool('set_profile_identity','['),/Invalid JSON/i);
}));
test('a rejected college addition leaves all saved choices unchanged', async()=>workspace(async(id,before)=>{
  const {executeTool}=makeHubTools(id);
  const result=await executeTool('upsert_college',JSON.stringify({name:'Massachusetts Institute of Technology',short:'MIT',slug:'massachusetts-institute-of-technology',scorecardId:166683}));
  assert.match(result,/NOT added|Blocked/);assert.ok(!result.startsWith('Saved'));
  assert.deepEqual(await getWorkspace(id),before);
}));
test('a reset invalidates the old conversation tools without changing the new workspace', async(t)=>workspace(async(id)=>{
  const web = require('../lib/web-search-tool.ts');
  t.mock.method(web, 'runWebSearch', async () => ({ok:true,content:'Public search evidence'}));
  t.mock.method(web, 'runWebFetch', async () => ({ok:true,content:'Public page evidence'}));
  const {resetWorkspace}=require('../lib/store.ts');
  let reset;
  providerRun=async ({executeTool})=>{
    const evidence=JSON.parse(await executeTool('get_college_recommendations','{}'));
    const candidate=evidence.recommendations.find(row=>row.fit.tier==='target');
    reset=await resetWorkspace(id);
    assert.match(await executeTool('upsert_college',JSON.stringify(candidate.college)),/workspace.*(?:reset|changed)/i);
    assert.match(await executeTool('set_profile_identity',JSON.stringify({intended:'Old conversation major'})),/workspace.*(?:reset|changed)/i);
    assert.match(await executeTool('get_college_recommendations','{}'),/workspace.*(?:reset|changed)/i);
    assert.match(await executeTool('read_upload',JSON.stringify({name:'old-transcript.txt'})),/workspace.*(?:reset|changed)/i);
    assert.equal(await executeTool('web_search',JSON.stringify({query:'college deadlines'})), 'Public search evidence');
    assert.equal(await executeTool('web_fetch',JSON.stringify({url:'https://example.edu/admissions'})), 'Public page evidence');
    return reply;
  };
  const response=await POST(request(id,{messages:[{role:'user',content:'Add one recommended target and update my major.'}]}));
  assert.equal((await events(response)).at(-1).type,'done');
  assert.deepEqual(await getWorkspace(id),reset);
  assert.equal(reset.profile.intended,'');assert.equal(reset.colleges.length,0);
}));

test('set_testing saves SAT to both copies, so recommendations use the new score', async()=>workspace(async(id)=>{
  const {executeTool}=makeHubTools(id);
  assert.equal(await executeTool('set_testing',JSON.stringify({sat:'1520',act:'',satNote:''})),'Updated testing.');
  const ws=await getWorkspace(id);
  assert.equal(ws.applicant.sat,'1520');assert.equal(ws.profile.testing.sat,'1520');
  const {studentAcademics}=require('../lib/college-recommendations.ts');
  assert.equal(studentAcademics(ws).sat,1520);
  await executeTool('set_applicant_snapshot',JSON.stringify({sat:'1480'}));
  const after=await getWorkspace(id);assert.equal(after.profile.testing.sat,'1480');assert.equal(after.applicant.sat,'1480');
}));
test('empty or zero tool arguments leave stored profile values alone', async()=>workspace(async(id,before)=>{
  const {executeTool}=makeHubTools(id);
  await executeTool('set_applicant_snapshot',JSON.stringify({name:'',sat:'',gpaWeighted:'',awards:0}));
  await executeTool('set_profile_identity',JSON.stringify({gradYear:0,intended:''}));
  const ws=await getWorkspace(id);
  assert.equal(ws.applicant.sat,'1350');assert.equal(ws.applicant.gpaUnweighted,'3.4');assert.equal(ws.profile.intended,'Computer Science');
  assert.equal(ws.applicant.awards,before.applicant.awards);
}));
test('invalid profile values are refused and nothing is written', async()=>workspace(async(id,before)=>{
  const {executeTool}=makeHubTools(id);
  assert.match(await executeTool('set_applicant_snapshot',JSON.stringify({gpaUnweighted:'4.7'})),/^Not saved: Unweighted GPA/);
  assert.match(await executeTool('set_applicant_snapshot',JSON.stringify({gpaWeighted:'banana'})),/^Not saved/);
  assert.match(await executeTool('set_testing',JSON.stringify({sat:'1610'})),/^Not saved: SAT/);
  assert.match(await executeTool('set_profile_identity',JSON.stringify({residency:'Narnia'})),/^Not saved: Residency/);
  assert.deepEqual(await getWorkspace(id),before);
  assert.equal(await executeTool('set_profile_identity',JSON.stringify({residency:'california'})),'Updated profile identity.');
  assert.equal((await getWorkspace(id)).profile.residency,'CA');
}));
test('activity and honor tools merge one entry at a time and keep the caps', async()=>workspace(async(id)=>{
  const {executeTool}=makeHubTools(id);
  await executeTool('set_activities',JSON.stringify({activities:[{rank:2,name:'Debate',type:'Academic'},{rank:1,name:'Robotics',type:'Academic',desc:'Build lead'}]}));
  let ws=await getWorkspace(id);assert.deepEqual(ws.profile.activities.map(a=>[a.rank,a.name]),[[1,'Robotics'],[2,'Debate']]);
  assert.match(await executeTool('upsert_activity',JSON.stringify({name:'Robotics',role:'Captain',desc:''})),/Updated the activity "Robotics" at #1/);
  assert.match(await executeTool('upsert_activity',JSON.stringify({name:'Orchestra',type:'Arts',rank:1})),/Added the activity "Orchestra" at #1/);
  ws=await getWorkspace(id);
  assert.deepEqual(ws.profile.activities.map(a=>[a.rank,a.name]),[[1,'Orchestra'],[2,'Robotics'],[3,'Debate']]);
  assert.equal(ws.profile.activities[1].role,'Captain');assert.equal(ws.profile.activities[1].desc,'Build lead');
  assert.match(await executeTool('upsert_activity',JSON.stringify({name:'Long',desc:'x'.repeat(151)})),/^Not saved: Activity descriptions/);
  assert.equal(await executeTool('remove_activity',JSON.stringify({name:'orchestra'})),'Removed the activity.');
  assert.deepEqual((await getWorkspace(id)).profile.activities.map(a=>[a.rank,a.name]),[[1,'Robotics'],[2,'Debate']]);
  assert.match(await executeTool('set_activities',JSON.stringify({activities:Array.from({length:11},(_,i)=>({rank:i+1,name:'A'+i,type:'Other'}))})),/^Not saved: Keep up to 10/);
  for(const title of ['One','Two','Three','Four','Five']) await executeTool('upsert_honor',JSON.stringify({title,level:'School'}));
  assert.match(await executeTool('upsert_honor',JSON.stringify({title:'Six',level:'School'})),/^Not saved/);
  assert.equal(await executeTool('upsert_honor',JSON.stringify({match:'Two',level:'National',top:true})),'Updated the honor.');
  await executeTool('remove_honor',JSON.stringify({title:'One'}));
  ws=await getWorkspace(id);assert.equal(ws.profile.honors.length,4);assert.equal(ws.applicant.awards,4);
  assert.deepEqual(ws.profile.honors[0],{title:'Two',level:'National',top:true});
  // Models fill unused optional booleans with false; only "no" un-stars.
  assert.equal(await executeTool('upsert_honor',JSON.stringify({match:'Two',year:'2026',top:false})),'Updated the honor.');
  assert.equal((await getWorkspace(id)).profile.honors[0].top,true);
  await executeTool('upsert_honor',JSON.stringify({match:'Two',top:'no'}));
  assert.equal((await getWorkspace(id)).profile.honors[0].top,false);
}));
test('set_list_preferences validates and rebalance_list keeps the student\'s own schools', async()=>workspace(async(id,before)=>{
  const {executeTool}=makeHubTools(id,{userText:'Make my list more conservative with fewer reaches'});
  assert.match(await executeTool('set_list_preferences',JSON.stringify({budget:'cheap'})),/^Not saved: Budget/);
  await executeTool('set_list_preferences',JSON.stringify({ambition:'conservative',appCount:0,regions:[],budget:'30-50',needAid:true,ed:'maybe',notes:''}));
  const ws=await getWorkspace(id);const prefs=ws.onboarding.listPrefs;
  assert.equal(prefs.ambition,'conservative');assert.equal(prefs.budget,'30-50');assert.equal(prefs.needAid,true);assert.equal(prefs.ed,'maybe');
  assert.equal(prefs.appCount,undefined);assert.deepEqual(prefs.regions,[]);
  assert.deepEqual(ws.colleges,before.colleges);
  await executeTool('set_list_preferences',JSON.stringify({ambition:'conservative',needAid:false}));
  assert.equal((await getWorkspace(id)).onboarding.listPrefs.needAid,true);
  assert.match(await executeTool('rebalance_list','{}'),/^Rebalanced the list/);
  assert.ok(Array.isArray((await getWorkspace(id)).onboarding.listGaps));
  const after=await getWorkspace(id);
  assert.ok(after.colleges.some(c=>c.slug==='princeton-university'));
  assert.ok(after.colleges.filter(c=>c.slug!=='princeton-university').every(c=>c.origin==='seed'));
}));
