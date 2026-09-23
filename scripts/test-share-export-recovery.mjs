// All workspace/share requests are intercepted. This test never creates a live
// share link, recovery credential, advisor note, or workspace mutation.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import puppeteer from 'puppeteer-core';
const require=createRequire(import.meta.url);
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021,esModuleInterop:true}}).outputText,file);
const {exportPlainText,exportCalendar}=require('../lib/export.ts');
const fixture={window:{}};vm.runInNewContext(readFileSync('public/hub/data.js','utf8'),fixture);
const workspace=JSON.parse(JSON.stringify(fixture.window.CF_DATA));
Object.assign(workspace,{revision:0,draftStorageKey:'fixture-original',criticalDates:[{date:'2026-11-01',label:'Application milestone',detail:'Fixture deadline'},{date:'2026-02-30',label:'Invalid fixture date'}],essays:{commonApp:[{id:'one',label:'First essay',prompt:'First prompt',limit:650,unit:'words'},{id:'two',label:'Chosen essay',prompt:'Second prompt',limit:650,unit:'words'}],supplements:{}},essayDrafts:{one:'A draft not selected for export.',two:'This is the chosen student draft.'}});
workspace.applicant.name='Fixture student';workspace.profile.gradYear=2027;
const recovered=JSON.parse(JSON.stringify(workspace));recovered.applicant.name='Recovered fixture student';recovered.draftStorageKey='fixture-recovered';
let active=workspace, revoked=false, failNote=true, failExport=true, requestedEssay='';
const base=process.env.BASE || 'http://127.0.0.1:3210';
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const errors=[];
async function intercept(page) {
 page.on('pageerror',error=>errors.push(error.message));
 await page.setRequestInterception(true);
 page.on('request',async request=>{
  const url=new URL(request.url());
  if(!url.pathname.startsWith('/api/')) return request.method()==='GET'?request.continue():request.abort();
  const json=(value,status=200)=>request.respond({status,contentType:'application/json',body:JSON.stringify(value)});
  if(url.pathname==='/api/workspace/export') {
   if(failExport)return json({error:'Fixture export unavailable'},503);
   requestedEssay=url.searchParams.get('essayId');
   if(url.searchParams.get('format')==='ics'){const result=exportCalendar(active);return request.respond({status:200,contentType:'text/calendar',headers:{'x-calendar-events':String(result.included),'x-calendar-skipped':String(result.skipped)},body:result.text});}
   return request.respond({status:200,contentType:'text/plain',body:exportPlainText(active,requestedEssay || undefined)});
  }
  if(url.pathname==='/api/workspace') {
   if(request.method()==='GET')return json(active);
   const body=JSON.parse(request.postData() || '{}');
   if(body.action==='create-recovery'){active.recoveryCode='FIXTURECODE';return json({success:true,code:'FIXTURECODE',data:active});}
   if(body.action==='create-share'){active.shares=[{token:'fixture-share-token',label:'Fixture advisor link',createdAt:Date.now()}];return json({success:true,token:'fixture-share-token',data:active});}
   if(body.action==='revoke-share'){revoked=true;active.shares=[];return json({success:true,data:active});}
   if(body.action==='claim-recovery'){active=recovered;return json({success:true,data:active});}
   return json({error:'Unexpected fixture action'},400);
  }
  if(url.pathname==='/api/share/fixture-share-token'){
   if(revoked)return json({success:false,error:'This share link has been revoked.'},404);
   if(request.method()==='POST'){
    if(failNote)return json({success:false,error:'Fixture note unavailable'},503);
    const body=JSON.parse(request.postData());workspace.advisorNotes.push({id:'fixture-note',createdAt:Date.now(),...body});
   }
   return json({success:true,label:'Fixture advisor link',data:workspace});
  }
  return json({success:true});
 });
}
try {
 const page=await browser.newPage();await intercept(page);
 await page.evaluateOnNewDocument(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('Clipboard disabled in synthetic test');}}}));
 await page.goto(base+'/hub/index.html#share',{waitUntil:'networkidle2'});await page.waitForSelector('.cf-page');
 const click=async(target,text)=>{await target.bringToFront();await target.waitForFunction(text=>[...document.querySelectorAll('button')].some(button=>button.textContent===text && !button.disabled),{},text);await target.evaluate(text=>[...document.querySelectorAll('button')].find(button=>button.textContent===text).click(),text);};
 await click(page,'Create recovery code');await page.waitForFunction(()=>document.body.innerText.includes('Recovery code ready'));
 await click(page,'Create share link');await page.waitForSelector('a[href*="share.html?t="]');await page.waitForFunction(()=>document.body.innerText.includes('Share link created'));
 const shareUrl=await page.$eval('a[href*="share.html?t="]',el=>el.href);
 const advisor=await browser.newPage();await intercept(advisor);await advisor.goto(shareUrl,{waitUntil:'networkidle2'});await advisor.waitForSelector('details');
 await advisor.$$eval('details',details=>details.forEach(detail=>detail.open=true));
 assert.ok((await advisor.evaluate(()=>document.body.innerText)).includes('This is the chosen student draft.'));
 assert.ok((await advisor.evaluate(()=>document.body.innerText)).includes('Application milestone'));
 await advisor.type('#advisor-name','Fixture advisor');await advisor.type('#advisor-note','Fixture essay feedback.');await advisor.select('select','two');
 await click(advisor,'Send note');await advisor.waitForSelector('[role="alert"]');assert.equal(await advisor.$eval('#advisor-note',el=>el.value),'Fixture essay feedback.');
 failNote=false;await click(advisor,'Send note');await advisor.waitForFunction(()=>document.body.innerText.includes('Note sent to the student.'));assert.equal(workspace.advisorNotes[0].essayId,'two');
 for(const width of [1440,390]) {await advisor.setViewport({width,height:950});assert.ok(await advisor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await advisor.screenshot({path:`/tmp/forge-advisor-fixture-${width}.png`});}
 await click(page,'Revoke');await page.waitForFunction(()=>document.body.innerText.includes('Share link revoked.'));
 await advisor.reload({waitUntil:'networkidle2'});await advisor.waitForFunction(()=>document.body.innerText.includes('Link unavailable'));
 await page.select('select','two');await click(page,'Common App pack (.txt)');await page.waitForFunction(()=>document.body.innerText.includes('Fixture export unavailable'));
 failExport=false;
 await page.evaluate(()=>{window.fixtureDownloads=[];const original=URL.createObjectURL;URL.createObjectURL=blob=>{window.fixtureDownloads.push(blob);return original.call(URL,blob);};});
 await click(page,'Common App pack (.txt)');await page.waitForFunction(()=>document.body.innerText.includes('Download ready.'));assert.equal(requestedEssay,'two');
 const downloaded=await page.evaluate(()=>window.fixtureDownloads[0].text());assert.match(downloaded,/This is the chosen student draft/);assert.doesNotMatch(downloaded,/A draft not selected for export/);
 await click(page,'Deadlines calendar (.ics)');await page.waitForFunction(()=>document.body.innerText.includes('1 date was skipped'));assert.ok((await page.evaluate(()=>document.body.innerText)).includes('1 dated event'));
 await page.type('#workspace-recovery-code','FIXTURECODE');await click(page,'Open workspace');assert.equal(active.applicant.name,'Fixture student');
 await click(page,'Stay here');await click(page,'Open workspace');
 await page.evaluate(()=>{window.originalFlush=window.cfFlushEssayDrafts;window.cfFlushEssayDrafts=async()=>{throw Error('Fixture draft save failed');};});
 await click(page,'Switch workspace');await page.waitForFunction(()=>document.body.innerText.includes('Fixture draft save failed'));assert.equal(active.applicant.name,'Fixture student');
 await page.evaluate(()=>{window.cfFlushEssayDrafts=window.originalFlush;localStorage.setItem('cf.favorites','["old-fixture-school"]');});
 await click(page,'Switch workspace');await page.waitForFunction(()=>window.CF_DATA?.applicant?.name==='Recovered fixture student');await page.waitForFunction(()=>!document.querySelector('#workspace-recovery-code')?.value);assert.equal(await page.evaluate(()=>localStorage.getItem('cf.favorites')),null);
 assert.deepEqual(errors,[]);
 console.log('PASS synthetic share drafts/timeline, note failure/retry, revoked link, selected download, skipped calendar dates, confirmed recovery and draft-flush safeguard; zero live API mutations.');
} finally {await browser.close();}
