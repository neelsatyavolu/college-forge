import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const base=process.env.BASE || 'http://127.0.0.1:3211';
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const page=await browser.newPage();await page.setViewport({width:390,height:950});
 await page.goto(base+'/hub/index.html#essays',{waitUntil:'networkidle2'});await page.waitForSelector('textarea');
 assert.equal(await page.$$eval('select[aria-label="Choose an essay"]',els=>els.length),1,'mobile essay picker is available');
 assert.ok(await page.$eval('textarea',el=>el.getBoundingClientRect().height>=240),'mobile writing area has useful height');
 assert.ok(await page.$eval('textarea',el=>el.getBoundingClientRect().top<950),'draft begins without scrolling past the school list');
 const ids=await page.$$eval('select[aria-label="Choose an essay"] option',els=>els.filter(el=>!el.disabled).map(el=>el.value));
 await page.select('select[aria-label="Choose an essay"]',ids[1]);
 await page.type('textarea','A synthetic draft written using the mobile essay picker.');
 await page.waitForFunction(()=>document.body.innerText.includes('Saved to hub'));
 await page.select('select[aria-label="Choose an essay"]',ids[0]);
 await page.select('select[aria-label="Choose an essay"]',ids[1]);
 assert.match(await page.$eval('textarea',el=>el.value),/synthetic draft written/);
 await page.$eval('textarea',el=>el.focus());
 assert.notEqual(await page.$eval('textarea',el=>getComputedStyle(el).outlineStyle),'none','keyboard focus on the editor is visible');
 await page.screenshot({path:'/tmp/forge-ui-audit/mobile-writing-after.png'});
 await page.goto(base+'/hub/index.html#profile',{waitUntil:'networkidle2'});await page.waitForSelector('.cf-grid-4');
 assert.ok(await page.$eval('.cf-grid-4',el=>el.getBoundingClientRect().height<380),'profile summary is compact on mobile');
 assert.ok(await page.$eval('.cf-grid-profile',el=>el.getBoundingClientRect().top<950),'activities begin within the first mobile screen');
 assert.equal(await page.$eval('main',el=>getComputedStyle(el).paddingLeft),'20px','mobile content has comfortable side spacing');
 await page.screenshot({path:'/tmp/forge-ui-audit/mobile-profile-after.png'});
 console.log('PASS compact mobile profile, accessible essay picker, useful editor size, draft switching, and visible keyboard focus');
}finally{await browser.close();}
