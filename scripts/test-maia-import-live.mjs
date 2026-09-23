// End-to-end check of the Maia scattergram import against a running Forge
// server: the real bookmarklet from the hub, public/maia/import.js, and the
// popup, with app.maialearning.com and Maia's API faked by request interception.
// Usage: BASE=http://localhost:3000 node scripts/test-maia-import-live.mjs
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE || 'http://localhost:3000';
const WS = 'maia-e2e-' + Date.now();
const MAIA = 'https://app.maialearning.com';
const API = 'https://app-www-maia.maialearning.com/ajs-services/';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64({ alg: 'HS256' })}.${b64({ exp: 9e9, uid: '1513688', ds: 'x' })}.sig`;
const headers = { cookie: 'cf_workspace=' + WS, 'content-type': 'application/json' };

for (const college of [
  { slug: 'tufts-university', name: 'Tufts University', short: 'Tufts', scorecardId: 168148 },
  { slug: 'bates-college', name: 'Bates College', short: 'Bates' },
  { slug: 'nowhere-college', name: 'Nowhere College', short: 'Nowhere' },
]) {
  const r = await fetch(BASE + '/api/workspace/colleges', { method: 'POST', headers, body: JSON.stringify({ college }) });
  assert.equal(r.status, 200, 'seed college');
}

const cors = { 'access-control-allow-origin': MAIA, 'access-control-allow-headers': 'authorization, content-type, accept', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const seen = [];
function fakeMaiaApi(req) {
  const path = req.url().slice(API.length);
  if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
  seen.push({ path, auth: req.headers().authorization, body: req.postData() });
  const json = (body) => req.respond({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
  if (path === 'college_nid_by_unitid/168148') return json({ nid: 176766 });
  if (path === 'college_search_for_add') {
    const q = JSON.parse(req.postData()).search;
    return json(q === 'Bates College' ? { total_records: 1, 0: { nid: 555, title: 'Bates College' } } : { total_records: 0 });
  }
  if (path === 'scattergram-colleges-by-name') {
    const body = JSON.parse(req.postData());
    if (body.school_id !== '11237322') return req.respond({ status: 406, headers: cors, contentType: 'application/json', body: JSON.stringify(['You are not authorized to access information for this school.']) });
    if (body.collegeNid === 555) return json([]);
    return json({ 0: { sat: '1520', gpa: '3.95', result: 'Accepted', type: 'Early Decision' }, 1: { sat: '1450', gpa: '3.7', result: 'Denied ', type: 'Regular Decision' }, avg_gpa: '3.9', avg_sat: '1510', student: { gpa: '3.49', wgpa: '3.83', sat: '1500' } });
  }
  return req.respond({ status: 404, headers: cors, body: 'unexpected ' + path });
}

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  await browser.setCookie({ name: 'cf_workspace', value: WS, url: BASE });
  const hub = await browser.newPage();
  await hub.goto(BASE + '/hub/index.html#scattergrams', { waitUntil: 'networkidle2' });
  const bookmarklet = await hub.$eval("a[href^='javascript:']", (a) => a.getAttribute('href'));
  assert.match(bookmarklet, new RegExp(BASE.replace(/[.:/]/g, '\\$&') + '/maia/import\\.js'));

  const maia = await browser.newPage();
  const errors = [];
  maia.on('pageerror', (e) => errors.push(e.message));
  await maia.setRequestInterception(true);
  maia.on('request', (req) => {
    if (req.url().startsWith(API)) return fakeMaiaApi(req);
    if (req.url().startsWith(MAIA)) return req.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Maia</title><body></body>' });
    // Chrome blocks a public https page from loading http://localhost (Private Network
    // Access), so serve the real script from the running server through interception.
    if (req.url().startsWith(BASE + '/maia/')) {
      return fetch(req.url()).then(async (r) => req.respond({ status: r.status, contentType: 'text/javascript', body: await r.text() }));
    }
    return req.continue();
  });
  await maia.goto(MAIA + '/v3/search');
  // Mirrors real Maia storage: plain-text JWT, a base64 Drupal profile whose first
  // organic group is not the school (and iec_school "0"), and placeholder sel_* keys.
  const profile = Buffer.from(JSON.stringify({ iec_school: '0', user: { uid: '1513688', og_user_node: { und: [{ target_id: '999' }, { target_id: '11237322' }] } } })).toString('base64');
  await maia.evaluate((token, href, blob) => {
    localStorage.setItem('userAccessKey', token);
    localStorage.setItem('userToken', blob);
    localStorage.setItem('sel_school', 'null');
    localStorage.setItem('sel_user', 'null');
    const a = document.createElement('a');
    a.id = 'bm'; a.textContent = 'bookmark'; a.href = href;
    document.body.appendChild(a);
  }, TOKEN, bookmarklet, profile);

  const popupTarget = browser.waitForTarget((t) => t.url().includes('/hub/maia-import.html'), { timeout: 10000 });
  await maia.click('#bm');
  const popup = await (await popupTarget).page();
  await popup.waitForFunction(() => /Imported|Couldn|didn/.test(document.getElementById('status').textContent), { timeout: 20000 }).catch(async (e) => {
    console.error('popup status:', await popup.$eval('#status', (n) => n.textContent), '| maia errors:', errors, '| maia calls:', seen.map((s) => s.path));
    throw e;
  });
  const status = await popup.$eval('#status', (n) => n.textContent);
  const missing = await popup.$eval('#missing', (n) => n.textContent);
  assert.match(status, /Imported 2 colleges \(1 with applicants/);
  assert.match(missing, /Nowhere College — Not found in Maia/);

  const scatterCalls = seen.filter((s) => s.path === 'scattergram-colleges-by-name').map((s) => ({ ...s, school: JSON.parse(s.body).school_id }));
  assert.deepEqual(scatterCalls.map((s) => s.school), ['999', '11237322', '11237322'], 'wrong school rejected once, then the next candidate sticks');
  const scatter = scatterCalls[1];
  assert.equal(scatter.auth, 'Bearer ' + TOKEN);
  assert.deepEqual(JSON.parse(scatter.body), { class_of_years: '4', app_plan: [], collegeNid: 176766, type: 'sat', grading_type: 'gpa', school_id: '11237322', student_uid: '1513688' });

  const saved = await (await fetch(BASE + '/api/workspace/scattergrams', { headers })).json();
  assert.equal(saved.data.colleges['tufts-university'].n, 2);
  assert.equal(saved.data.colleges['bates-college'].n, 0);
  assert.deepEqual(saved.data.student, { gpa: 3.49, wgpa: 3.83, sat: 1500 });
  assert.equal(JSON.stringify(saved).includes(TOKEN), false, 'the Maia token never reaches Forge');
  // Running the bookmark again reuses the popup and completes a fresh import.
  const callsBefore = seen.length;
  const reloaded = popup.waitForNavigation();
  await maia.click('#bm');
  await reloaded;
  await popup.waitForFunction(() => /Imported/.test(document.getElementById('status').textContent), { timeout: 20000 });
  assert.ok(seen.length > callsBefore, 'second run called Maia again');

  assert.deepEqual(errors, []);
  console.log('PASS Maia bookmarklet → popup → Forge import (' + seen.length + ' Maia API calls)');
} finally {
  await fetch(BASE + '/api/workspace', { method: 'POST', headers, body: JSON.stringify({ action: 'reset' }) }).catch(() => {});
  await browser.close();
}
