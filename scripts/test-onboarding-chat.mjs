// Drives the onboarding chat in headless Chrome against the real /api/me and /api/workspace handlers,
// with a scripted stand-in for the AI. Synthetic data only. Run `node scripts/build-hub.mjs` first.
// Screenshots land in $SHOTS (default: a temp folder) at 1440, 1000 and 390 px.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
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

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'forge-onboarding-chat-'));
const shots = process.env.SHOTS || mkdtempSync(path.join(os.tmpdir(), 'forge-onboarding-shots-'));
mkdirSync(shots, { recursive: true });
process.env.CF_DATA_DIR = dataDir;
delete process.env.BLOB_READ_WRITE_TOKEN;
process.env.SESSION_SECRET = 'synthetic-session-secret-for-the-flow-test-0123';
const { NextRequest } = require('next/server');
const store = require(path.join(root, 'lib/store.ts'));
const { signSession } = require(path.join(root, 'lib/session.ts'));
const workspaceRoute = require(path.join(root, 'app/api/workspace/route.ts'));
const meRoute = require(path.join(root, 'app/api/me/route.ts'));
const { recordTurn } = require(path.join(root, 'lib/interview-tools.ts'));

const ORIGIN = 'http://forge.test';
const WS = 'chat-flow';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const state = { aiConnected: false, chats: [], researchStarted: false };
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const nd = (...events) => ({ status: 200, contentType: 'application/x-ndjson', body: events.map((e) => JSON.stringify(e)).join('\n') + '\n{"type":"done"}\n' });
const SCHOOLS = [
  ...['Ohio State University', 'University of Pittsburgh'].map((name) => ({ name, tier: 'likely', reason: 'Strong biology program and your budget works with in-state aid.', estChance: '75%', netPrice: '$24,000', fitsBudget: 'yes' })),
  ...['Case Western Reserve University', 'University of Rochester', 'Tufts University', 'Boston College'].map((name) => ({ name, tier: 'target', reason: 'Undergraduate research in biology from first year.', estChance: '35%', netPrice: '$31,500' })),
  ...['Johns Hopkins University', 'Duke University', 'Brown University', 'Rice University'].map((name) => ({ name, tier: 'reach', reason: 'Top biology research; meets full need.', estChance: '9%' })),
];

async function realRoute(handler, request) {
  const init = { method: request.method(), headers: request.headers() };
  if (!['GET', 'HEAD'].includes(init.method)) init.body = request.postData() || '';
  const res = await handler(new NextRequest(request.url(), init));
  return { status: res.status, contentType: res.headers.get('content-type') || 'application/json', body: await res.text() };
}

/** The scripted AI: answers each onboarding turn in order, and saves the transcript like the real route. */
async function fakeChat(body) {
  const reply = await scripted(body);
  if (body.mode === 'onboarding') {
    const events = reply.body.trim().split('\n').map((l) => JSON.parse(l));
    const text = events.filter((e) => e.type === 'delta').map((e) => e.text).join('');
    const q = events.find((e) => e.type === 'question'), l = events.find((e) => e.type === 'list'), st = events.find((e) => e.type === 'strategy');
    const ui = q ? { question: q.question } : l ? { list: l.schools } : st ? { strategy: st.strategy } : undefined;
    await store.updateWorkspace(WS, (w) => recordTurn(recordTurn(w, { role: 'user', content: body.messages.at(-1).content, at: Date.now() }), { role: 'assistant', content: text, ...(ui ? { ui } : {}), at: Date.now() }));
  }
  return reply;
}

