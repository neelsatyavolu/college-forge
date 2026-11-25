const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
// Compile local TypeScript on demand without a second build or test dependency.
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2021, esModuleInterop:true, resolveJsonModule:true}}).outputText,file);
const { recommendColleges, assessAcademicFit, seedRecommendedColleges, realismGate, studentAcademics, GATE } = require('../lib/college-recommendations.ts');
const { emptyWorkspace } = require('../lib/store.ts');
const data = require('../public/data/rankings/top250.json');
const { US_NEWS_TOP_250 } = require('../lib/us-news-rankings.ts');
const profile = () => { const ws = emptyWorkspace(); ws.applicant.gpaUnweighted='3.7'; ws.applicant.sat='1400'; ws.profile.intended='Computer Science'; return ws; };
test('recommendations contain real, unique fair-ranking institutions and sourced metrics', () => {
 const result = recommendColleges(profile());
 assert.equal(result.generatedAt, data.generated);
 assert.equal(result.recommendations.length,12);
 assert.equal(new Set(result.recommendations.map(x=>x.college.scorecardId)).size,12);
 for(const r of result.recommendations){const source=data.schools.find(x=>x.unitid===r.college.scorecardId); assert.ok(source); assert.equal(r.evidence.fairRank,source.rank_partial); assert.equal(r.evidence.netPrice,source.net_price);}
 assert.ok(result.recommendations.some(x=>x.evidence.major));
 assert.ok(result.recommendations.some(x=>x.fit.tier==='reach'));
 assert.ok(result.recommendations.some(x=>x.fit.tier==='target'));
 assert.ok(result.recommendations.some(x=>x.fit.tier==='safety'));
});
test('regional preferences are never silently relaxed', () => {
 for (const regions of [['northeast'],['west']]) {
  const ws=profile();ws.onboarding.listPrefs={regions,settings:['rural'],ambition:'balanced',size:'any',notes:''};
  const result=recommendColleges(ws);assert.ok(result.recommendations.length);
  const outside=result.recommendations.filter(r=>!/^Matches your preferred region/.test(r.fit.reasons.find(x=>/region/.test(x))||''));
  for(const r of outside) assert.match(r.fit.reasons[0],/^Outside your region or campus setting choices/);
  if(outside.length) assert.ok(result.limitations.some(x=>/outside your region or campus setting choices/.test(x)));
 }
 const ws=profile();ws.onboarding.listPrefs={regions:['northeast'],settings:[],ambition:'balanced',size:'any',notes:''};
 for(const r of recommendColleges(ws).recommendations.filter(r=>!/^Outside/.test(r.fit.reasons[0]))) assert.ok(['ME','NH','VT','MA','RI','CT'].includes(data.schools.find(x=>x.unitid===r.college.scorecardId).state));
});
test('missing academic profile does not create personal admission tiers', () => {
 const result=recommendColleges(emptyWorkspace());
 assert.ok(result.profileGaps.length);
 assert.ok(result.recommendations.every(x=>x.fit.tier===null));
});
test('a weighted-only GPA is not compared with unweighted averages, and says so', () => {
 const ws=emptyWorkspace();ws.applicant.gpaWeighted='4.8';
 const result=recommendColleges(ws);
 assert.equal(studentAcademics(ws).gpa,null);
 assert.ok(result.recommendations.every(x=>x.fit.tier===null), 'no academic categories from a weighted GPA alone');
 assert.ok(result.profileGaps.some(x=>/unweighted GPA/.test(x)));
});
const selective=(admitRate)=>({ slug:'x', admitRate, sat25:1450, sat75:1550, gpa:3.9, gpaWeighted:false });
const academics=(gpa,sat,trendUp=false)=>({ gpa, sat, trendUp, gpaFromWeighted:false, satFromAct:false, testOptional:sat===null, cautions:[] });
test('the realism gate keeps out-of-range students away from very selective colleges', () => {
 assert.equal(realismGate(selective(0.08),academics(3.4,1300),true).ok,false);
 assert.equal(realismGate(selective(0.08),academics(3.85,1440),true).ok,false,'SAT below the 25th percentile');
 assert.equal(realismGate(selective(0.08),academics(3.85,1450),false).ok,true,'inside the range');
 assert.equal(realismGate(selective(0.08),academics(3.75,1500),false).ok,false,'GPA 0.15 under the average');
 assert.equal(realismGate(selective(0.25),academics(3.7,1400),false).ok,true,'15-35%: half a width below p25 and 0.25 under the GPA average');
 assert.equal(realismGate(selective(0.25),academics(3.6,1400),false).ok,false);
 assert.equal(realismGate(selective(0.5),academics(2.0,900),false).ok,true,'less selective colleges use the other checks');
});
test('the gate is monotonic: better academics never fail where worse ones pass', () => {
 for (const admit of [0.05,0.2]) for (let gpa=3.0;gpa<=4.0;gpa+=0.05) for (let sat=1200;sat<=1600;sat+=20) {
  const ok=realismGate(selective(admit),academics(gpa,sat),false).ok;
  if (ok) assert.equal(realismGate(selective(admit),academics(Math.min(4,gpa+0.05),Math.min(1600,sat+20)),false).ok,true);
 }
});
test('missing comparisons never pass the gate', () => {
 assert.equal(realismGate({...selective(0.1),gpa:null},academics(4.0,null),true).ok,false,'test-optional with no comparable GPA');
 assert.equal(realismGate({...selective(0.1),gpa:3.9,gpaWeighted:true},academics(4.0,null),true).ok,false,'weighted college average');
 assert.equal(realismGate({...selective(0.1),gpa:null},academics(3.0,1500),true).ok,true,'SAT alone can qualify');
});
test('an upward trend helps only ambitious students, and only on the GPA test', () => {
 const s=selective(0.08);
 assert.equal(realismGate(s,academics(3.72,1500,true),false).ok,false,'not ambitious');
 assert.equal(realismGate(s,academics(3.72,1500,true),true).ok,true,'ambitious + upward trend');
 assert.equal(realismGate(s,academics(3.72,1440,true),true).ok,false,'SAT test unchanged');
 assert.equal(GATE.trendRelief,0.1);
 assert.equal(realismGate(s,academics(3.72,1500,true),true).passedBecauseOfTrend,true);
 assert.equal(realismGate(s,academics(3.85,1500,true),true).passedBecauseOfTrend,undefined,'passes without the relief');
 assert.equal(realismGate({...s,gpa:null},academics(3.0,1500,true),true).passedBecauseOfTrend,undefined,'no GPA comparison, no relief');
});
test('the trend reason appears exactly where the trend let a college through', () => {
 const ws=profile();ws.applicant.gpaUnweighted='3.6';ws.applicant.sat='1500';ws.applicant.gpaTrend='up';ws.onboarding.listPrefs={ambition:'ambitious',settings:[],size:'any',regions:[],notes:''};
 const rows=recommendColleges(ws).recommendations;
 for (const r of rows) {
  const school=US_NEWS_TOP_250.find(x=>x.scorecardId===r.college.scorecardId);
  const said=r.fit.reasons.some(x=>/upward grade trend/.test(x));
  const real=!!(school && realismGate(school,studentAcademics(ws),true).passedBecauseOfTrend);
  assert.equal(said,real,r.college.name);
 }
});
test('low academics are never seeded with colleges admitting under 15%', () => {
 const ws=profile();ws.applicant.gpaUnweighted='3.2';ws.applicant.sat='1150';ws.onboarding.listPrefs={ambition:'ambitious',settings:[],size:'any',regions:[],notes:''};
 const {colleges}=seedRecommendedColleges(ws);
 const rate=(c)=>US_NEWS_TOP_250.find(x=>x.scorecardId===c.scorecardId)?.admitRate;
 assert.ok(colleges.length>0);
 assert.ok(colleges.every(c=>!(rate(c)<0.15)), colleges.filter(c=>rate(c)<0.15).map(c=>c.name).join(', '));
});
test('saved schools do not use up a category before it is filled', () => {
 const ws=profile();ws.onboarding.listPrefs={ambition:'balanced',settings:[],size:'any',regions:[],notes:''};
 const first=seedRecommendedColleges(ws);
 const saved={...first.colleges.find(c=>c.tier==='target'),origin:'user'};
 const again=seedRecommendedColleges({...ws,colleges:[saved]});
 assert.equal(again.colleges.filter(c=>c.slug===saved.slug).length,1);
 assert.deepEqual(again.gaps,first.gaps);
});
test('very selective schools remain reaches even with perfect academics', () => {
 const ws=profile();ws.applicant.gpaUnweighted='4.0';ws.applicant.sat='1600';
 assert.equal(assessAcademicFit(US_NEWS_TOP_250.find(x=>x.slug==='princeton-university'),ws).tier,'reach');
});
test('UC academic assessment ignores SAT scores', () => {
 const school=US_NEWS_TOP_250.find(x=>x.slug==='university-of-california-davis');
 const ws=profile();ws.applicant.sat='800';const before=assessAcademicFit(school,ws);
 ws.applicant.sat='1600';assert.deepEqual(assessAcademicFit(school,ws),before);
});
test('unknown intended major never becomes invented major fit', () => {
 const ws=profile();ws.profile.intended='Underwater basket weaving';
 const result=recommendColleges(ws);assert.ok(result.recommendations.every(x=>x.evidence.major===null));assert.ok(result.profileGaps.some(x=>/major/i.test(x)));
});
test('read-only recommendation generation preserves saved choices', () => {
 const ws=profile();ws.colleges=[{name:'My school',short:'My school',slug:'my-school'}];const before=JSON.stringify(ws);
 recommendColleges(ws);assert.equal(JSON.stringify(ws),before);
});
test('mid-range profiles are not automatically sent to an ultra-selective prestige list', () => {
 const ws=profile();ws.applicant.gpaUnweighted='3.0';ws.applicant.sat='1100';
 for (const r of recommendColleges(ws).recommendations) {
   const admission=US_NEWS_TOP_250.find(s=>s.scorecardId===r.college.scorecardId);
   assert.ok(!admission || admission.admitRate===null || admission.admitRate>=0.1);
 }
});

