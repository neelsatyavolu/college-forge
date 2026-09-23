import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  for (const file of ['node_modules/react/umd/react.development.js', 'node_modules/react-dom/umd/react-dom.development.js']) await page.addScriptTag({content:readFileSync(file,'utf8')});
  await page.evaluate(() => {
    const wrapper = ({ children }) => React.createElement('span', {}, children);
    window.CollegeForgeDesignSystem_e95e63 = { Badge:wrapper, VerdictBadge:wrapper, SectionLabel:wrapper, Button:({children,variant,size,...props})=>React.createElement('button',props,children) };
    window.testData = {colleges:[{slug:'test-university',name:'Test University Full Name',short:'TU',location:'Test city',priority:true,admit:'60%'}],applications:{}};
    window.fail = true; window.deletes = 0; window.patches = [];
    window.cfApi = {patch:async patch => {window.patches.push(patch); if(window.fail) throw Error('Save failed. Please retry.'); return {...window.testData,colleges:window.testData.colleges.map(school=>({...school,...patch.collegePatch})),applications:patch.application?{[patch.application.slug]:{status:patch.application.status}}:window.testData.applications};}};
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
  console.log('Shortlist: untiered value honest, tier failures visible, Likely enum preserved, removal confirmation and retry passed.');
} finally {await browser.close();}
