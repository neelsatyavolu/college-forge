import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  page.on("pageerror", error => console.error(error.message));
  await page.setRequestInterception(true);
  page.on('request', req => req.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}));
  await page.goto('http://127.0.0.1/');
  for (const path of ['node_modules/react/umd/react.development.js', 'node_modules/react-dom/umd/react-dom.development.js']) {
    await page.addScriptTag({ content: readFileSync(path, 'utf8') });
  }
  await page.addScriptTag({content: readFileSync('public/_ds_bundle.js','utf8')});
  await page.evaluate(() => {
    if (!crypto.randomUUID) crypto.randomUUID = () => 'test-uuid';
    window.saves = [];
    window.testData = { draftStorageKey:'planning-test', colleges: [], essays: {commonApp: [1,2].map(id => ({id: 'essay-'+id, label: 'Essay '+id, prompt: 'Prompt '+id, limit:650, unit:'words'})), supplements:{}}, essayDrafts:{} };
    window.cfApi = {patch: async patch => { window.saves.push(patch); return {...window.testData, essayDrafts: {...window.testData.essayDrafts, ...patch.essayDrafts, ...(patch.essayDraft ? {[patch.essayDraft.id]:patch.essayDraft.text}: {})}}; }};
    window.root = ReactDOM.createRoot(document.getElementById('root'));
  });
  const load = async file => page.addScriptTag({content: '(function(){'+ts.transpile(readFileSync(file,'utf8'), {jsx: ts.JsxEmit.React})+'})();'});
  await load('public/hub/Essays.jsx');
  await page.evaluate(() => window.root.render(React.createElement(window.Essays, {data:window.testData})));
  await page.waitForSelector('textarea');
  await page.type('textarea','First draft');
  await page.evaluate(() => [...document.querySelectorAll('button')].find(el => el.textContent.includes('Essay 2')).click());
  await page.type('textarea','Second draft');
  await new Promise(resolve=>setTimeout(resolve,900));
  const saved = await page.evaluate(()=>Object.assign({}, ...window.saves.map(p=>p.essayDrafts || {[p.essayDraft.id]:p.essayDraft.text})));
  assert.equal(saved['essay-1'], 'First draft', 'Switching essays must not cancel the previous essay save');
  assert.equal(saved['essay-2'], 'Second draft');
  await page.type('textarea',' before leaving');
  await page.evaluate(()=>window.root.render(React.createElement('p',{},'Other page')));
  await new Promise(resolve=>setTimeout(resolve,900));
  const latest = await page.evaluate(()=>Object.assign({}, ...window.saves.map(p=>p.essayDrafts || {[p.essayDraft.id]:p.essayDraft.text})));
  assert.equal(latest['essay-2'],'Second draft before leaving','Navigation must flush pending drafts');
  console.log('Essay switch and navigation persistence passed');
  await page.evaluate(() => {
    window.cfApi.patch = async patch => {
      if (window.failSave) throw new Error('Offline test');
      window.saves.push(patch);
      window.testData = {...window.testData, essayDrafts:{...window.testData.essayDrafts,...patch.essayDrafts}, essays: patch.essays ? {...window.testData.essays,...patch.essays} : window.testData.essays};
      return window.testData;
    };
    window.renderEssays = () => window.root.render(React.createElement(window.Essays,{data:window.testData,onWorkspaceChange:ws=>{window.testData=ws;window.renderEssays();}}));
    window.renderEssays();
  });
  await page.waitForSelector('textarea');
  await page.evaluate(()=>{window.failSave = true;});
  await page.type('textarea',' retry text');
  await page.waitForSelector('[role="alert"]');
  assert.ok((await page.$eval('[role="alert"]',el=>el.textContent)).includes('haven’t saved'));
  await page.evaluate(()=>{window.failSave=false; [...document.querySelectorAll('button')].find(el=>el.textContent==='Retry saving').click();});
  await page.waitForFunction(()=>!document.querySelector('[role="alert"]'));
  assert.ok((await page.evaluate(()=>window.testData.essayDrafts['essay-1'])).endsWith(' retry text'));
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(el=>el.textContent==='Add prompt').click());
  await page.type('[aria-label="Prompt title"]','Personal response');
  await page.type('[aria-label="Essay prompt"]','What matters to you?');
  await page.select('[aria-label="Prompt count unit"]','characters');
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(el=>el.textContent==='Save prompt').click());
  await page.waitForFunction(()=>!document.querySelector('form'));
  assert.ok(await page.evaluate(()=>window.testData.essays.commonApp.some(it=>it.label==='Personal response' && it.unit==='characters')));
  console.log('Essay failed-save retry and manual prompt creation passed');
  await load('public/hub/Timeline.jsx');
  await page.evaluate(() => {
    window.testData = {profile:{gradYear:2027}, colleges:[], criticalDates:[
      {date:'Jan 5',label:'January deadline',detail:''},
      {date:'2026-09-30',label:'September deadline',detail:''},
      {date:'Oct 15',label:'October deadline',detail:''},
      {date:'2027-01-10',label:'Later January deadline',detail:''}
    ]};
    window.root.render(React.createElement(window.Timeline,{data:window.testData}));
  });
  await page.waitForSelector('h1');
  const timeline = await page.evaluate(()=>document.body.innerText);
  assert.ok(timeline.indexOf('September deadline') < timeline.indexOf('October deadline'), 'ISO September must sort before October');
  assert.ok(timeline.indexOf('October deadline') < timeline.indexOf('January deadline'), 'October must sort before January in the application cycle');
  assert.ok(timeline.includes('2026') && timeline.includes('2027'), 'Timeline must show years');
  console.log('Timeline date ordering passed');
  await page.evaluate(() => {
    window.cfApi.patch = async patch => {window.testData={...window.testData,...patch}; return window.testData;};
    window.renderTimeline = ()=>window.root.render(React.createElement(window.Timeline,{data:window.testData,onWorkspaceChange:ws=>{window.testData=ws;window.renderTimeline();}}));
    window.renderTimeline();
  });
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(el=>el.textContent==='Add a milestone').click());
  await page.type('[aria-label="Milestone title"]','Meet counselor');
  await page.$eval('[aria-label="Milestone date"]', el=>{ const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(el,'2026-10-02'); el.dispatchEvent(new Event('input',{bubbles:true})); });
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(el=>el.textContent==='Save milestone').click());
  await page.waitForFunction(()=>!document.querySelector('form'));
  assert.ok(await page.evaluate(()=>window.testData.criticalDates.some(d=>d.label==='Meet counselor' && d.date==='2026-10-02')));
  console.log('Manual timeline milestone persistence passed');
  await load('public/hub/Planner.jsx');
  await page.evaluate(()=>{
    window.testData={colleges:[{slug:'example',short:'Example College'}],plannerDone:{},applications:{}};
    window.failSave=true;
    window.cfApi.patch=async patch=>{
      if(window.failSave) throw new Error('Could not connect');
      window.testData={...window.testData,plannerDone:{[patch.plannerToggle.key]:patch.plannerToggle.done}};
      return window.testData;
    };
    window.renderPlanner=()=>window.root.render(React.createElement(window.Planner,{data:window.testData,onWorkspaceChange:ws=>{window.testData=ws;window.renderPlanner();}}));
    window.renderPlanner();
  });
  await page.waitForSelector('input[type="checkbox"]');
  await page.click('input[type="checkbox"]');
  await page.waitForSelector('[role="alert"]');
  assert.equal(await page.$eval('input[type="checkbox"]',el=>el.checked),false,'Failed task saves must not appear completed');
  await page.evaluate(()=>{window.failSave=false;});
  await page.click('input[type="checkbox"]');
  await page.waitForFunction(()=>document.querySelector('input[type="checkbox"]').checked);
  console.log('Planner failure visibility and retry passed');
} finally { await browser.close(); }
