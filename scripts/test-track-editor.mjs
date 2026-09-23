import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import puppeteer from 'puppeteer-core';
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  const page=await browser.newPage(); await page.setContent('<div id="root"></div>');
  for(const file of ['node_modules/react/umd/react.development.js','node_modules/react-dom/umd/react-dom.development.js','public/_ds_bundle.js']) await page.addScriptTag({content:readFileSync(file,'utf8')});
  await page.addScriptTag({content:'(()=>{'+ts.transpile(readFileSync('public/hub/Track.jsx','utf8'),{jsx:ts.JsxEmit.React})+'})();'});
  await page.evaluate(()=>{
    window.fail=true;window.saved=[];window.cfApi={patch:async p=>{if(window.fail)throw new Error('Connection lost');window.saved.push(p);return {recommendations:[],scholarships:[],financialAid:{}};}};
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(window.Track,{data:{recommendations:[],scholarships:[],financialAid:{}}}));
  });
  await page.waitForSelector('input[placeholder="Name"]');
  await page.type('input[placeholder="Name"]','Teacher test');
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Add').click());
  await new Promise(r=>setTimeout(r,100));
  assert.equal(await page.$eval('input[placeholder="Name"]',e=>e.value),'Teacher test','failed save retains recommender input');
  assert.match(await page.$eval('[role="alert"]',e=>e.textContent),/Connection lost/);
  await page.evaluate(()=>{window.fail=false;[...document.querySelectorAll('button')].find(b=>b.textContent==='Add').click();});
  await page.waitForFunction(()=>window.saved.length===1);
  assert.equal(await page.$eval('input[placeholder="Name"]',e=>e.value),'');
  assert.equal(await page.evaluate(()=>window.saved[0].recommendation.name),'Teacher test');
  console.log('PASS failed letter save retains form, surfaces error, and can retry');
} finally {await browser.close();}
