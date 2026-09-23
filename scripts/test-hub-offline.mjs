import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const base = process.env.BASE || 'http://127.0.0.1:3210';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  const failedLocal = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().startsWith(base) && response.status() >= 400 && /\.(?:js|css)(?:\?|$)/.test(response.url())) failedLocal.push(`${response.status()} ${response.url()}`);
  });
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = request.url();
    if (url.startsWith(base + '/') || url.startsWith('data:')) request.continue();
    else request.abort();
  });
  await page.goto(base + '/hub/index.html', { waitUntil: 'networkidle2' });
  await page.waitForSelector('.cf-page');
  assert.equal(await page.evaluate(() => typeof window.Babel), 'undefined');
  const sources = await page.$$eval('script[src]', scripts => scripts.map(s => s.src));
  assert.ok(sources.every(src => src.startsWith(base + '/')), 'all scripts are local');
  for (const view of ['recommendations','profile','explore','shortlist','essays','planner','timeline','track','compare','share','settings']) {
    await page.evaluate(view => { location.hash = view; }, view);
    await page.waitForFunction(() => document.querySelector('.cf-page') || document.querySelector('main'));
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(await page.$eval('#root', root => root.textContent.length > 100), true, `${view} renders with external requests blocked`);
  }
  await page.goto(base + '/hub/share.html', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.getElementById('root').textContent.includes('Missing share token'));
  assert.deepEqual(failedLocal, [], 'all local JS/CSS assets load');
  assert.deepEqual(errors, [], 'hub and share have no runtime exceptions');
  console.log('PASS hub navigation and shared page with all external requests blocked; no Babel or runtime exceptions');
} finally { await browser.close(); }