test('onboarding preserves must-includes and fills missing academic categories first', () => {
 const ws=profile();
 ws.colleges=US_NEWS_TOP_250.slice(0,5).map(c=>({slug:c.slug,name:c.name,short:c.name,scorecardId:c.scorecardId,tier:'reach'}));
 const original=JSON.stringify(ws.colleges);const {colleges:result}=seedRecommendedColleges(ws);
 assert.equal(result.length,12);assert.equal(JSON.stringify(ws.colleges),original);
 assert.deepEqual(result.slice(0,5),ws.colleges);
 assert.ok(result.slice(5).every(c=>c.tier!=='reach'));
 assert.ok(result.some(c=>c.tier==='safety'));
});
test('test-optional note prevents stale scores affecting fit', () => {
 const ws=profile();ws.applicant.satNote='Test optional';ws.applicant.sat='800';ws.profile.testing.sat='1600';
 const school=US_NEWS_TOP_250.find(x=>x.slug==='arizona-state-university');
 const before=assessAcademicFit(school,ws);ws.applicant.sat='1600';assert.deepEqual(assessAcademicFit(school,ws),before);
 assert.ok(!before.reasons.some(x=>x.includes('Your SAT')));
});
test('saving grounded recommendations does not recalculate their tiers', () => {
 const {upsertCollegeInto}=require('../lib/colleges.ts');const ws=profile();
 const candidate=recommendColleges(ws).recommendations[0];
 const saved=upsertCollegeInto(ws,candidate.college).colleges[0];
 assert.equal(saved.tier,candidate.fit.tier);assert.equal(saved.verdict.label,candidate.fit.label);
});
test('Explore never treats fractional low admission rates as likely', () => {
 const {fitFor}=require('../lib/colleges.ts');
 assert.equal(fitFor({admit:'9.5%',satRange:'1400–1550'},'1600').tier,'reach');
 assert.equal(fitFor({admit:'65%',satRange:'1000–1400'},'1100').tier,'target');
});
test('Explore ignores UC testing and test-optional scores', () => {
 const {fitFor}=require('../lib/colleges.ts');
 assert.equal(fitFor({slug:'university-of-california-davis',admit:'50%',satRange:'1200–1450'},'1600').tier,undefined);
 assert.equal(fitFor({admit:'80%',satRange:'1200–1450'},'1600','Test optional').tier,undefined);
});
test('list preference patches normalize fields while preserving onboarding context', () => {
 const {applyWorkspacePatch}=require('../lib/workspace-patch.ts');const ws=profile();
 ws.onboarding={completed:true,completedAt:10,storyNotes:{activities:'a',awards:'b',other:'c'},listPrefs:{ambition:'balanced',size:'large',settings:[],regions:[],notes:'keep'}};
 const next=applyWorkspacePatch(ws,{listPrefs:{ambition:'conservative',regions:['west','invalid','west'],settings:['urban','fake'],appCount:13.7}});
 assert.deepEqual(next.onboarding.listPrefs,{ambition:'conservative',size:'large',settings:['urban'],regions:['west'],notes:'keep',appCount:14});
 assert.equal(next.onboarding.completed,true);assert.equal(next.onboarding.completedAt,10);assert.deepEqual(next.onboarding.storyNotes,ws.onboarding.storyNotes);
 const invalid=applyWorkspacePatch(next,{listPrefs:{ambition:'fake',size:'fake',appCount:Infinity,notes:5}});
 assert.deepEqual(invalid.onboarding.listPrefs,next.onboarding.listPrefs);
});
test('a college without comparable academic evidence is categorized by admission rate alone, and says so', () => {
 const asu={...US_NEWS_TOP_250.find(x=>x.slug==='arizona-state-university'),gpa:null,sat25:null,sat75:null};
 const fit=assessAcademicFit(asu,profile());
 assert.equal(fit.tier,'safety');assert.ok(fit.cautions.some(c=>/admission rate alone/.test(c)));
 assert.equal(assessAcademicFit({...asu,admitRate:0.6},profile()).tier,'target');
 assert.equal(assessAcademicFit({...asu,admitRate:0.15},profile()).tier,'reach');
});
const midGpaStrongSat = () => { const ws=profile();ws.applicant.gpaUnweighted='3.48';ws.applicant.sat='1510';ws.profile.intended='Journalism';
 ws.onboarding.listPrefs={ambition:'balanced',appCount:null,settings:[],size:'any',regions:['midwest','south','mid-atlantic','northeast'],notes:''};return ws; };
