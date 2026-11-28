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
// A school page with everything filled in (#shortlist/<first slug>): synthetic facts, rounds, prompts and an estimate.
ws.onboarding.listPrefs={...ws.onboarding.listPrefs,incomeBracket:'75-110',budget:'15-30',needAid:process.env.FIXTURE_NEED_AID!=='no'};
// Synthetic aid details for the Recs & aid estimate (lib/aid-estimate.ts).
ws.aidProfile={householdSize:4,parentStatus:'married',parentsFiledTaxes:'yes',parentAgi:92000,parentAssets:'10-50',studentIncome:'lt5'};
const src='https://example.edu/fixture';
const fx=(key,value,extra={})=>({key,value,sourceUrl:src,checkedAt:'2026-09-15',cycle:'2026-27',thirdParty:false,...extra});
const first=ws.colleges[0];
ws.colleges[0]={...first,tier:'reach',deadline:'EA · Nov 1',deadlines:[{plan:'EA',date:'2026-11-01'},{plan:'RD',date:'2027-01-05'},{plan:'Merit scholarship',date:'2026-12-01'}],plans:[{plan:'EA',rate:'15%'},{plan:'RD',rate:'8%'}],fee:'$80',
 research:{slug:first.slug,name:first.name,checkedAt:'2026-09-15',complete:true,deadlines:[],supplements:[],facts:[fx('admit_rate','11% overall'),fx('sat_mid50','1450–1550'),fx('act_mid50','33–35'),fx('test_policy','Test-optional; self-reported scores accepted'),fx('sticker_cost','$86,000 a year'),fx('meets_full_need','Meets 100% of demonstrated need'),fx('css_profile','Required for need-based aid'),fx('merit_aid','Limited merit scholarships',{thirdParty:true,sourceUrl:'https://example.org/guide'}),fx('net_price_75_110k','$18,400 a year'),fx('net_price_gt110k','$41,000 a year',{cycle:'2025-26'}),fx('ed_ea_options','Non-restrictive Early Action and Regular Decision'),fx('interview','Optional alumni interview, evaluative'),fx('demonstrated_interest','Not considered',{cycle:'2025-26'}),fx('major_notes','Computer science admits by college; internal transfer needs a 3.3 GPA',{cycle:'2024-25'})]}};
