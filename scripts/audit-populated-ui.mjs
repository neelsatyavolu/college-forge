import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
const base=process.env.BASE || 'http://127.0.0.1:3211';
const output='/tmp/forge-ui-audit';await mkdir(output,{recursive:true});
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const issues=[],errors=[];
try{
 const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:'light'},{name:'prefers-reduced-motion',value:'reduce'}]);
 for(const width of [1440,768,390,320]){
  await page.setViewport({width,height:950});
  for(const [step,view] of ['overview','profile','shortlist','essays','planner','timeline','track','compare','share','settings','recommendations'].entries()){
   await page.goto(`${base}/hub/index.html#${view}`,{waitUntil:'networkidle2'});await page.waitForSelector('.cf-page');
   const result=await page.evaluate(()=>{
    const visible=element=>!!(element.offsetWidth || element.offsetHeight || element.getClientRects().length) && getComputedStyle(element).visibility!=='hidden' && !element.closest('[inert]');
    const inputIssues=[...document.querySelectorAll('input:not([type="hidden"]),select,textarea')].filter(visible).filter(el=>!el.labels?.length && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !el.getAttribute('title')).map(el=>({tag:el.tagName,placeholder:el.getAttribute('placeholder'),type:el.type}));
    const buttonIssues=[...document.querySelectorAll('button')].filter(visible).filter(el=>!el.innerText.trim() && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !el.getAttribute('title')).map(el=>el.outerHTML.slice(0,150));
    return {overflow:document.documentElement.scrollWidth>innerWidth+1,scrollWidth:document.documentElement.scrollWidth,inputIssues,buttonIssues};
   });
   if(result.overflow || result.inputIssues.length || result.buttonIssues.length)issues.push({width,view,...result});
   if(width===1440||width===390)await page.screenshot({path:`${output}/${String(step+1).padStart(2,'0')}-${view}-${width}.png`});
  }
 }
 await writeFile(output+'/findings.json',JSON.stringify({issues,errors},null,2));
 console.log(JSON.stringify({issues,errors},null,2));
 assert.deepEqual(errors,[],'populated pages render without runtime exceptions');
 assert.deepEqual(issues,[],'populated pages have no page overflow or unlabeled visible controls');
}finally{await browser.close();}
