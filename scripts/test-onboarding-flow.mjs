import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import puppeteer from 'puppeteer-core';
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const page=await browser.newPage();
 page.setDefaultTimeout(5000);
 page.on('pageerror',error=>console.error(error.message));
 await page.setContent('<div id="root"></div>');
 for(const path of ['node_modules/react/umd/react.development.js','node_modules/react-dom/umd/react-dom.development.js','public/_ds_bundle.js']) await page.addScriptTag({content:readFileSync(path,'utf8')});
 await page.evaluate(()=>{
   window.calls=[];
   window.fetch=async(url,opts={})=>{
     window.calls.push({url,body:opts.body && JSON.parse(opts.body)});
     if(url==='/api/ai/status') return {ok:true,json:async()=>({active:window.aiConnected?'codex':null})};
     if(url==='/api/workspace' && opts.method==='POST') return {ok:true,json:async()=>({success:true,data:{applicant:JSON.parse(opts.body).applicant,onboarding:{completed:true},colleges:[{slug:'data-backed-school'}]}})};
     if(url==='/api/ai/chat') return {ok:false,status:503,json:async()=>({error:'AI offline'})};
     throw Error('Unexpected request '+url);
   };
   window.root=ReactDOM.createRoot(document.getElementById('root'));
 });
 await page.addScriptTag({content:'(function(){'+ts.transpile(readFileSync('public/hub/Onboarding.jsx','utf8'),{jsx:ts.JsxEmit.React})+'})();'});
 const click=async(text)=>page.evaluate(text=>[...document.querySelectorAll('button')].find(el=>el.textContent===text).click(),text);
 const fill=async(selector,value)=>{await page.$eval(selector,(el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);};
 await page.evaluate(()=>window.root.render(React.createElement(window.Onboarding,{data:{},onComplete:ws=>{window.completed=ws;},onCancel:()=>{window.cancelled=true;}})));
 await page.waitForSelector('button');
 await click('Continue');
 await page.waitForFunction(()=>document.body.innerText.includes('Connect an AI'));
 assert.equal(await page.evaluate(()=>[...document.querySelectorAll('button')].find(el=>el.textContent.includes('Continue')).disabled),false,'AI sign-in must be optional');
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(el=>el.textContent.includes('Continue')).click());
 await page.waitForSelector('[placeholder="Alex Rivera"]');
 await fill('[placeholder="Alex Rivera"]','Test Student');
 await fill('[placeholder="2027"]','2027');
 await fill('[placeholder="Lincoln High School"]','Test High');
 await fill('[placeholder="Computer Science"]','Biology');
 await click('Continue');
 await page.waitForSelector('[placeholder="3.95"]');
 await fill('[placeholder="3.95"]','4.5');
 assert.equal(await page.evaluate(()=>[...document.querySelectorAll('button')].find(el=>el.textContent==='Continue').disabled),true,'Unweighted GPA over 4 must be rejected');
 await fill('[placeholder="3.95"]','3.7');
 await fill('[placeholder="1540"]','1700');
 assert.equal(await page.evaluate(()=>[...document.querySelectorAll('button')].find(el=>el.textContent==='Continue').disabled),true,'SAT over 1600 must be rejected');
 await fill('[placeholder="1540"]','');
 await click('Continue');
 await page.waitForSelector('textarea');
 await page.type('textarea','Volunteered at the library');
 await click('Continue');
 await page.waitForFunction(()=>document.body.innerText.includes('Must-include schools'));
 await click('Continue');
 await page.waitForFunction(()=>document.body.innerText.includes('Upload documents'));
 await click('Skip');
 await page.waitForFunction(()=>document.body.innerText.includes('Review & build'));
 await click('Build my hub ✱');
 await page.waitForFunction(()=>!!window.completed);
 assert.equal(await page.evaluate(()=>window.completed.onboarding.completed),true);
 assert.equal(await page.evaluate(()=>window.calls.some(call=>call.url==='/api/ai/chat')),false,'No provider must never call AI chat');
 const payload=await page.evaluate(()=>window.calls.find(call=>call.body?.action==='complete-onboarding').body);
 assert.equal(payload.applicant.gpaUnweighted,'3.7');
 assert.equal(payload.applicant.sat,'—');
 assert.equal(payload.storyNotes.activities,'Volunteered at the library');
 assert.equal(payload.listPrefs.ambition,'balanced');
 console.log('No-AI onboarding: entire flow completes, invalid GPA/SAT rejected, answers preserved, AI never called.');
 await page.evaluate(()=>{
   window.aiConnected=true;window.completed=null;
   window.root.render(React.createElement(window.Onboarding,{key:'connected',data:{applicant:{name:'Test',gpaUnweighted:'3.7'},profile:{hs:'Test High',intended:'Biology',gradYear:'2027'}},onComplete:ws=>{window.completed=ws;},onCancel:()=>{window.cancelled=true;}}));
 });
 await page.waitForFunction(()=>document.querySelector('.cf-onboard-progress__item.is-active')?.textContent.includes('Welcome'));
 for(const label of ['AI','You','Academics','Story','List','Upload','Build']) {
   await click('Continue');
   await page.waitForFunction(label=>document.querySelector('.cf-onboard-progress__item.is-active .cf-onboard-progress__label')?.textContent===label,{},label);
 }
 await click('Build my hub ✱');
 await page.waitForFunction(()=>!!window.completed);
 assert.equal(await page.evaluate(()=>window.completed.onboarding.completed),true);
 assert.ok(await page.evaluate(()=>window.calls.some(call=>call.url==='/api/ai/chat')));
 console.log('Optional connected-AI failure still opens the saved workspace.');
} finally {await browser.close();}
