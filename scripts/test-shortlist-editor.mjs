import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import puppeteer from 'puppeteer-core';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { profileFingerprint } = require('../lib/admission-odds.ts');

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  for (const file of ['vendor/react-18.3.1/react.production.min.js', 'vendor/react-18.3.1/react-dom.production.min.js']) await page.addScriptTag({content:readFileSync(file,'utf8')});
  await page.evaluate(() => {
    const wrapper = ({ children }) => React.createElement('span', {}, children);
    window.CollegeForgeDesignSystem_e95e63 = { Badge:wrapper, VerdictBadge:wrapper, SectionLabel:wrapper, Button:({children,variant,size,...props})=>React.createElement('button',props,children) };
    window.testData = {colleges:[{slug:'test-university',name:'Test University Full Name',short:'TU',location:'Test city',priority:true,admit:'60%'}],applications:{}};
    window.fail = true; window.deletes = 0; window.patches = []; window.actions = [];
    window.cfApi = {patch:async patch => {window.patches.push(patch); if(window.fail) throw Error('Save failed. Please retry.'); return {...window.testData,onboarding:patch.listPrefs?{listPrefs:{...patch.listPrefs}}:window.testData.onboarding,colleges:window.testData.colleges.map(school=>({...school,...patch.collegePatch})),applications:patch.application?{[patch.application.slug]:{status:patch.application.status}}:window.testData.applications};},
      postAction:async (action, body) => {window.actions.push(action); if(window.failRebalance) throw Error('Rebalance failed.'); const gaps=[{tier:'safety',missing:1,goal:2}]; return {success:true,data:{...window.testData,colleges:[...window.testData.colleges,{slug:'seeded-likely',name:'Seeded Likely College',tier:'safety',origin:'seed'}],onboarding:{...(window.testData.onboarding||{}),listGaps:gaps}},gaps,added:['Seeded Likely College'],removed:[]};}};
    window.fetch = async () => {window.deletes++; return {ok:!window.fail,json:async()=>window.fail?{success:false,error:'Could not remove school.'}:{success:true,data:{...window.testData,colleges:[]}}};};
    window.root = ReactDOM.createRoot(document.getElementById('root'));
    window.render = data => {window.testData = data;root.render(React.createElement(window.Shortlist,{data,onWorkspaceChange:window.render}));};
  });
  await page.addScriptTag({content:'(function(){'+ts.transpile(readFileSync('public/hub/Shortlist.jsx','utf8'),{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020})+'})();'});
  await page.evaluate(()=>window.render(window.testData));
  await page.waitForSelector('select');
  assert.equal(await page.$eval('select',el=>el.value),'','Untiered schools must not default to target');
  assert.ok((await page.evaluate(()=>document.body.innerText)).includes('Test University Full Name'));
  assert.ok(!(await page.evaluate(()=>document.body.innerText)).includes('Priority ED'));
  await page.select('select','safety');
  await page.waitForSelector('[role="alert"]');
  assert.equal(await page.$eval('select',el=>el.value),'','Failed tier changes must retain the saved value');
  await page.evaluate(()=>window.fail=false);
  await page.select('select','safety');
  await page.waitForFunction(()=>document.querySelector('select').value==='safety');
  assert.equal(await page.evaluate(()=>window.patches[1].collegePatch.tier),'safety','Likely must keep the backend enum');
  const click = async text => page.evaluate(text=>[...document.querySelectorAll('button')].find(el=>el.textContent===text).click(),text);
  await click('Remove school');
  assert.equal(await page.evaluate(()=>window.deletes),0,'Removal must require confirmation');
  await click('Keep school');
  assert.ok(await page.$('select'));
  await click('Remove school');
  await page.evaluate(()=>window.fail=true);
  await click('Confirm removal');
  await page.waitForFunction(()=>document.body.innerText.includes('Could not remove school.'));
  assert.ok(await page.$('select'),'Failed deletion must keep the school');
  await page.evaluate(()=>window.fail=false);
  await click('Confirm removal');
  await page.waitForFunction(()=>document.body.innerText.includes('No schools on your list yet.'));
  assert.equal(await page.evaluate(()=>window.deletes),2);
  // Balance: Likely card, warning, More ambitious, rebalance and gaps.
  const profile = {applicant:{sat:'1400',gpaUnweighted:'3.8',satNote:''},profile:{intended:'Biology',residency:'CA',testing:{sat:'1400',satNote:'',aps:[]}}};
  const fp = profileFingerprint(profile);
  await page.evaluate((profile, fp) => window.render({...profile,colleges:[{slug:'reach-u',name:'Reach University',tier:'reach'},{slug:'reach-two',name:'Reach Two',tier:'reach'},{slug:'mid-u',name:'Mid University',tier:'target'}],
    admissionOdds:{'reach-u':{percent:8,low:5,high:12,baselineSource:'Overall admission rate 8%',summary:'Reach.',factors:[],sources:[],estimatedAt:'2026-11-01T00:00:00Z',profileFingerprint:fp}},onboarding:{listPrefs:{ambition:'balanced'}}}), profile, fp);
  await page.waitForFunction(()=>document.body.innerText.includes('List balance: Balanced mix'));
  let text = await page.evaluate(()=>document.body.innerText);
  assert.ok(!text.includes('With supps'), 'The With supps card is replaced');
  assert.match(text, /0\s*Likely/i, 'Likely count shows 0');
  assert.ok(text.includes('Your list has 0 likely schools'), 'Warns with fewer than two likely schools');
  assert.ok(text.includes('2 of your 3 applications are reaches'), 'Warns when reaches are over half');
  assert.ok(!text.includes('Estimated before your profile changed'), 'A matching fingerprint is not stale');
  await page.evaluate(()=>{window.patches=[];window.actions=[];});
  await click('More ambitious');
  await page.waitForFunction(()=>document.body.innerText.includes('Seeded Likely College'));
  assert.deepEqual(await page.evaluate(()=>window.patches.map(p=>p.listPrefs)), [{ambition:'ambitious'}]);
  assert.deepEqual(await page.evaluate(()=>window.actions), ['rebalance']);
  text = await page.evaluate(()=>document.body.innerText);
  assert.ok(text.includes('List balance: More reaches'));
  assert.ok(text.includes('could not find 1 more likely school'), 'Unfilled gaps are shown');
  assert.ok(text.includes('Added Seeded Likely College.'), 'The notice names what the rebalance changed');
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='More ambitious').disabled), true, 'More ambitious stops at the top');
  await page.evaluate(()=>window.failRebalance=true);
  await click('Rebalance list');
  await page.waitForFunction(()=>document.body.innerText.includes('Rebalance failed.'));
  await page.evaluate(()=>window.failRebalance=false);
  // Stale estimate after a SAT change.
  await page.evaluate(()=>window.render({...window.testData,applicant:{...window.testData.applicant,sat:'1520'}}));
  await page.waitForFunction(()=>document.body.innerText.includes('Estimated before your profile changed'));
  assert.ok(await page.evaluate(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Re-estimate')), 'Offers to re-estimate');
  await page.evaluate(()=>window.render({...window.testData,colleges:[{slug:'l1',name:'Likely One',tier:'safety'},{slug:'l2',name:'Likely Two',tier:'safety'}],onboarding:{listPrefs:{ambition:'balanced'},listGaps:[{tier:'safety',missing:2,goal:2}]}}));
  await page.waitForFunction(()=>document.body.innerText.includes('Likely Two'));
  assert.ok(!(await page.evaluate(()=>document.body.innerText)).includes('could not find'), 'A saved gap the list has since filled is not shown');
  console.log('Shortlist: untiered value honest, tier failures visible, Likely enum preserved, removal confirmation and retry, Likely card, balance warnings, More ambitious + rebalance, gaps and stale estimates passed.');
} finally {await browser.close();}