test('a GPA just under 3.5 can still earn likely suggestions', () => {
 const result=recommendColleges(midGpaStrongSat());
 assert.ok(result.recommendations.some(x=>x.fit.tier==='safety'));
 assert.ok(!result.limitations.some(x=>/No likely option/.test(x)));
});
test('a GPA gap at a high-admit school is offset by an SAT above its range', () => {
 const iowa=US_NEWS_TOP_250.find(x=>x.slug==='university-of-iowa');
 assert.equal(assessAcademicFit(iowa,midGpaStrongSat()).tier,'safety');
});
test('a GPA gap keeps a high-admit school out of likely without a strong SAT', () => {
 const iowa=US_NEWS_TOP_250.find(x=>x.slug==='university-of-iowa');
 const ws=midGpaStrongSat();ws.applicant.sat='1250';
 assert.equal(assessAcademicFit(iowa,ws).tier,'target');
});
test('a strong SAT does not make a selective school likely despite a GPA gap', () => {
 const wisconsin=US_NEWS_TOP_250.find(x=>x.slug==='university-of-wisconsin-madison');
 const ws=midGpaStrongSat();ws.applicant.sat='1600';
 assert.notEqual(assessAcademicFit(wisconsin,ws).tier,'safety');
});

const prefs = (extra={}) => ({ambition:'balanced',settings:[],size:'any',regions:[],notes:'',...extra});
const admissionOf = r => US_NEWS_TOP_250.find(s=>s.scorecardId===r.college.scorecardId);
const tierCount = (rows, tier) => rows.filter(x=>x.fit.tier===tier).length;
const QUOTA = { ambitious:{reach:5,target:4,safety:3}, balanced:{reach:3,target:5,safety:4}, conservative:{reach:2,target:5,safety:5} };
test('a 3.9 weighted-only GPA with a 1250 SAT gets likely schools and few long shots', () => {
 const ws=emptyWorkspace();ws.applicant.gpaWeighted='3.9';ws.applicant.sat='1250';ws.profile.intended='Computer Science';
 const rows=recommendColleges(ws).recommendations;
 assert.ok(tierCount(rows,'safety')>=2);
 assert.ok(rows.filter(r=>(admissionOf(r)?.admitRate??1)<0.15).length<=3);
});
test('a 3.5 test-optional profile gets likely schools', () => {
 const ws=emptyWorkspace();ws.applicant.gpaUnweighted='3.5';ws.applicant.satNote='Test optional';ws.applicant.sat='1500';
 const rows=recommendColleges(ws).recommendations;
 assert.ok(tierCount(rows,'safety')>=2);
 assert.ok(!rows.some(r=>r.fit.reasons.some(x=>/Your SAT/.test(x))));
});
test('a 3.5/1250 profile is never sent to colleges whose 25th-percentile SAT is 200+ points higher', () => {
 for (const ambition of ['ambitious','balanced','conservative']) {
  const ws=emptyWorkspace();ws.applicant.gpaUnweighted='3.5';ws.applicant.sat='1250';ws.onboarding.listPrefs=prefs({ambition});
  for (const r of recommendColleges(ws).recommendations) { const a=admissionOf(r); assert.ok(!a||a.sat25===null||a.sat25<1450,`${ambition}: ${a?.slug}`); }
 }
});
test('no list has more reaches than its quota, and short categories are reported, not filled with reaches', () => {
 for (const ambition of ['ambitious','balanced','conservative']) for (const [gpa,sat] of [['3.0','1000'],['3.5','1250'],['3.9','1450'],['4.0','1600']]) {
  const ws=emptyWorkspace();ws.applicant.gpaUnweighted=gpa;ws.applicant.sat=sat;ws.onboarding.listPrefs=prefs({ambition,regions:['northeast'],settings:['rural']});
  const result=recommendColleges(ws);
  for (const tier of ['reach','target','safety']) {
   const n=tierCount(result.recommendations,tier);assert.ok(n<=QUOTA[ambition][tier],`${ambition} ${gpa}/${sat} ${tier}`);
   const gap=result.gaps.find(g=>g.tier===tier);assert.equal(gap?gap.missing:0,QUOTA[ambition][tier]-n);
  }
 }
});
test('ambition changes the minimum estimate and the mix, with the same constants for every college', () => {
 const counts=a=>{const ws=profile();ws.onboarding.listPrefs=prefs({ambition:a});return tierCount(recommendColleges(ws).recommendations,'reach');};
 assert.ok(counts('ambitious')>counts('balanced'));assert.ok(counts('balanced')>counts('conservative'));
});
test('a resident gets an in-state public college among likely or target schools', () => {
 for (const state of ['TX','MI','NJ']) {
  const ws=profile();ws.profile.residency=state.toLowerCase();
  const rows=recommendColleges(ws).recommendations;
  const local=rows.filter(r=>{const row=data.schools.find(x=>x.unitid===r.college.scorecardId);return row.state===state&&row.control==='public'&&(r.fit.tier==='target'||r.fit.tier==='safety');});
  assert.ok(local.length,state);
  assert.ok(local.every(r=>r.college.tags.some(t=>t.label==='In-state')));
 }
});
test('a budget removes over-budget likely schools and flags over-budget reaches', () => {
 const ws=profile();ws.onboarding.listPrefs=prefs({budget:'lt15'});
 const result=recommendColleges(ws);
 for (const r of result.recommendations) {
  if (r.fit.tier==='safety') assert.ok(r.evidence.netPrice===null||r.evidence.netPrice<=15000);
  if (r.evidence.netPrice>15000) assert.ok(r.fit.cautions.some(c=>/above your budget of \$15,000/.test(c)));
 }
 assert.ok(result.recommendations.some(r=>r.fit.tier==='reach'&&r.evidence.netPrice>15000));
 const unset=recommendColleges(profile());
 assert.ok(unset.recommendations.some(r=>r.fit.tier==='safety'&&r.evidence.netPrice>15000));
});
test('an ACT composite is compared through the concordance when no SAT is stored', () => {
 const {actToSat}=require('../lib/act-concordance.ts');
 assert.equal(actToSat(36),1590);assert.equal(actToSat(30),1370);assert.equal(actToSat(8),null);assert.equal(actToSat(30.5),null);
 const ws=emptyWorkspace();ws.applicant.gpaUnweighted='3.8';ws.profile.testing.act='30';
 const school=US_NEWS_TOP_250.find(x=>x.slug==='arizona-state-university');
 const fit=assessAcademicFit(school,ws);
 assert.ok(fit.reasons.some(x=>/ACT-concorded SAT 1370/.test(x)));
 ws.applicant.satNote='Test optional';assert.ok(!assessAcademicFit(school,ws).reasons.some(x=>/SAT 1370/.test(x)));
});
test('the SAT in profile.testing is used when the applicant snapshot has none', () => {
 const ws=emptyWorkspace();ws.applicant.gpaUnweighted='3.8';ws.profile.testing.sat='1520';
 const school=US_NEWS_TOP_250.find(x=>x.slug==='arizona-state-university');
 assert.ok(assessAcademicFit(school,ws).reasons.some(x=>/Your SAT 1520/.test(x)));
});
test('estimateChance applies the fixed SAT and GPA factors to the admit rate', () => {
 const {estimateChance}=require('../lib/college-recommendations.ts');
 const school={slug:'x',admitRate:0.4,sat25:1200,sat75:1400,gpa:3.8,gpaWeighted:false};
 const a=(gpa,sat)=>({gpa,sat,gpaFromWeighted:false,satFromAct:false,testOptional:false,cautions:[]});
 assert.equal(estimateChance(school,a(3.8,1300)),0.4);
 assert.equal(estimateChance(school,a(4.0,1450)),0.4*1.25*1.25);
 assert.ok(Math.abs(estimateChance(school,a(3.4,1100))-0.4*0.6*0.6)<1e-9);
 assert.equal(estimateChance({...school,admitRate:0.9},a(4.0,1600)),0.95);
 assert.equal(estimateChance({...school,admitRate:null},a(4.0,1600)),null);
});
test('seeding returns gaps, marks seeded rows, and rebalancing keeps the student\'s own schools', () => {
 const ws=profile();
 const mine={slug:'my-pick',name:'My pick',short:'My pick',tier:'reach',origin:'user'};
 const starred={...US_NEWS_TOP_250.find(x=>x.slug==='princeton-university'),origin:'seed',priority:true};
 const oldSeed={slug:'old-seed',name:'Old seed',short:'Old seed',tier:'reach',origin:'seed'};
 ws.colleges=[mine,{slug:starred.slug,name:starred.name,short:starred.name,scorecardId:starred.scorecardId,origin:'seed',priority:true},oldSeed];
 const first=seedRecommendedColleges(ws);
 assert.ok(Array.isArray(first.gaps));assert.ok(first.colleges.includes(oldSeed));
 assert.ok(first.colleges.slice(3).every(c=>c.origin==='seed'));
 const rebalanced=seedRecommendedColleges(ws,{keepUserSchools:true}).colleges;
 assert.ok(rebalanced.some(c=>c.slug==='my-pick'));assert.ok(rebalanced.some(c=>c.slug==='princeton-university'));
 assert.ok(!rebalanced.some(c=>c.slug==='old-seed'));
 assert.equal(rebalanced.length,12);
});
test('rebalancing replaces seeded rows saved before origin existed, and keeps edited or added ones', () => {
 const { isSeededRow } = require('../lib/college-recommendations.ts');
 const ws=profile();
 const legacy=recommendColleges(ws).recommendations.slice(0,12).map(r=>({...r.college,supp:'Supps optional',priority:false}));
 assert.ok(legacy.every(isSeededRow));
 const edited={...legacy[0],deadline:'EA'};const starred={...legacy[1],priority:true};
 const catalog={slug:'catalog-pick',name:'Catalog pick',short:'Catalog pick',rank:40,tier:'target',tags:[{label:'Fair-ranking evidence',tone:'teal'}],size:'Medium'};
 assert.equal(isSeededRow(edited),false);assert.equal(isSeededRow(starred),false);assert.equal(isSeededRow(catalog),false);
 assert.equal(isSeededRow({...legacy[2],origin:'user'}),false);assert.equal(isSeededRow({...legacy[2],tags:[]}),false);
 ws.onboarding.listPrefs={ambition:'ambitious'};
 ws.colleges=[edited,starred,catalog,...legacy.slice(2)];
 const out=seedRecommendedColleges(ws,{keepUserSchools:true}).colleges;
 for(const keep of [edited,starred,catalog]) assert.ok(out.some(c=>c.slug===keep.slug));
 assert.ok(out.filter(c=>![edited,starred,catalog].some(k=>k.slug===c.slug)).every(c=>c.origin==='seed'));
});
test('seeding a list of all reaches reports the missing categories instead of adding reaches', () => {
 const ws=profile();
 ws.colleges=US_NEWS_TOP_250.filter(x=>x.admitRate!==null&&x.admitRate<0.1).slice(0,12).map(c=>({slug:c.slug,name:c.name,short:c.name,scorecardId:c.scorecardId,tier:'reach'}));
 const {colleges,gaps}=seedRecommendedColleges(ws);
 assert.equal(colleges.length,12);
 assert.deepEqual(gaps,[{tier:'target',missing:5,goal:5},{tier:'safety',missing:4,goal:4}]);
});
