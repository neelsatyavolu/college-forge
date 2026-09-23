import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import puppeteer from 'puppeteer-core';
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const page=await browser.newPage();await page.setContent('<div id="root"></div>');
 for(const file of ['node_modules/react/umd/react.development.js','node_modules/react-dom/umd/react-dom.development.js','public/_ds_bundle.js','public/hub/data.js'])await page.addScriptTag({content:readFileSync(file,'utf8')});
 await page.evaluate(()=>{
   window.CF_DATA={...window.CF_DATA,draftStorageKey:'workspace-one',revision:1};
   window.cfApi={getWorkspace:async()=>window.CF_DATA};
   window.Onboarding=()=>null;
   window.AiChat=({onWorkspaceChange,data})=>{window.refreshWorkspace=onWorkspaceChange;window.chatRenderedScope=data.draftStorageKey;window.chatMountedScope=React.useState(()=>data.draftStorageKey)[0];return null;};
   window.Settings=({onWorkspaceChange})=>{window.switchWorkspace=onWorkspaceChange;return React.createElement('h1',{},'Settings');};
   window.Overview=({data})=>React.createElement('h1',{},data.applicant.name||'Your college path');
   window.Profile=({onWorkspaceChange})=>{window.applyResponse=onWorkspaceChange;return React.createElement('h1',{},'Profile');};
 });
 await page.addScriptTag({content:'(()=>{'+ts.transpile(readFileSync('public/hub/App.jsx','utf8'),{jsx:ts.JsxEmit.React})+'})();'});
 await page.evaluate(()=>ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(window.App)));
 await page.waitForSelector('h1');await page.evaluate(()=>document.querySelector('a[href="#profile"]').click());
 await page.waitForFunction(()=>typeof window.applyResponse==='function');
 await page.evaluate(()=>{
   const saved={...window.CF_DATA};
   window.applyResponse({...saved,revision:3,applicant:{...saved.applicant,name:'Latest saved profile'}});
   window.applyResponse({...saved,revision:2,applicant:{...saved.applicant,name:'Late older response'}});
 });
 assert.equal(await page.evaluate(()=>window.CF_DATA.applicant.name),'Latest saved profile');
 await page.evaluate(()=>document.querySelector('a[href="#settings"]').click());
 await page.waitForFunction(()=>typeof window.switchWorkspace==='function');
 await page.evaluate(()=>{
   window.oldResponse={...window.CF_DATA};
   window.cfApi.getWorkspace=()=>new Promise(resolve=>window.finishRefresh=resolve);
   window.refreshPending=window.refreshWorkspace();
   window.switchWorkspace({...window.CF_DATA,draftStorageKey:'recovered-workspace',revision:1,applicant:{...window.CF_DATA.applicant,name:'Recovered profile'}});
   window.applyResponse({...window.oldResponse,revision:10});
 });
 assert.equal(await page.evaluate(()=>window.CF_DATA.applicant.name),'Recovered profile','A delayed response from a former workspace must be ignored');
 await page.evaluate(async()=>{window.finishRefresh(window.oldResponse);await window.refreshPending;});
 assert.equal(await page.evaluate(()=>window.CF_DATA.applicant.name),'Recovered profile','A pre-switch refresh must not restore a former workspace');
 await page.waitForFunction(()=>window.chatRenderedScope==='recovered-workspace');
 assert.equal(await page.evaluate(()=>window.chatMountedScope),'recovered-workspace','A workspace switch starts a fresh copilot conversation');
 console.log('PASS late responses and refreshes cannot undo a workspace switch; explicit switches accept their own revision');
} finally {await browser.close();}
