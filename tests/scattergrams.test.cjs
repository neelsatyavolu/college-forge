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
const route = require('../app/api/workspace/scattergrams/route.ts');
const workspace = require('../app/api/workspace/route.ts');
const share = require('../app/api/share/[token]/route.ts');

const WS = 'scatter-test-workspace';
function req(method, body) {
 return new NextRequest('http://localhost/api/workspace/scattergrams', {method, headers:{cookie:'cf_workspace='+WS,'content-type':'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
}
async function isolated(run) {
 const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'forge-scatter-'));
 const prev=process.env.CF_DATA_DIR,blob=process.env.BLOB_READ_WRITE_TOKEN;process.env.CF_DATA_DIR=dir;delete process.env.BLOB_READ_WRITE_TOKEN;
 try {
  await store.updateWorkspace(WS, (ws) => ({...ws, colleges: [
   {slug:'tufts-university',name:'Tufts University',short:'Tufts',scorecardId:168148},
   {slug:'bates-college',name:'Bates College',short:'Bates'},
  ]}));
  await run(dir);
 } finally {if(prev===undefined)delete process.env.CF_DATA_DIR;else process.env.CF_DATA_DIR=prev;if(blob===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=blob;await fs.promises.rm(dir,{recursive:true,force:true});}
}
const tufts = {slug:'tufts-university', maiaTitle:'Tufts University', averages:{gpa:3.9,sat:1510}, points:[
 {sat:1520,gpa:3.95,result:'Accepted',round:'Early Decision'},
 {sat:1450,gpa:3.7,result:'Denied ',round:'Regular Decision'},
 {sat:1480,gpa:3.8,result:'Waitlisted',round:'Regular Decision'},
]};

test('import stores sanitized scattergrams for list colleges only, outside the workspace', () => isolated(async () => {
 const r = await route.POST(req('POST', {classOfYears:'4', student:{gpa:3.5,wgpa:3.9,sat:1500}, colleges:[tufts, {slug:'not-on-list', points:[{sat:1400,gpa:3.5,result:'Accepted'}]}]}));
 assert.equal(r.status, 200);
 const j = await r.json();
 assert.equal(j.success, true);
 assert.deepEqual(j.data.skipped, ['not-on-list']);
 const t = j.data.scattergrams.colleges['tufts-university'];
 assert.equal(t.name, 'Tufts University');
 assert.equal(t.n, 3);
 assert.deepEqual(t.counts, {Accepted:1, Denied:1, Waitlisted:1});
 assert.equal(t.points[1].result, 'Denied');
 assert.deepEqual(j.data.scattergrams.student, {gpa:3.5,wgpa:3.9,sat:1500});
 assert.equal(j.data.scattergrams.classOfYears, '4');
 assert.equal(j.data.scattergrams.colleges['not-on-list'], undefined);

 const g = await (await route.GET(req('GET'))).json();
 assert.equal(g.data.colleges['tufts-university'].n, 3);

 const ws = await (await workspace.GET(req('GET'))).json();
 assert.equal(JSON.stringify(ws).includes('Waitlisted'), false, 'points never enter the workspace document');
}));

test('share links never expose imported scattergrams', () => isolated(async () => {
 await route.POST(req('POST', {colleges:[tufts]}));
 const created = await (await workspace.POST(new NextRequest('http://localhost/api/workspace',{method:'POST',headers:{cookie:'cf_workspace='+WS,'content-type':'application/json'},body:JSON.stringify({action:'create-share'})}))).json();
 const view = await share.GET(new NextRequest('http://localhost/api/share/'+created.token), {params:Promise.resolve({token:created.token})});
 assert.equal(view.status, 200);
 assert.equal((await view.text()).includes('Waitlisted'), false);
}));

test('bad points are dropped or nulled instead of stored', () => isolated(async () => {
 const r = await route.POST(req('POST', {colleges:[{slug:'bates-college', averages:{gpa:9,sat:'1400'}, points:[
  {sat:2000,gpa:3.5,result:'Accepted'},
  {sat:1400,gpa:7,result:'Denied'},
  {sat:null,gpa:null,result:'Accepted'},
  {sat:1300,gpa:3.1,result:'x'.repeat(200),round:'<script>'},
  'not a point',
 ]}]}));
 assert.equal(r.status, 200);
 const b = (await r.json()).data.scattergrams.colleges['bates-college'];
 assert.equal(b.n, 3);
 assert.deepEqual(b.points[0], {sat:null,gpa:3.5,result:'Accepted',round:null});
 assert.deepEqual(b.points[1], {sat:1400,gpa:null,result:'Denied',round:null});
 assert.equal(b.points[2].result, 'Other');
 assert.deepEqual(b.averages, {gpa:null,sat:1400});
}));

test('outcomes collapse to a fixed set, so hostile labels stay cheap and harmless', () => isolated(async () => {
 const points = Array.from({length:5000}, (_, i) => ({sat:1400, gpa:3.5, result: i === 0 ? '__proto__' : i === 1 ? 'accepted' : 'r' + i}));
 const started = Date.now();
 const r = await route.POST(req('POST', {colleges:[{slug:'bates-college', points}]}));
 assert.equal(r.status, 200);
 assert.ok(Date.now() - started < 1000, 'counting stays linear');
 const b = (await r.json()).data.scattergrams.colleges['bates-college'];
 assert.deepEqual(b.counts, {Other:4999, Accepted:1});
 const tooMany = Array.from({length:11}, () => ({slug:'bates-college', points:Array.from({length:5000}, () => ({sat:1400,gpa:3.5,result:'Accepted'}))}));
 assert.equal((await route.POST(req('POST', {colleges:tooMany}))).status, 400);
}));

test('an import drops stored data for unranked colleges no longer on the list', () => isolated(async () => {
 await route.POST(req('POST', {colleges:[tufts, {slug:'bates-college', points:[]}]}));
 await store.updateWorkspace(WS, (ws) => ({...ws, colleges: ws.colleges.filter((c) => c.slug !== 'bates-college')}));
 const j = await (await route.POST(req('POST', {colleges:[tufts]}))).json();
 assert.deepEqual(Object.keys(j.data.scattergrams.colleges), ['tufts-university']);
}));

test('U.S. News top-250 schools import even when they are not on the list', () => isolated(async () => {
 const j = await (await route.POST(req('POST', {colleges:[{slug:'boston-college', maiaTitle:'Boston College', points:[{sat:1450,gpa:3.9,result:'Accepted'}]}]}))).json();
 assert.deepEqual(j.data.skipped, []);
 const bc = j.data.scattergrams.colleges['boston-college'];
 assert.equal(bc.name, 'Boston College');
 assert.equal(bc.rank, 31);
 assert.equal(bc.n, 1);
 assert.equal(j.data.scattergrams.colleges['tufts-university'], undefined);
 const later = await (await route.POST(req('POST', {colleges:[tufts]}))).json();
 assert.equal(later.data.scattergrams.colleges['boston-college'].n, 1, 'ranked schools survive later imports');
 assert.equal(later.data.scattergrams.colleges['tufts-university'].rank, 31);
 assert.equal(later.data.scattergrams.colleges['bates-college'], undefined);
}));

test('empty imports are kept so the UI can say the school has no data', () => isolated(async () => {
 const b = (await (await route.POST(req('POST', {colleges:[{slug:'bates-college', points:[]}]}))).json()).data.scattergrams.colleges['bates-college'];
 assert.equal(b.n, 0);
 assert.deepEqual(b.points, []);
}));

test('a later import replaces only the colleges it includes', () => isolated(async () => {
 await route.POST(req('POST', {colleges:[tufts, {slug:'bates-college', points:[{sat:1400,gpa:3.6,result:'Accepted'}]}]}));
 const j = await (await route.POST(req('POST', {colleges:[{slug:'bates-college', points:[]}]}))).json();
 assert.equal(j.data.scattergrams.colleges['tufts-university'].n, 3);
 assert.equal(j.data.scattergrams.colleges['bates-college'].n, 0);
}));

test('invalid bodies are rejected', () => isolated(async () => {
 for (const body of [null, [], 123, 'x', {}, {colleges:[]}, {colleges:'nope'}, {colleges:Array.from({length:301},(_,i)=>({slug:'s'+i,points:[]}))}]) {
  const r = await route.POST(req('POST', body));
  assert.equal(r.status, 400, JSON.stringify(body).slice(0,40));
  assert.equal((await r.json()).success, false);
 }
 const tooMany = await route.POST(req('POST', {colleges:[{slug:'bates-college', points:Array.from({length:5001},()=>({sat:1400,gpa:3.5,result:'Accepted'}))}]}));
 assert.equal(tooMany.status, 400);
}));

test('DELETE and workspace reset both remove imported data', () => isolated(async () => {
 await route.POST(req('POST', {colleges:[tufts]}));
 assert.equal((await route.DELETE(req('DELETE'))).status, 200);
 assert.equal((await (await route.GET(req('GET'))).json()).data, null);

 await route.POST(req('POST', {colleges:[tufts]}));
 await workspace.POST(new NextRequest('http://localhost/api/workspace',{method:'POST',headers:{cookie:'cf_workspace='+WS,'content-type':'application/json'},body:JSON.stringify({action:'reset'})}));
 assert.equal((await (await route.GET(req('GET'))).json()).data, null);
}));