ws.colleges[1]={...ws.colleges[1],tier:'target',deadline:'RD · Jan 5',deadlines:[{plan:'RD',date:'2027-01-05'}]};
ws.colleges[2]={...ws.colleges[2],tier:'safety'};
ws.essays.supplements={[first.slug]:[{id:'fx-why',label:'Why this school',prompt:'Tell us why you want to study here and what you hope to explore. Be specific about programs, people or places that draw you.',limit:250,unit:'words'},{id:'fx-community',label:'Community',prompt:'Describe a community you belong to and your place within it.',limit:200,unit:'words'},{id:'fx-optional',label:'Optional: anything else',prompt:'Is there anything else you would like us to know?',limit:150,unit:'words',required:false}]};
ws.essayDrafts={...ws.essayDrafts,'fx-why':'The robotics lab and the first-year design studio are why I keep coming back to this school, because they let students build things that real people use.'};
ws.essayStatus={'fx-community':'final'};
ws.essayDrafts['fx-community']='At the library on Saturdays I am the person who helps younger readers find the next book.';
ws.admissionOdds={[first.slug]:{percent:14,low:9,high:21,baselineSource:'EA admit rate',summary:'A strong CS profile against a very selective pool.',factors:[{label:'SAT',effect:'down',detail:'Below the middle 50%'},{label:'Activities',effect:'up',detail:'Sustained robotics leadership'}],sources:[src],estimatedAt:'2026-10-01T00:00:00.000Z'}};
// FIXTURE_NEED_AID=yes|no: the student's need-based aid answer, with synthetic aid-form dates on two schools.
if(process.env.FIXTURE_NEED_AID){
 ws.onboarding.listPrefs={...ws.onboarding.listPrefs,needAid:process.env.FIXTURE_NEED_AID==='yes'};
 ws.colleges[0]={...ws.colleges[0],deadlines:[...ws.colleges[0].deadlines,{plan:'CSS Profile',date:'2026-12-15'},{plan:'FAFSA',date:'2027-02-01'}]};
 ws.colleges[1]={...ws.colleges[1],deadlines:[...ws.colleges[1].deadlines,{plan:'Financial aid priority',date:'2027-01-15'},{plan:'FAFSA',date:'2027-03-01'}]};
}
const {newApp}=require('../lib/tracker.ts');
const {viewTracker}=require('../lib/tracker-service.ts');
const {studentScores}=require('../lib/testing-plan.ts');
const {schoolInsights}=require('../lib/school-detail.ts');
const {aidPlan}=require('../lib/aid-plan.ts');
const {aidEstimate}=require('../lib/aid-estimate.ts');
const {aidChecklist}=require('../lib/aid-checklist.ts');
const {AID_FIELD_WHY}=require('../lib/aid-profile.ts');
ws.tracker={...ws.tracker,apps:[{...newApp({name:first.name,slug:first.slug}),status:'in_progress',testing:{plan:'send',method:'self_report'}},{...newApp({name:ws.colleges[1].name,slug:ws.colleges[1].slug}),status:'submitted'}]};
const pts=Array.from({length:40},(_,i)=>({sat:1300+((i*37)%300),gpa:Math.round((3.4+((i*13)%60)/100)*100)/100,result:i%3?'Denied':'Accepted',round:i%4?'RD':'EA'}));
const scatter={version:1,importedAt:Date.now(),classOfYears:'2023-2026',student:null,colleges:{[first.slug]:{slug:first.slug,name:first.name,rank:null,maiaTitle:first.name,fetchedAt:Date.now(),n:pts.length,counts:{Accepted:pts.filter(p=>p.result==='Accepted').length,Denied:pts.filter(p=>p.result==='Denied').length},averages:{sat:1450,gpa:3.7},points:pts}}};
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
  if(req.method==='GET' && url.pathname==='/api/me')return json({signedIn:true,user:{email:'student@example.com',name:'Alex Rivera'},needsOnboarding:false,parent:{students:0,home:false,counselor:false}});
  if(req.method==='GET' && url.pathname==='/api/applications')return json({success:true,data:viewTracker(ws.tracker,undefined,ws.revision,studentScores(ws),ws.colleges)});
  if(req.method==='GET' && url.pathname==='/api/workspace/school'){const d=schoolInsights(ws,url.searchParams.get('slug')||'');return d?json({success:true,data:d}):json({success:false,error:"That school isn't on your list."},404);}
  if(req.method==='GET' && url.pathname==='/api/aid'){const plan=aidPlan(ws);return json({success:true,data:{...plan,estimate:aidEstimate(ws),checklist:aidChecklist(ws,plan),details:ws.aidProfile??{},why:AID_FIELD_WHY}});}
  if(req.method==='GET' && url.pathname==='/api/workspace/scattergrams')return json({success:true,data:scatter});
  if(req.method==='GET' && url.pathname==='/api/colleges/recommendations')return json({success:true,data:recommendColleges(ws)});
  if(req.method==='GET' && url.pathname==='/api/colleges/search')return json({success:true,data:ws.colleges});
  if(req.method==='GET' && url.pathname==='/api/colleges/detail')return json({success:true,data:{...ws.colleges.find(c=>c.scorecardId===Number(url.searchParams.get('id'))),programs:[]}});
  if(req.method==='GET' && url.pathname==='/api/ai/status')return json({active:null,codexConnected:false,grokConnected:false,opencodeAvailable:false,codexModels:[],grokModels:[]});
  return json({error:'This isolated fixture does not connect accounts, share data, or call AI.'},405);
 }
 try{const file=path.resolve(publicDir,'.'+(url.pathname==='/'?'/hub/index.html':decodeURIComponent(url.pathname)));if(!file.startsWith(publicDir+path.sep)){res.writeHead(403);return res.end();}const content=await readFile(file);res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(content);}catch{res.writeHead(404);res.end('Not found');}
});
const port=Number(process.env.PORT)||3211;
server.listen(port,'127.0.0.1',()=>console.log(`Synthetic UI fixture: http://127.0.0.1:${port} (memory only; no live services)`));
