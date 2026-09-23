import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const base = process.env.BASE || 'http://127.0.0.1:3210';
const browser = await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  const page = await browser.newPage();
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.setViewport({width:1440,height:1000});
  await page.goto(base+'/hub/index.html#explore',{waitUntil:'networkidle2'});
  await page.waitForSelector('.cf-split__detail h2',{timeout:60000});
  const clickText = text => page.evaluate(text=>[...document.querySelectorAll('button')].find(button=>button.textContent===text).click(),text);
  for (const width of [1440,930,768,390]) {
    await page.setViewport({width,height:950});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Explore page overflow at ${width}`);
    if(width<=960) assert.ok(await page.evaluate(()=>document.querySelector('.cf-split__list').getBoundingClientRect().width>=document.querySelector('.cf-split').getBoundingClientRect().width-2),`Explore results must fill stacked width at ${width}`);
    await page.screenshot({path:`/tmp/forge-explore-after-${width}.png`});
  }
  await clickText('+ Add to my list');
  await page.waitForFunction(()=>document.body.innerText.includes('Remove from list'));
  await clickText('Remove from list');
  await page.waitForFunction(()=>document.body.innerText.includes('Confirm removal'));
  await clickText('Keep school');
  assert.ok((await page.evaluate(()=>document.body.innerText)).includes('Remove from list'));
  await clickText('Remove from list');
  await clickText('Confirm removal');
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='+ Add to my list'));
  const schoolCount = await page.evaluate(async()=>{
    const response = await fetch('/api/colleges/search?browse=1'); const body = await response.json();
    const colleges = body.data.slice(0,6);
    for(const college of colleges) {
      const {name,slug,short,scorecardId} = college;
      const response = await fetch('/api/workspace/colleges',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({college:{name,slug,short,scorecardId,tier:'safety'}})});
      if(!response.ok) throw Error('Could not seed test workspace');
    }
    return colleges.length;
  });
  assert.equal(schoolCount,6);
  await page.goto(base+'/hub/index.html#compare',{waitUntil:'networkidle2'});
  await page.reload({waitUntil:'networkidle2'});
  await page.waitForSelector('table');
  await page.waitForFunction(()=>!document.body.innerText.includes('Loading current available school data'),{timeout:60000});
  assert.equal(await page.$eval('tbody tr:nth-child(2) td',cell=>cell.textContent==='—'),false,'Compare must hydrate missing saved admission statistics');
  assert.equal(await page.$eval('tbody tr:first-child td',cell=>cell.textContent),'Likely');
  let failDetail = true;
  await page.setRequestInterception(true);
  page.on('request',request=>request.url().includes('/api/colleges/detail') && failDetail ? request.respond({status:503,contentType:'application/json',body:JSON.stringify({success:false,error:'Unavailable'})}) : request.continue());
  await page.evaluate(()=>[...document.querySelectorAll('[aria-label="Schools to compare"] button')].find(button=>button.getAttribute('aria-pressed')==='false').click());
  await page.waitForFunction(()=>document.querySelector('[aria-label="Schools to compare"] button:disabled'));
  assert.equal(await page.$$eval('[aria-label="Schools to compare"] button[aria-pressed="true"]',buttons=>buttons.length),5);
  await page.waitForFunction(()=>document.body.innerText.includes('Some school details could not load'));
  failDetail = false;
  await clickText('Retry details');
  await page.waitForFunction(()=>!document.body.innerText.includes('Loading current available school data') && !document.body.innerText.includes('Some school details could not load'),{timeout:60000});
  for(const width of [1440,768,390]) {
    await page.setViewport({width,height:950});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Compare page overflow at ${width}`);
    await page.screenshot({path:`/tmp/forge-compare-${width}.png`});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS real Explore browse/add/confirmed removal, full-width stacked list, sparse Compare hydration, five-school limit, detail error/retry, desktop/mobile layout, no runtime errors.');
} finally {await browser.close();}
