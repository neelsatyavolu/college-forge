const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  return resolve.call(this, request.startsWith('@/') ? path.join(__dirname, '..', request.slice(2)) + '.ts' : request, ...args);
};

process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough-1234';
process.env.PORTAL_LOGINS_KEY = crypto.randomBytes(32).toString('base64');
process.env.FORGE_SERVICE_KEY = 'svc-test-key';
process.env.RESEND_API_KEY = 're_test';
process.env.FORGE_ORIGIN = 'https://forge.test';

const { NextRequest } = require('next/server');
const session = require('../lib/session.ts');
const store = require('../lib/store.ts');
const service = require('../lib/tracker-service.ts');
const logins = require('../lib/portal-logins.ts');
const setup = require('../lib/portal-setup.ts');
const { runChecks } = require('../lib/portal-check.ts');
const inboxRoute = require('../app/api/service/inbox/route.ts');
const inbox = require('../lib/inbox.ts');

/**
 * Forwarded emails are attacker-controlled: anyone who learns a student's forwarding address can send one.
 * These tests pin that a forged email can't get the master password sent to its host or show its link.
 */

async function isolated(run) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-sec-'));
  const prev = process.env.CF_DATA_DIR, blob = process.env.BLOB_READ_WRITE_TOKEN, realFetch = globalThis.fetch;
  process.env.CF_DATA_DIR = dir;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    if (String(url) === 'https://collegeapps.n3el.dev/api/service/check') {
      calls.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ snapshot: { statusText: 'Submitted', checklist: [], update: '' } }));
    }
    if (String(url) === 'https://api.resend.com/emails') return new Response('{}');
    throw new Error(`unexpected fetch ${url}`);
  };
  try { await run({ calls }); } finally {
    globalThis.fetch = realFetch;
    if (prev === undefined) delete process.env.CF_DATA_DIR; else process.env.CF_DATA_DIR = prev;
    if (blob !== undefined) process.env.BLOB_READ_WRITE_TOKEN = blob;
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

async function withMasterForNew(sub) {
  const account = await session.signInAccount({ sub, email: 'stu@example.com', name: 'Stu' }, null);
  const ws = account.workspaceId;
  await service.setMasterLogin(ws, { username: 'stu@example.com', password: 'Master-Pass-1' });
  const status = await inbox.setInbox(ws, { on: true, useMasterForNew: true });
  return { ws, token: status.address.split('@')[0] };
}
const call = (body) => inboxRoute.POST(new NextRequest('https://forge.test/api/service/inbox', {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer svc-test-key' }, body: JSON.stringify(body),
}));
const lookup = async (token, extra = {}) => (await call({ op: 'lookup', token, ...extra })).json();
const arrival = (over = {}) => ({
  receivedAt: 1000, collegeId: 'purdue', name: 'Purdue University', portalUrl: 'https://apply.purdue.edu/apply/status',
  username: 'stu@example.com', password: 'made-by-forge', state: 'todo', pin: '1234', link: '', reason: 'PIN expired', ...over,
});
const forward = async (token, a) => {
  const id = crypto.randomUUID();
  assert.equal((await call({ op: 'arrival', token, arrivalId: id, final: false, arrival: a })).status, 200);
  assert.equal((await call({ op: 'arrival', token, arrivalId: id, final: true, arrival: a })).status, 200);
};
const appNamed = async (ws, name) => (await store.getWorkspace(ws)).tracker.apps.find((a) => a.name === name);

test('lookup gives no master password for a forged email whose links are off the catalog', () => isolated(async () => {
  const { token } = await withMasterForNew('xa_SEC1');
  assert.equal((await lookup(token)).usePassword, undefined, 'no school named: no master');
  assert.equal((await lookup(token, { collegeId: 'purdue', link: 'https://evil.example/activate' })).usePassword, undefined);
  assert.equal((await lookup(token, { collegeId: 'purdue', portalUrl: 'https://evil.example/apply/status' })).usePassword, undefined);
  assert.equal((await lookup(token, { collegeId: null, portalUrl: 'https://evil.example/apply/status' })).usePassword, undefined, 'a school not in the catalog never gets it');
  assert.equal((await lookup(token, { collegeId: 'not-a-school', link: 'https://evil.example/x' })).usePassword, undefined);
  assert.equal((await lookup(token, { collegeId: 'purdue', link: 'http://apply.purdue.edu/activate' })).usePassword, undefined, 'plain http is refused');
}));

test('lookup still gives the master for a catalog school whose links are its own', () => isolated(async () => {
  const { token } = await withMasterForNew('xa_SEC2');
  const ok = await lookup(token, { collegeId: 'purdue', portalUrl: 'https://apply.purdue.edu/apply/status', link: 'https://apply.purdue.edu/account/activate?x=1' });
  assert.equal(ok.usePassword, 'Master-Pass-1');
  assert.equal((await lookup(token, { collegeId: 'purdue' })).usePassword, 'Master-Pass-1', 'a PIN-only email uses the catalog portal');
}));

test('a forged arrival with an off-catalog link stores no link and shows none', () => isolated(async () => {
  const { ws, token } = await withMasterForNew('xa_SEC3');
  await forward(token, arrival({ link: 'https://evil.example/purdue-activate' }));
  const app = (await store.getWorkspace(ws)).tracker.apps.find((a) => a.collegeId === 'purdue');
  assert.equal((await setup.readSetup(ws, app.id)).link, '');
  const shown = await service.setupDetails(ws, app.id);
  assert.equal(shown.link, '');
  assert.equal(shown.linkChecked, false);
  assert.equal(shown.pin, '1234', 'the rest of the details are kept');
}));

test('a catalog-host arrival keeps its link, marked as checked', () => isolated(async () => {
  const { ws, token } = await withMasterForNew('xa_SEC4');
  await forward(token, arrival({ link: 'https://apply.purdue.edu/account/activate?x=1' }));
  const app = (await store.getWorkspace(ws)).tracker.apps.find((a) => a.collegeId === 'purdue');
  const shown = await service.setupDetails(ws, app.id);
  assert.equal(shown.link, 'https://apply.purdue.edu/account/activate?x=1');
  assert.equal(shown.linkChecked, true);
}));

test('a stored link that no longer matches the school is not shown', () => isolated(async () => {
  const ws = 'sec-5';
  const a = await service.addApp(ws, { name: 'Purdue University' });
  await setup.saveSetup(ws, a.id, { username: 'u', password: 'p', pin: '1', link: 'https://evil.example/x', state: 'todo', reason: '', receivedAt: Date.now() });
  await service.markSetupWaiting(ws, a.id);
  const shown = await service.setupDetails(ws, a.id);
  assert.equal(shown.link, '');
  assert.equal(shown.linkChecked, false);
}));

test('a non-catalog school keeps a link only on the host the student saved', () => isolated(async () => {
  const { ws, token } = await withMasterForNew('xa_SEC6');
  await service.addApp(ws, { name: 'Tiny Slate College', portalUrl: 'https://apply.tiny.edu/apply/status' });
  await forward(token, arrival({ collegeId: null, name: 'Tiny Slate College', portalUrl: 'https://apply.tiny.edu/apply/status', link: 'https://apply.tiny.edu/activate' }));
  const tiny = await appNamed(ws, 'Tiny Slate College');
  assert.equal((await service.setupDetails(ws, tiny.id)).link, 'https://apply.tiny.edu/activate');
  await forward(token, arrival({ collegeId: null, name: 'Tiny Slate College', portalUrl: 'https://apply.tiny.edu/apply/status', link: 'https://evil.example/activate' }));
  assert.equal((await service.setupDetails(ws, tiny.id)).link, '');
}));

test('a school created from an email with an attacker host keeps no link and is never sent the master', () => isolated(async ({ calls }) => {
  const { ws, token } = await withMasterForNew('xa_SEC7');
  // Even if the Worker typed the master, an email-sourced host must not keep it.
  await forward(token, arrival({ collegeId: null, name: 'Evil Prep Academy', portalUrl: 'https://evil.example/apply/status', link: 'https://evil.example/activate', state: 'set', password: 'Master-Pass-1' }));
  const evil = await appNamed(ws, 'Evil Prep Academy');
  assert.ok(evil, 'the school is still added');
  assert.equal(evil.portalFromEmail, true, 'the host is marked as coming from an email');
  assert.notEqual((await logins.readLogins(ws))[evil.id]?.password, 'Master-Pass-1', 'the master is not saved as its own login');
  assert.equal((await logins.readMaster(ws)).appIds[evil.id], undefined, 'the master is not bound');
  const setupNow = await setup.readSetup(ws, evil.id);
  if (setupNow) assert.equal(setupNow.link, '');

  await assert.rejects(service.useMasterFor(ws, evil.id, true), (e) => e instanceof service.TrackerError);
  assert.equal((await logins.readMaster(ws)).appIds[evil.id], undefined);
  await service.applyMasterToAll(ws);
  assert.equal((await logins.readMaster(ws)).appIds[evil.id], undefined, 'bulk apply skips it');

  // Even a master binding that got there somehow (and a Slate platform) is never used by checks.
  await logins.setMasterFor(ws, { [evil.id]: { host: 'evil.example' } });
  await logins.saveLogins(ws, { [evil.id]: null });
  await store.updateWorkspace(ws, (w) => ({ ...w, tracker: { ...w.tracker, lastSlotAt: 0, apps: w.tracker.apps.map((a) => (a.id === evil.id ? { ...a, platform: 'slate', login: { username: 'stu@example.com', hasPassword: true, source: 'master' } } : a)) } }));
  await runChecks(ws, { onlyDue: true });
  await runChecks(ws, { appIds: [evil.id] });
  assert.equal(calls.filter((c) => c.password === 'Master-Pass-1' && /evil\.example/.test(c.url)).length, 0);
}));

test('the student saving the portal link themselves clears the email mark', () => isolated(async () => {
  const { ws, token } = await withMasterForNew('xa_SEC8');
  await forward(token, arrival({ collegeId: null, name: 'Small College', portalUrl: 'https://apply.small.edu/apply/status', link: '' }));
  const small = await appNamed(ws, 'Small College');
  assert.equal(small.portalFromEmail, true);
  await service.updateApp(ws, small.id, { portalUrl: 'https://apply.small.edu/apply/status/' });
  assert.equal((await appNamed(ws, 'Small College')).portalFromEmail, undefined);
  await service.useMasterFor(ws, small.id, true);
  assert.equal((await logins.readMaster(ws)).appIds[small.id].host, 'apply.small.edu');
}));
