import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import puppeteer from 'puppeteer-core';
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const page=await browser.newPage();page.setDefaultTimeout(5000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setRequestInterception(true);
 page.on('request',req=>req.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}));
 await page.goto('http://127.0.0.1/');
 const setup=async()=>{
   for(const path of ['node_modules/react/umd/react.development.js','node_modules/react-dom/umd/react-dom.development.js','public/_ds_bundle.js'])await page.addScriptTag({content:readFileSync(path,'utf8')});
   await page.addScriptTag({content:'(function(){'+ts.transpile(readFileSync('public/hub/Essays.jsx','utf8'),{jsx:ts.JsxEmit.React})+'})();'});
   await page.evaluate(()=>{
     window.saved={};window.calls=[];window.failSave=true;
     window.workspace=key=>({draftStorageKey:key,colleges:[],essays:{commonApp:[{id:'same-essay-id',label:'My essay',prompt:'Write',limit:650,unit:'words'}],supplements:{}},essayDrafts:{...(window.saved[key]||{})}});
     window.cfApi={patch:async patch=>{window.calls.push({key:window.CF_DATA.draftStorageKey,patch});if(window.failSave)throw Error('offline');window.saved[window.CF_DATA.draftStorageKey]={...patch.essayDrafts};return window.workspace(window.CF_DATA.draftStorageKey);}};
     window.root=ReactDOM.createRoot(document.getElementById('root'));
     window.apply=ws=>{window.CF_DATA=ws;root.render(React.createElement(window.Essays,{data:ws,onWorkspaceChange:window.apply}));};
     window.mount=key=>window.apply(window.workspace(key));
   });
 };
 await setup();await page.evaluate(()=>window.mount('workspace-a'));await page.waitForSelector('textarea');
 await page.type('textarea','My irreplaceable draft');await page.waitForSelector('[role="alert"]');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('cf.essay-recovery.workspace-a'))['same-essay-id']),'My irreplaceable draft');
 await page.evaluate(()=>root.render(React.createElement('p',{},'Other section')));await page.waitForSelector('p');
 await page.evaluate(()=>window.mount('workspace-a'));await page.waitForSelector('textarea');
 assert.equal(await page.$eval('textarea',el=>el.value),'My irreplaceable draft','Failed save must survive navigating away and back');
 // A real reload destroys all queue memory while retaining origin-scoped localStorage.
 page.once('dialog',dialog=>dialog.accept());await page.reload();await setup();
 await page.evaluate(()=>window.mount('workspace-a'));await page.waitForSelector('textarea');
 assert.equal(await page.$eval('textarea',el=>el.value),'My irreplaceable draft','Failed save must survive reload');
 await page.evaluate(()=>window.mount('workspace-b'));await page.waitForFunction(()=>document.querySelector('textarea')?.value==='');
 assert.equal(await page.$eval('textarea',el=>el.value),'','Recovered drafts must never bleed into another workspace');
 await new Promise(resolve=>setTimeout(resolve,700));
 assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.key==='workspace-b').length),0,'Old dirty queue must not send drafts using another workspace cookie');
 await page.type('textarea','Workspace B draft');await page.waitForSelector('[role="alert"]');
 await page.evaluate(()=>window.mount('workspace-a'));await page.waitForFunction(()=>document.querySelector('textarea')?.value==='My irreplaceable draft');
 await page.evaluate(()=>{window.failSave=false;[...document.querySelectorAll('button')].find(el=>el.textContent==='Retry saving').click();});
 await page.waitForFunction(()=>!localStorage.getItem('cf.essay-recovery.workspace-a'));
 assert.equal(await page.evaluate(()=>window.saved['workspace-a']['same-essay-id']),'My irreplaceable draft');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('cf.essay-recovery.workspace-b'))['same-essay-id']),'Workspace B draft');
 // Export/recovery handoff waits for an already-running save and reports failures.
 await page.evaluate(()=>{
   window.flushFinished=false;
   window.cfApi.patch=patch=>new Promise(resolve=>{window.finishSave=()=>resolve({...window.CF_DATA,essayDrafts:{...patch.essayDrafts}});});
 });
 await page.type('textarea',' before export');
 await page.waitForFunction(()=>typeof window.finishSave==='function');
 await page.evaluate(()=>{window.flushResult=window.cfFlushEssayDrafts().then(()=>window.flushFinished=true);});
 assert.equal(await page.evaluate(()=>window.flushFinished),false,'Flush must await the in-flight save');
 await page.evaluate(()=>window.finishSave());
 await page.waitForFunction(()=>window.flushFinished);
 await page.evaluate(()=>{window.cfApi.patch=async()=>{throw new Error('Offline handoff');};});
 await page.type('textarea',' offline');
 const failure=await page.evaluate(()=>window.cfFlushEssayDrafts().then(()=>null,error=>error.message));
 assert.match(failure,/Offline handoff/,'Export/recovery must receive the save failure');
 assert.ok(await page.evaluate(()=>localStorage.getItem('cf.essay-recovery.workspace-a')));
 assert.deepEqual(errors,[]);
 console.log('PASS failed draft save survives navigation and reload, workspace journals stay isolated, retry clears only saved recovery data.');
} finally {await browser.close();}
