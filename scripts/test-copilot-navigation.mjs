import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const base=process.env.BASE || 'http://127.0.0.1:3211';
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const page=await browser.newPage();await page.setViewport({width:1440,height:950});
 await page.goto(base+'/hub/index.html',{waitUntil:'networkidle2'});await page.waitForSelector('.cf-copilot-launch');
 await page.click('.cf-copilot-launch');await page.waitForSelector('[role="dialog"]');
 await page.click('nav a[href="#profile"]');
 assert.equal(await page.$eval('h1',el=>el.textContent),'Everything on file','a modeless copilot must not block workspace navigation');
 await page.keyboard.press('Escape');await page.setViewport({width:390,height:950});
 await page.click('button[aria-label="Open navigation"]');
 await page.waitForFunction(()=>document.querySelector('.cf-sidebar').getBoundingClientRect().left>=-1);
 await page.click('.cf-copilot-launch');await page.waitForSelector('[role="dialog"]');
 assert.equal(await page.$eval('#workspace-sidebar',el=>el.classList.contains('is-open')),false,'mobile drawer closes when launching copilot');
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
 assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-controls')),'workspace-sidebar','focus returns to a visible navigation control');
 console.log('PASS modeless copilot allows page navigation and mobile launch/close restores visible focus');
}finally{await browser.close();}