async function scripted(body) {
  state.chats.push(body);
  if (body.mode === 'research') {
    const slug = /\[([a-z0-9-]+)\]/.exec(body.messages[0].content)?.[1] || 'x';
    await store.updateWorkspace(WS, (w) => ({ ...w, colleges: w.colleges.map((c) => (c.slug === slug ? { ...c, research: { slug, name: c.name, checkedAt: '2026-11-25', complete: true, facts: [], deadlines: [], supplements: [] } } : c)) }));
    return nd({ type: 'tool', name: 'web_fetch', round: 1 }, { type: 'research', slug, name: slug, stage: 'done', facts: 14 });
  }
  if (body.mode !== 'onboarding') return nd({ type: 'delta', text: 'Saved.' });
  const n = state.chats.filter((c) => c.mode === 'onboarding').length;
  if (n === 1) return nd({ type: 'delta', text: "Great to meet you, Sam. Let's start with where you'd like to live for four years." }, { type: 'question', question: { id: 'setting', kind: 'multi', prompt: 'Campus setting', options: [{ value: 'urban', label: 'City' }, { value: 'suburban', label: 'Suburban' }, { value: 'college-town', label: 'College town', hint: 'Campus is the town' }, { value: 'rural', label: 'Rural' }, { value: 'any', label: 'No preference' }], allowOther: true } });
  if (n === 2) return nd({ type: 'delta', text: 'Got it. Do you have your transcript? It saves us typing every course.' }, { type: 'question', question: { id: 'transcript', kind: 'upload', prompt: 'Transcript' } });
  if (n === 3) return nd({ type: 'delta', text: 'Thanks, I read it. Now the things you do outside class.' }, { type: 'question', question: { id: 'acts', kind: 'activities', prompt: 'List your activities and any awards' } });
  if (n === 4) return nd({ type: 'delta', text: 'Great list. What did you get on the SAT?' }, { type: 'question', question: { id: 'sat', kind: 'number', prompt: 'SAT total', min: 400, max: 1600 } });
  if (n === 5) {
    await store.updateWorkspace(WS, (w) => ({ ...w, onboarding: { ...w.onboarding, interview: { ...w.onboarding.interview, phase: 'list', listDraft: SCHOOLS } } }));
    return nd({ type: 'delta', text: "Here's a first list: 10 applications, balanced, with two likely schools that fit your budget." }, { type: 'list', schools: SCHOOLS });
  }
  await store.updateWorkspace(WS, (w) => ({ ...w, onboarding: { ...w.onboarding, interview: { ...w.onboarding.interview, phase: 'strategy' } } }));
  return nd({ type: 'delta', text: 'Based on the research, Case Western is the strongest Early Decision fit.' }, { type: 'strategy', strategy: { ed: 'Case Western Reserve University', ea: ['Ohio State University', 'University of Pittsburgh'], reasons: 'ED at Case Western raises your odds most, and its net price fits your budget. Apply EA to Ohio State and Pitt so you have answers by January.' } });
}

async function answer(request) {
  const url = new URL(request.url());
  if (url.origin !== ORIGIN) return null;
  const body = request.postData();
  const parsed = body && body.startsWith('{') ? JSON.parse(body) : null;
  if (url.pathname === '/api/me') return realRoute(meRoute.GET, request);
  if (url.pathname === '/api/workspace') return realRoute(workspaceRoute[request.method()] || workspaceRoute.POST, request);
  if (url.pathname === '/api/applications') return json({ success: true, data: { revision: 0, autocheck: false, apps: [] } });
  if (url.pathname === '/api/applications/catalog') return json([{ id: 'x', name: 'Rice University' }]);
  if (url.pathname === '/api/ai/status') return json({ active: state.aiConnected ? 'codex' : null, codexConnected: state.aiConnected });
  if (url.pathname === '/api/upload') return json({ saved: [{ name: 'transcript.pdf', chars: 1234 }], errors: [] });
  if (url.pathname === '/api/ai/chat') return fakeChat(parsed);
  if (url.pathname === '/api/ai/research-plan') {
    const ws = await store.getWorkspace(WS);
    const steps = parsed.action === 'start' ? ws.colleges.slice(0, 3).map((c) => ({ slug: c.slug, name: c.name, attempt: 1, prompt: `Research ${c.name} [${c.slug}]` })) : [];
    return json({ steps });
  }
  if (url.pathname === '/api/ai/build-plan') return json({ schools: [], rounds: { label: 'Rounds', prompt: 'rounds' }, milestones: { label: 'Milestones', prompt: 'milestones' } });
  if (url.pathname.startsWith('/api/')) return json({ success: false, error: 'Not stubbed' }, 404);
  const file = path.join(root, 'public', path.normalize(url.pathname));
  if (!file.startsWith(path.join(root, 'public')) || !existsSync(file)) return { status: 404, contentType: 'text/plain', body: '' };
  return { status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: readFileSync(file) };
}

