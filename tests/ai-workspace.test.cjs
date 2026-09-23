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
