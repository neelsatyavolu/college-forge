// Drives the real hub bundle in headless Chrome against the real /api/me and /api/workspace handlers
// (other endpoints are stubbed). Synthetic data only. Run `node scripts/build-hub.mjs` first.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import Module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import puppeteer from 'puppeteer-core';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) + '.ts' : request, ...args); };

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'forge-onboarding-flow-'));
process.env.CF_DATA_DIR = dataDir;
delete process.env.BLOB_READ_WRITE_TOKEN;
process.env.SESSION_SECRET = 'synthetic-session-secret-for-the-flow-test-0123';
const { NextRequest } = require('next/server');
const store = require(path.join(root, 'lib/store.ts'));
const { signSession } = require(path.join(root, 'lib/session.ts'));
const workspaceRoute = require(path.join(root, 'app/api/workspace/route.ts'));
const meRoute = require(path.join(root, 'app/api/me/route.ts'));

const ORIGIN = 'http://forge.test';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const state = { aiConnected: false, calls: [] };
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function realRoute(handler, request) {
  const init = { method: request.method(), headers: request.headers() };
  if (!['GET', 'HEAD'].includes(init.method)) init.body = request.postData() || '';
  const res = await handler(new NextRequest(request.url(), init));
  return { status: res.status, contentType: res.headers.get('content-type') || 'application/json', body: await res.text() };
}