// A synthetic student whose required answers are already saved, so finishing is allowed.
await store.updateWorkspace(WS, (w) => ({
  ...w,
  applicant: { ...w.applicant, name: 'Sam Rivera', gpaUnweighted: '3.8', sat: '1410' },
  profile: { ...w.profile, hs: 'Sample High', gradYear: 2027, intended: 'Biology', residency: 'OH', activities: [{ rank: 1, name: 'Science Olympiad', type: 'Academic' }] },
  onboarding: { completed: false, interview: { phase: 'interview', section: 'basics', transcript: [], notes: {}, deep: [1, 2, 3].map((i) => ({ prompt: `q${i}`, answer: `a${i}` })), startedAt: 1 }, listPrefs: { ambition: 'balanced', settings: ['any'], size: 'any', regions: ['any'], notes: '', budget: '30-50', needAid: true, ed: 'maybe' } },
}));

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const errors = [];
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (error) => errors.push(error.message));
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
  const waitText = (s) => page.waitForFunction((s) => document.body.innerText.includes(s), {}, s);
  const click = (label) => page.evaluate((label) => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(label) && !b.disabled);
    if (!el) throw Error('No enabled button ' + label);
    el.click();
  }, label);
  // The newest content must sit above the answer box, never hidden under it.
  const assertVisible = async (selector, label) => {
    await new Promise((r) => setTimeout(r, 250));
    const box = await page.evaluate((sel) => {
      const els = [...document.querySelectorAll(sel)];
      const el = els[els.length - 1];
      const composer = document.querySelector('.oc-composer');
      return el && composer ? { bottom: el.getBoundingClientRect().bottom, top: composer.getBoundingClientRect().top } : null;
    }, selector);
    assert.ok(box, `${label}: element found`);
    assert.ok(box.bottom <= box.top + 1, `${label}: bottom ${Math.round(box.bottom)} is above the answer box at ${Math.round(box.top)}`);
  };
  const shoot = async (name) => {
    for (const [w, h] of [[1440, 900], [1000, 800], [390, 844]]) {
      await page.setViewport({ width: w, height: h });
      await new Promise((r) => setTimeout(r, 150));
      await page.screenshot({ path: path.join(shots, `${name}-${w}.png`), fullPage: true });
    }
    await page.setViewport({ width: 1440, height: 900 });
  };
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCookie({ name: 'forge_session', value: signSession({ sub: 'sub-' + WS, workspaceId: WS, email: 'student@example.com', name: 'Sample' }), url: ORIGIN });

  // No AI: the connect gate, with no way around it.
  await page.goto(ORIGIN + '/hub/index.html');
  await waitText("Let's set up your applications").catch(async (e) => { console.log("BODY:", (await page.evaluate(() => document.body.innerText)).slice(0, 600), errors); throw e; });
  assert.match(await page.evaluate(() => document.body.innerText), /Connect ChatGPT/);
  await shoot('01-connect');

  // Connected: the interview starts by itself and shows tiles.
  state.aiConnected = true;
  await page.reload();
  await waitText("where you'd like to live");
  await page.waitForSelector('.oc-tile');
  await page.setViewport({ width: 1440, height: 560 });
  await assertVisible('.oc-tile', 'last tile on a short window');
  await page.setViewport({ width: 1440, height: 900 });
  await shoot('02-tiles');
  await click('Suburban');
  await click('College town');
  await click('Continue');
  await waitText('Drop your transcript here');
  assert.match(state.chats.at(-1).messages.at(-1).content, /Suburban, College town/, 'Multi-choice answers are sent as text');
  await shoot('03-upload');

  // The answer box starts two lines tall and grows with a long answer.
  const boxHeight = () => page.$eval('.oc-composer-box', (el) => el.getBoundingClientRect().height);
  const before = await boxHeight();
  await page.type('.oc-composer-box', 'I lead the robotics build team and also run a small tutoring group for middle schoolers on weekends. '.repeat(4));
  const grown = await boxHeight();
  assert.ok(before >= 56, `starts at least two lines tall (${before}px)`);
  assert.ok(grown > before + 40 && grown <= 222, `grows with the text, up to a cap (${before} -> ${grown}px)`);
  await page.screenshot({ path: path.join(shots, '03b-composer-1440.png') });
  await page.$eval('.oc-composer-box', (el) => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); });

  // Resume: reload mid-interview and the last question is still answerable.
  await new Promise((r) => setTimeout(r, 300));
  await page.reload();
  await waitText('Drop your transcript here');
  const input = await page.$('.oc-upload input[type=file]');
  const tmpFile = path.join(dataDir, 'transcript.pdf');
  (await import('node:fs')).writeFileSync(tmpFile, 'synthetic transcript');
  await input.uploadFile(tmpFile);

  // The activities list: prefilled from the profile, editable, saved straight to the profile.
  await waitText('List your activities and any awards');
  await assertVisible('.oc-acts-actions', 'activities save button');
  const typeInto = async (label, value) => { const el = await page.$(`[aria-label="${label}"]`); await el.click({ clickCount: 3 }); await el.type(value); };
  await typeInto('Activity 2', 'School newspaper');
  await typeInto('Role in activity 2', 'Co-editor');
  await typeInto('Grades for activity 2', '10-12');
  await typeInto('Hours per week for activity 2', '6');
  await typeInto('Honor 1', 'Regional science fair, 2nd place');
  await typeInto('Level of honor 1', 'Regional');
  await shoot('03c-activities');
  await click('Save my list');
  await waitText('What did you get on the SAT?');
  const afterActs = await store.getWorkspace(WS);
  assert.deepEqual(afterActs.profile.activities.map((a) => a.name), ['Science Olympiad', 'School newspaper'], 'existing activity kept, new one added');
  assert.equal(afterActs.profile.activities[1].role, 'Co-editor');
  assert.equal(afterActs.profile.honors[0].title, 'Regional science fair, 2nd place');
  assert.match(state.chats.at(-1).messages.at(-1).content, /I saved my list: 2 activities and 1 honor/);
  await page.type('.oc-input--number', '1410');
  await click('Send');

  // Typing instead of tapping works too: the list arrives after a typed message.
  await waitText("Here's a first list");
  await assertVisible('.oc-list-actions', 'list approval buttons');
  await shoot('04-list');
  await page.evaluate(() => [...document.querySelectorAll('.oc-school')].find((s) => s.textContent.includes('Rice University')).querySelector('button').click());
  await click('Research these 9');

  await waitText('Verified');
  await waitText('Early Decision');
  await shoot('05-strategy');
  const ws = await store.getWorkspace(WS);
  assert.equal(ws.colleges.length, 9, 'Approved schools are on the list; the dropped one is not');
  assert.ok(!ws.colleges.some((c) => c.name === 'Rice University'));
  await click('Sounds right');
  await page.waitForFunction(() => !document.querySelector('.oc-shell'), { timeout: 15000 });
  const done = await store.getWorkspace(WS);
  assert.equal(done.onboarding.completed, true);
  assert.equal(done.onboarding.interview.phase, 'done');
  assert.equal(done.colleges.length, 9, 'Finishing does not rebuild the approved list');
  // Shortlist shows the sourced research facts.
  const sample = JSON.parse(readFileSync(path.join(root, 'lib/school-research/university-of-miami.json'), 'utf8'));
  await store.updateWorkspace(WS, (w) => ({ ...w, colleges: w.colleges.map((c, i) => (i === 0 ? { ...c, research: sample } : c)) }));
  await page.goto(ORIGIN + '/hub/index.html#shortlist');
  await page.reload();
  await page.waitForSelector('.cf-research summary');
  await page.evaluate(() => { document.querySelector('.cf-research').open = true; document.querySelector('.cf-research').scrollIntoView(); });
  await waitText('Cost of attendance');
  for (const w of [1440, 390]) { await page.setViewport({ width: w, height: 900 }); await new Promise((r) => setTimeout(r, 150)); await page.screenshot({ path: path.join(shots, `06-shortlist-research-${w}.png`) }); }
  assert.deepEqual(errors, [], 'No page errors');
  console.log(`onboarding chat flow passed; screenshots in ${shots}`);
} finally {
  await browser.close();
  rmSync(dataDir, { recursive: true, force: true });
}
