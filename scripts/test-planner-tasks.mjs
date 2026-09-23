import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import puppeteer from 'puppeteer-core';
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const page=await browser.newPage();page.setDefaultTimeout(5000);
 await page.setContent('<div id="root"></div>');
 for(const file of ['node_modules/react/umd/react.development.js','node_modules/react-dom/umd/react-dom.development.js','public/_ds_bundle.js'])await page.addScriptTag({content:readFileSync(file,'utf8')});
 await page.addScriptTag({content:'(function(){'+ts.transpile(readFileSync('public/hub/Planner.jsx','utf8'),{jsx:ts.JsxEmit.React})+'})();'});
 await page.evaluate(()=>{
  window.data={colleges:[{slug:'example',short:'Example College'}],plannerDone:{},applications:{}};window.patches=[];
  window.cfApi={patch:async patch=>{window.patches.push(patch);window.data={...window.data,plannerDone:{...window.data.plannerDone,[patch.plannerToggle.key]:patch.plannerToggle.done}};return window.data;}};
  window.root=ReactDOM.createRoot(document.getElementById('root'));window.render=()=>root.render(React.createElement(window.Planner,{data:window.data,onWorkspaceChange:ws=>{window.data=ws;window.render();}}));window.render();
 });
 await page.waitForSelector('input[type="checkbox"]');await page.click('input[type="checkbox"]');
 await page.waitForFunction(()=>window.patches.length===1);
 assert.equal(await page.evaluate(()=>window.patches[0].plannerToggle.key),'example:application-review','Application review needs a stable semantic key');
 await page.evaluate(()=>{window.data={...window.data,colleges:[{...window.data.colleges[0],supp:'Supps required'}]};window.render();});
 await page.waitForFunction(()=>document.querySelectorAll('input[type="checkbox"]').length===3);
 assert.deepEqual(await page.$$eval('input[type="checkbox"]',els=>els.map(el=>el.checked)),[false,true,false],'Adding supplements must not transfer review completion');
 await page.click('input[type="checkbox"]');await page.waitForFunction(()=>window.patches.length===2);
 await page.evaluate(()=>{window.data={...window.data,colleges:[{...window.data.colleges[0],supp:'Supps optional'}]};window.render();});
 await page.waitForFunction(()=>document.body.innerText.includes('optional supplement'));
 assert.deepEqual(await page.$$eval('input[type="checkbox"]',els=>els.map(el=>el.checked)),[false,true,false],'Required and optional supplements must not inherit one another’s checks');
 await page.evaluate(()=>{window.data={...window.data,plannerDone:{'example:0':true}};window.render();});
 await page.waitForFunction(()=>document.body.innerText.includes('reconfirm'));
 assert.deepEqual(await page.$$eval('input[type="checkbox"]',els=>els.map(el=>el.checked)),[false,false,false],'Ambiguous numeric checks must not be applied');
 assert.equal(await page.evaluate(()=>window.data.plannerDone['example:0']),true,'Legacy entries remain preserved');
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(el=>el.textContent.includes('reviewed this checklist')).click());
 await page.waitForFunction(()=>!document.body.innerText.includes('reconfirm'));
 assert.equal(await page.evaluate(()=>window.data.plannerDone['example:0']),true,'Acknowledging review preserves the legacy entry');
 for(const status of ['submitted','accepted','rejected','waitlisted','deferred']){
  await page.evaluate(status=>{window.data={colleges:[{slug:'ucla',short:'UCLA'}],plannerDone:{},applications:{ucla:{status}}};window.render();},status);
  await page.waitForFunction(status=>document.body.textContent.includes(status),{},status);
  assert.deepEqual(await page.$$eval('input[type="checkbox"]',els=>els.map(el=>el.checked)),[true,true],status+' should imply review and submission complete');
  assert.equal((await page.evaluate(()=>document.body.innerText)).includes('Common App'),false,'UC checklist must not claim Common App');
 }
 await page.evaluate(()=>{window.data={...window.data,applications:{ucla:{status:'withdrawn'}}};window.render();});
 await page.waitForFunction(()=>document.body.innerText.includes('Withdrawn'));
 assert.equal(await page.$$eval('input[type="checkbox"]',els=>els.length),0,'Withdrawn schools should not create outstanding or falsely completed tasks');
 console.log('PASS semantic task identity, supplement changes, explicit legacy reconfirmation, status completion, UC-neutral labels, withdrawn exclusion.');
}finally{await browser.close();}
