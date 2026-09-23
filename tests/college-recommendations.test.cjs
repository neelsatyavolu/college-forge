const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
// Compile local TypeScript on demand without a second build or test dependency.
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2021, esModuleInterop:true, resolveJsonModule:true}}).outputText,file);
const { recommendColleges, assessAcademicFit, seedRecommendedColleges } = require('../lib/college-recommendations.ts');
const { emptyWorkspace } = require('../lib/store.ts');
const data = require('../public/data/rankings/top250.json');
const { US_NEWS_TOP_250 } = require('../lib/us-news-rankings.ts');
const profile = () => { const ws = emptyWorkspace(); ws.applicant.gpaUnweighted='3.7'; ws.applicant.sat='1400'; ws.profile.intended='Computer Science'; return ws; };
test('recommendations contain real, unique fair-ranking institutions and sourced metrics', () => {
 const result = recommendColleges(profile());
 assert.equal(result.generatedAt, data.generated);
 assert.equal(result.recommendations.length,12);
 assert.equal(new Set(result.recommendations.map(x=>x.college.scorecardId)).size,12);
 for(const r of result.recommendations){const source=data.schools.find(x=>x.unitid===r.college.scorecardId); assert.ok(source); assert.equal(r.evidence.fairRank,source.rank); assert.equal(r.evidence.netPrice,source.net_price);}
 assert.ok(result.recommendations.some(x=>x.evidence.major));
 assert.ok(result.recommendations.some(x=>x.fit.tier==='reach'));
 assert.ok(result.recommendations.some(x=>x.fit.tier==='target'));
 assert.ok(result.recommendations.some(x=>x.fit.tier==='safety'));
});
test('regional preferences are never silently relaxed', () => {
 const ws=profile();ws.onboarding.listPrefs={regions:['northeast'],settings:[],ambition:'balanced',size:'any',notes:''};
 const result=recommendColleges(ws);assert.ok(result.recommendations.length);
 for(const r of result.recommendations) assert.ok(['ME','NH','VT','MA','RI','CT'].includes(data.schools.find(x=>x.unitid===r.college.scorecardId).state));
});
test('missing academic profile does not create personal admission tiers', () => {
 const result=recommendColleges(emptyWorkspace());
 assert.ok(result.profileGaps.length);
 assert.ok(result.recommendations.every(x=>x.fit.tier===null));
});
test('weighted-only GPA is not converted into a guessed unweighted GPA', () => {
 const ws=emptyWorkspace();ws.applicant.gpaWeighted='4.8';
 assert.ok(recommendColleges(ws).recommendations.every(x=>x.fit.tier===null));
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
 const original=JSON.stringify(ws.colleges);const result=seedRecommendedColleges(ws);
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
test('a college without comparable academic evidence is not an automatic target', () => {
 const school={...US_NEWS_TOP_250.find(x=>x.slug==='arizona-state-university'),gpa:null,sat25:null,sat75:null};
 assert.equal(assessAcademicFit(school,profile()).tier,null);
});