async function answer(request) {
  const url = new URL(request.url());
  if (url.origin !== ORIGIN) return null; // fonts and analytics
  const body = request.postData();
  if (url.pathname.startsWith('/api/')) state.calls.push({ path: url.pathname, body: body && body.startsWith('{') ? JSON.parse(body) : null });
  if (url.pathname === '/api/me') return realRoute(meRoute.GET, request);
  if (url.pathname === '/api/workspace') return realRoute(request.method() === 'GET' ? workspaceRoute.GET : workspaceRoute.POST, request);
  if (url.pathname === '/api/applications') return json({ success: true, data: { revision: 0, autocheck: false, apps: [] } });
  if (url.pathname === '/api/ai/status') return json({ active: state.aiConnected ? 'codex' : null });
  if (url.pathname === '/api/upload') return json({ saved: [{ name: 'transcript.pdf', chars: 1234 }], errors: [] });
  if (url.pathname === '/api/ai/chat') return { status: 200, contentType: 'application/x-ndjson', body: '{"type":"status","message":"Working"}\n{"type":"done"}\n' };
  if (url.pathname === '/api/ai/build-plan') return json({ schools: [{ label: 'Sample U', prompt: 'deadlines for sample-u' }], rounds: { label: 'Rounds', prompt: 'rounds' }, milestones: { label: 'Milestones', prompt: 'milestones' } });
  if (url.pathname.startsWith('/api/')) return json({ success: false, error: 'Not stubbed' }, 404);
  const file = path.join(root, 'public', path.normalize(url.pathname));
  if (!file.startsWith(path.join(root, 'public')) || !existsSync(file)) return { status: 404, contentType: 'text/plain', body: '' };
  return { status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: readFileSync(file) };
}

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (error) => console.error('page error:', error.message));
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    try {
      const reply = await answer(request);
      if (reply) await request.respond(reply); else await request.abort();
    } catch (error) {
      console.error('stub failed for', request.url(), error);
      await request.respond({ status: 500, contentType: 'text/plain', body: '' });
    }
  });

  const text = () => page.evaluate(() => document.body.innerText);
  const waitText = (s) => page.waitForFunction((s) => document.body.innerText.includes(s), {}, s);
  const click = (label) => page.evaluate((label) => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
    if (!el) throw Error('No button ' + label);
    el.click();
  }, label);
  const disabled = (label) => page.evaluate((label) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label).disabled, label);
  const fill = (selector, value) => page.$eval(selector, (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  const activeStep = () => page.evaluate(() => document.querySelector('.cf-onboard-progress__item.is-active .cf-onboard-progress__label')?.textContent);
  const waitStep = (label) => page.waitForFunction((label) => document.querySelector('.cf-onboard-progress__item.is-active .cf-onboard-progress__label')?.textContent === label, {}, label);
  const reviewRow = (label) => page.evaluate((label) => [...document.querySelectorAll('.cf-onboard-review-row')].find((r) => r.firstChild.textContent === label)?.lastChild.textContent, label);
  const signIn = async (workspaceId) => {
    await page.deleteCookie({ name: 'forge_session', url: ORIGIN });
    await page.setCookie({ name: 'forge_session', value: signSession({ sub: 'sub-' + workspaceId, workspaceId, email: 'student@example.com', name: 'Sample' }), url: ORIGIN });
    await page.goto(ORIGIN + '/hub/index.html');
  };

  // ── New account, no AI ──
  await signIn('flow-no-ai');
  await waitText('Set up your applications hub');
  assert.equal(await activeStep(), 'Welcome', 'A new account lands in the wizard by itself');

  await click('Return to workspace');
  await waitText('Finish setup');
  assert.match(await text(), /Setup isn't finished/, 'The workspace shows a Finish setup banner until onboarding is done');
  await click('Finish setup');
  await waitStep('Welcome');

  await click('Continue');
  await waitStep('Files');
  await click('Skip');
  await waitStep('You');
  await fill('[placeholder="Alex Rivera"]', 'Sample Student');
  await fill('[placeholder="2027"]', '2027');
  await fill('[placeholder="Lincoln High School"]', 'Sample High');
  await fill('[placeholder="Computer Science"]', 'Biology');
  await click('Continue');
  await waitStep('Academics');
  await fill('[placeholder="3.95"]', '4.5');
  assert.equal(await disabled('Continue'), true, 'Unweighted GPA over 4 must be rejected');
  await fill('[placeholder="3.95"]', '3.7');
  await fill('[placeholder="1540"]', '1700');
  assert.equal(await disabled('Continue'), true, 'SAT over 1600 must be rejected');
  await fill('[placeholder="1540"]', '');
  await fill('[placeholder="32"]', '40');
  assert.equal(await disabled('Continue'), true, 'ACT over 36 must be rejected');
  await fill('[placeholder="32"]', '31');
  await click('Continue');
  await waitStep('Fit');
  await page.select('select[aria-label="State of residence"]', 'WA');
  await click('$15k–30k');
  await page.evaluate(() => [...document.querySelectorAll('section')].find((s) => s.textContent.includes('need-based aid')).querySelector('button').click());
  await page.evaluate(() => [...document.querySelectorAll('section')].find((s) => s.textContent.includes('Early Decision')).querySelectorAll('button')[2].click());
  await click('Continue');
  await waitStep('Story');
  await fill('textarea', 'Debate captain — 8 hrs/wk, 3 yrs\nLibrary volunteer');

  // Reload mid-wizard: the step and every answer come back.
  await new Promise((r) => setTimeout(r, 700));
  await page.reload();
  await waitStep('Story');
  assert.equal(await page.$eval('textarea', (el) => el.value), 'Debate captain — 8 hrs/wk, 3 yrs\nLibrary volunteer', 'Story text survives a reload');
  await click('Continue');
  await waitStep('List');
  assert.match(await text(), /About 3 reach \/ 5 target \/ 4 likely/, 'Ambition cards show the list mix for the default 12 applications');
  assert.doesNotMatch(await text(), /School size/, 'The size question is gone');
  await click('10');
  assert.match(await text(), /About 3 reach \/ 4 target \/ 3 likely/, 'The mix follows the application count');
  await click('Continue');
  await waitStep('Build');
  assert.equal(await reviewRow('Name'), 'Sample Student', 'Identity survives a reload');
  assert.equal(await reviewRow('ACT'), '31');
  assert.equal(await reviewRow('State'), 'Washington');
  assert.equal(await reviewRow('Budget'), '$15k–30k');
  assert.equal(await reviewRow('Need-based aid'), 'Yes');
  assert.equal(await reviewRow('Early Decision'), 'No');
  assert.match(await text(), /Enrich with AI \(optional\)/, 'AI connect is offered on the Build step');

  await click('Build my hub ✱');
  await page.waitForFunction(() => !document.querySelector('.cf-onboard'));
  assert.ok(!state.calls.some((c) => c.path === '/api/ai/chat'), 'No provider must never call AI chat');
  const ws = await store.getWorkspace('flow-no-ai');
  assert.equal(ws.onboarding.completed, true);
  assert.equal(ws.profile.residency, 'WA');
  assert.equal(ws.profile.testing.act, '31');
  assert.deepEqual([ws.onboarding.listPrefs.budget, ws.onboarding.listPrefs.needAid, ws.onboarding.listPrefs.ed], ['15-30', true, 'no']);
  assert.equal(ws.onboarding.listPrefs.appCount, 10);
  assert.deepEqual(ws.profile.activities.map((a) => [a.name, a.desc]), [['Debate captain', '8 hrs/wk, 3 yrs'], ['Library volunteer', undefined]], 'Story lines become activities without AI');
  assert.ok(ws.colleges.length > 0 && Array.isArray(ws.onboarding.listGaps), 'A seeded list and its gaps are saved');
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('cf.onboard.')).length), 0, 'Saved progress is cleared after submitting');
  assert.doesNotMatch(await text(), /Setup isn't finished/, 'The banner goes away once onboarding is done');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.cf-workspace'));
  assert.equal(await page.$('.cf-onboard'), null, 'A finished account does not reopen the wizard');
  console.log('No-AI onboarding: opens by itself, resumes after reload, saves residency/ACT/budget/aid/ED, turns story lines into activities, never calls AI.');

  // ── New account with AI: hand off after the profile step, research in the background ──
  state.aiConnected = true;
  state.calls = [];
  await signIn('flow-with-ai');
  await waitStep('Welcome');
  await click('Continue');
  await waitStep('Files');
  const transcriptInput = await page.$('input[type=file]');
  await transcriptInput.uploadFile(path.join(root, 'package.json'));
  await waitText('✓ transcript.pdf');
  await click('Continue');
  await fill('[placeholder="Alex Rivera"]', 'Sample Student');
  await fill('[placeholder="2027"]', '2027');
  await fill('[placeholder="Lincoln High School"]', 'Sample High');
  await fill('[placeholder="Computer Science"]', 'Biology');
  for (const next of ['Academics', 'Fit', 'Story', 'List', 'Build']) {
    if (next === 'Fit') await fill('[placeholder="3.95"]', '3.7');
    await click('Continue');
    await waitStep(next);
  }
  assert.match(await text(), /Use ChatGPT to sort my story/, 'A connected AI shows as an opt-in on Build');
  await click('Build my hub ✱');
  await page.waitForFunction(() => !document.querySelector('.cf-onboard'));
  const chats = () => state.calls.filter((c) => c.path === '/api/ai/chat').map((c) => c.body.messages[0].content);
  assert.match(chats()[0], /## Transcript[^\n]*\n[^]*transcript\.pdf/, 'AI build prompt names the transcript');
  assert.match(chats()[0], /read_upload/i, 'AI is told to read the transcript');
  await page.waitForFunction(() => document.querySelector('.cf-plan-pill')?.textContent.includes('Deadlines and essay prompts added.'));
  assert.ok(state.calls.some((c) => c.path === '/api/ai/build-plan'), 'Deadline research runs after the wizard closes');
  assert.deepEqual(chats().slice(1), ['deadlines for sample-u', 'rounds', 'milestones']);
  console.log('Connected AI: profile step runs in the wizard, the hub opens, deadline and prompt research finishes in the background pill.');
} finally {
  await browser.close();
  rmSync(dataDir, { recursive: true, force: true });
}
