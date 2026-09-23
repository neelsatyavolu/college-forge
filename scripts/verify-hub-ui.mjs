import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const base = process.env.BASE || 'http://127.0.0.1:3210';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(base + '/hub/index.html', { waitUntil: 'networkidle2' });
  await page.waitForSelector('.cf-page');
  assert.equal(await page.$$eval('nav[aria-label="Workspace"]', els => els.length), 1, 'grouped workspace navigation exists');
  await page.click('a[href="#recommendations"]');
  await page.waitForFunction(() => document.querySelector('h1')?.textContent.includes('Colleges for you'));
  assert.equal(new URL(page.url()).hash, '#recommendations');
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('h1')?.textContent.includes('college'));
  assert.equal(new URL(page.url()).hash, '', 'browser Back returns to home');
  for (const width of [1440, 768, 390]) {
    await page.setViewport({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no page overflow at ${width}px`);
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
    await page.screenshot({ path: `/tmp/forge-home-${width}.png` });
  }
  const failurePage = await browser.newPage();
  await failurePage.setRequestInterception(true);
  failurePage.on('request', req => req.url().endsWith('/api/workspace') ? req.respond({ status: 503, contentType: 'application/json', body: '{"error":"Unavailable"}' }) : req.continue());
  await failurePage.goto(base + '/hub/index.html', { waitUntil: 'networkidle2' });
  await failurePage.waitForSelector('[role="alert"]');
  assert.match(await failurePage.$eval('[role="alert"]', el => el.textContent), /load|open/i, 'failed workspace fetch is visible');
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log('PASS navigation, browser Back, desktop/mobile layout, workspace load errors');
} finally { await browser.close(); }
