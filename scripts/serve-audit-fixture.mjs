// Local, in-memory UI fixture. It never accesses credentials or live API/storage.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import ts from 'typescript';
const require=createRequire(import.meta.url);
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021,esModuleInterop:true,resolveJsonModule:true}}).outputText,file);
const {emptyWorkspace}=require('../lib/store.ts');
const {recommendColleges}=require('../lib/college-recommendations.ts');
const {applyWorkspacePatch}=require('../lib/workspace-patch.ts');
let ws=emptyWorkspace();
Object.assign(ws.applicant,{name:'Alex Rivera',cycle:'Fall 2027',year:'Class of 2027',gpaUnweighted:'3.75',gpaWeighted:'4.2',sat:'1420',awards:3});
Object.assign(ws.profile,{intended:'Computer Science',hs:'Example High School',gradYear:2027,location:'Sacramento, CA',residency:'California',counselor:'Example counselor'});
ws.profile.testing={sat:'1420',satNote:'',aps:[{course:'Computer Science A',score:'5'},{course:'Calculus AB',score:'4'}]};
ws.profile.coursework={honors:['English III','Chemistry'],aps:['Computer Science A','Calculus AB'],senior:['AP Physics','AP Literature']};
ws.profile.activities=[{rank:1,name:'Robotics and community technology mentoring',type:'Science/Math',org:'Example robotics team',years:'9–12',role:'Team captain',hpw:'8',wpy:'32',desc:'Led weekly build sessions and taught younger students how to design and debug their first robots.',bullets:['Organized accessible introductory coding workshops.']},{rank:2,name:'Community library volunteer',type:'Community service',years:'10–12',role:'Volunteer',hpw:'3',wpy:'24',desc:'Helped younger readers find books and complete learning activities.'}];
ws.profile.honors=[{title:'Regional engineering design award',level:'State',year:'11',top:true},{title:'School service recognition',level:'School',year:'10'},{title:'Mathematics team finalist',level:'Regional',year:'11'}];
ws.onboarding={completed:true,listPrefs:{ambition:'balanced',settings:[],regions:[],size:'any',notes:''}};
ws.colleges=recommendColleges(ws).recommendations.slice(0,8).map((r,i)=>({...r.college,photo:null,short:r.college.name,deadline:'Jan 5, 2027',deadlines:[{plan:'Regular Decision',date:'2027-01-05'}],supp:i%2?'Supps optional':'Supps required'}));
ws.applications={[ws.colleges[0].slug]:{status:'preparing'},[ws.colleges[1].slug]:{status:'submitted'}};
ws.essayDrafts={[ws.essays.commonApp[0].id]:'I used to think a successful robot was one that never made a mistake. Teaching younger students changed that. When our first prototype stopped halfway across the room, the best part of the afternoon began: everyone had a different explanation, and we finally started asking questions together.'};
ws.criticalDates=[{date:'2026-10-10',label:'Request teacher recommendation',detail:'Ask a teacher who knows your work well.'},{date:'2026-11-01',label:'Review application drafts',detail:'Leave time for a second read.'}];
ws.recommendations=[{id:'example-teacher',name:'Example science teacher',type:'teacher',subject:'Physics',status:'asked',deadline:'2026-11-01'}];
ws.scholarships=[{id:'example-award',name:'Example community scholarship',amount:'Amount to verify',deadline:'2027-02-01',status:'researching'}];
const publicDir=path.resolve('public');
const types={'.html':'text/html','.js':'text/javascript','.jsx':'text/plain','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.png':'image/png'};
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 const json=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
 if(url.pathname.startsWith('/api/')){
  if(url.pathname==='/api/workspace'){
   if(req.method==='GET')return json(ws);
   if(req.method==='PATCH') {let raw='';for await(const chunk of req)raw+=chunk;try{ws={...applyWorkspacePatch(ws,JSON.parse(raw)),revision:ws.revision+1};return json({success:true,data:ws});}catch{return json({error:'Invalid fixture request'},400);}}
  }
  if(req.method==='GET' && url.pathname==='/api/colleges/recommendations')return json({success:true,data:recommendColleges(ws)});
  if(req.method==='GET' && url.pathname==='/api/colleges/search')return json({success:true,data:ws.colleges});
  if(req.method==='GET' && url.pathname==='/api/colleges/detail')return json({success:true,data:{...ws.colleges.find(c=>c.scorecardId===Number(url.searchParams.get('id'))),programs:[]}});
  if(req.method==='GET' && url.pathname==='/api/ai/status')return json({active:null,codexConnected:false,grokConnected:false,opencodeAvailable:false,codexModels:[],grokModels:[]});
  return json({error:'This isolated fixture does not connect accounts, share data, or call AI.'},405);
 }
 try{const file=path.resolve(publicDir,'.'+(url.pathname==='/'?'/hub/index.html':decodeURIComponent(url.pathname)));if(!file.startsWith(publicDir+path.sep)){res.writeHead(403);return res.end();}const content=await readFile(file);res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(content);}catch{res.writeHead(404);res.end('Not found');}
});
server.listen(3211,'127.0.0.1',()=>console.log('Synthetic UI fixture: http://127.0.0.1:3211 (memory only; no live services)'));
