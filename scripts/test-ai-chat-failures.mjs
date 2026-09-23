import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import ts from 'typescript';
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const vendor=await Promise.all(['node_modules/react/umd/react.production.min.js','node_modules/react-dom/umd/react-dom.production.min.js','public/_ds_bundle.js'].map(file=>readFile(file,'utf8')));
const failures=[];
async function fixture(component,mode){
 const page=await browser.newPage();await page.setContent('<button id="opener">Open advisor</button><div id="root"></div>');
 for(const content of vendor)await page.addScriptTag({content});
 await page.evaluate(mode=>{
  window.mode=mode;window.chatRequests=0;window.statusRequests=0;
  if(mode==='unavailable-choice')Object.defineProperty(window,'localStorage',{value:{getItem:key=>key==='cf.ai'?JSON.stringify({preferred:'codex'}):null,setItem:()=>{}},configurable:true});
  const status={active:'grok',grokConnected:true,codexConnected:false,opencodeAvailable:false,grokModels:[],codexModels:[],opencodeModels:[],connectionErrors:{}};
  window.fetch=async(url)=>{
   if(url==='/api/ai/status'){window.statusRequests++;if(window.mode==='status-error')return new Response('{}',{status:503});if(window.mode==='slow')await new Promise(r=>setTimeout(r,100));return Response.json(status);}
   if(url==='/api/ai/chat'){window.chatRequests++;if(window.mode==='done-without-newline')return new Response('{"type":"delta","text":"Completed answer"}\n{"type":"done","provider":"grok"}');return new Response(window.mode==='stream-error'?' {"type":"error","message":"Synthetic provider failure"}\n':'{"type":"delta","text":"Partial answer"}\n', {headers:{'content-type':'application/x-ndjson'}});}
   throw Error('Unexpected network request '+url);
  };
  window.fixtureData={applicant:{name:'Synthetic Student'},profile:{intended:'Biology',activities:[],honors:[],testing:{}},essays:{commonApp:[],supplements:{}},essayDrafts:{},colleges:[],recommendations:[],scholarships:[],financialAid:{},applications:{},criticalDates:[]};
 },mode);
 const code=ts.transpileModule(await readFile('public/hub/'+component+'.jsx','utf8'),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020}}).outputText;
 await page.addScriptTag({content:'(()=>{'+code+'})();'});
 await page.evaluate(component=>{document.getElementById('opener').focus();window.root=ReactDOM.createRoot(document.getElementById('root'));window.props={open:true,data:window.fixtureData,view:'overview',onClose:()=>window.root.render(null),onWorkspaceChange:()=>{},onToggleTheme:()=>{},theme:'light'};window.root.render(React.createElement(window[component],window.props));},component);
 await page.waitForFunction(()=>window.statusRequests>0);await new Promise(r=>setTimeout(r,180));return page;
}
async function check(name,run){try{await run();console.log('PASS '+name);}catch(e){failures.push(name+': '+e.message);console.error('FAIL '+name+': '+e.message);}}
try{
 await check('Settings status failure is visible and retryable',async()=>{const p=await fixture('Settings','status-error');assert.match(await p.$eval('#root',e=>e.textContent),/couldn.t|unable|failed/i);assert.ok(await p.$('[role="alert"]'));assert.ok((await p.$$eval('button',els=>els.map(e=>e.textContent))).some(s=>/retry/i.test(s)));await p.close();});
 await check('Chat status failure is visible and retryable',async()=>{const p=await fixture('AiChat','status-error');assert.ok(await p.$('[role="alert"]'));assert.ok((await p.$$eval('button',els=>els.map(e=>e.textContent))).some(s=>/retry/i.test(s)));await p.close();});
 for(const mode of ['stream-error','eof'])await check(mode+' preserves the composer prompt',async()=>{const p=await fixture('AiChat',mode);const input=await p.$('input:not([type=file])');await input.type('My synthetic college question');await input.press('Enter');await p.waitForFunction(()=>window.chatRequests===1);await new Promise(r=>setTimeout(r,100));assert.equal(await p.$eval('input:not([type=file])',e=>e.value),'My synthetic college question');assert.ok(await p.$('[role="alert"]'));await p.close();});
 await check('Repeated Enter during connection check sends once',async()=>{const p=await fixture('AiChat','slow');const input=await p.$('input:not([type=file])');await input.type('Only once');await input.press('Enter');await input.press('Enter');await new Promise(r=>setTimeout(r,350));assert.equal(await p.evaluate(()=>window.chatRequests),1);await p.close();});
 await check('Chat composer has a label and returns focus on Escape',async()=>{const p=await fixture('AiChat','eof');assert.ok(await p.$('[role="dialog"]'));assert.ok(await p.$('input[aria-label="Message to college advisor"]'));await p.keyboard.press('Escape');await new Promise(r=>setTimeout(r,30));assert.equal(await p.evaluate(()=>document.activeElement.id),'opener');await p.close();});
 await check('Retry recovers a status failure and a complete final frame without newline succeeds',async()=>{const p=await fixture('AiChat','status-error');await p.evaluate(()=>{window.mode='done-without-newline';Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Retry connections').click();});await p.waitForFunction(()=>window.statusRequests===2&&!document.querySelector('[role=alert]'));await p.type('input[aria-label="Message to college advisor"]','Finish this');await p.keyboard.press('Enter');await p.waitForFunction(()=>window.chatRequests===1);await new Promise(r=>setTimeout(r,80));assert.equal(await p.$eval('input[aria-label="Message to college advisor"]',e=>e.value),'');assert.match(await p.$eval('#root',e=>e.textContent),/Completed answer/);assert.equal(await p.$('[role=alert]'),null);await p.close();});
 await check('Unavailable explicit provider is labeled and never sent through another connection',async()=>{const p=await fixture('AiChat','unavailable-choice');assert.match(await p.$eval('#root',e=>e.textContent),/ChatGPT unavailable/);await p.type('input[aria-label="Message to college advisor"]','Do not switch accounts');await p.keyboard.press('Enter');await new Promise(r=>setTimeout(r,50));assert.equal(await p.evaluate(()=>window.chatRequests),0);await p.close();});
 assert.deepEqual(failures,[]);
}finally{await browser.close();}
