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
const logins = require('../lib/portal-logins.ts');
const inbox = require('../lib/inbox.ts');
const route = require('../app/api/service/inbox/route.ts');

async function isolated(run) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-inbox-'));
  const prev = process.env.CF_DATA_DIR, blob = process.env.BLOB_READ_WRITE_TOKEN, realFetch = globalThis.fetch;
  process.env.CF_DATA_DIR = dir;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    if (String(url) === 'https://api.resend.com/emails') { sent.push(JSON.parse(init.body)); return new Response('{}'); }
    throw new Error(`unexpected fetch ${url}`);
  };
  try { await run(sent); } finally {
    globalThis.fetch = realFetch;
    if (prev === undefined) delete process.env.CF_DATA_DIR; else process.env.CF_DATA_DIR = prev;
    if (blob !== undefined) process.env.BLOB_READ_WRITE_TOKEN = blob;
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

const call = (body, key = 'svc-test-key') =>
  route.POST(new NextRequest('https://forge.test/api/service/inbox', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  }));

async function withAddress() {
  const account = await session.signInAccount({ sub: 'xa_INBOX', email: 'student@example.com', name: 'Stu' }, null);
  const status = await inbox.setInbox(account.workspaceId, { on: true, birthdate: '2008-04-01' });
  return { ws: account.workspaceId, token: status.address.split('@')[0], status };
}

const arrival = (over = {}) => ({
  receivedAt: 1000, collegeId: 'purdue', name: 'Purdue University', portalUrl: 'https://purdue.edu/apply/status',
  username: 'student@example.com', password: 'Generated-Pass-123', state: 'verified', pin: '', link: '', reason: '', ...over,
});

test('the inbox address is on the College Apps mail domain and says whether a birthdate is saved', () => isolated(async () => {
  const { status } = await withAddress();
  assert.match(status.address, /^[a-z0-9]{20}@collegeapps\.n3el\.dev$/);
  assert.equal(status.birthdate, true);
}));

test('service inbox rejects a missing or wrong bearer', () => isolated(async () => {
  const { token } = await withAddress();
  assert.equal((await call({ op: 'lookup', token }, null)).status, 401);
  assert.equal((await call({ op: 'lookup', token }, 'wrong')).status, 401);
}));

test('lookup of an unknown token is 404, a known one gives the email and birthdate', () => isolated(async () => {
  const { token } = await withAddress();
  assert.equal((await call({ op: 'lookup', token: 'abcdefghijklmnopqrst' })).status, 404);
  const ok = await (await call({ op: 'lookup', token })).json();
  assert.deepEqual(ok, { email: 'student@example.com', birthdate: '2008-04-01', allowed: true });
}));

test('the 21st email in a day is not allowed', () => isolated(async () => {
  const { token } = await withAddress();
  let last;
  for (let i = 0; i < 21; i++) last = await (await call({ op: 'lookup', token })).json();
  assert.equal(last.allowed, false);
}));

test('arrival adds the school and saves the login without putting the password in the workspace doc', () => isolated(async (sent) => {
  const { ws, token } = await withAddress();
  const res = await call({ op: 'arrival', token, arrivalId: crypto.randomUUID(), final: true, arrival: arrival() });
  assert.equal(res.status, 200);
  const w = await store.getWorkspace(ws);
  const app = w.tracker.apps.find((a) => a.collegeId === 'purdue');
  assert.ok(app);
  assert.equal(app.login.hasPassword, true);
  assert.doesNotMatch(JSON.stringify(w), /Generated-Pass-123/);
  assert.equal((await logins.readLogins(ws))[app.id].password, 'Generated-Pass-123');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, 'Purdue University: your portal is set up');
  assert.doesNotMatch(JSON.stringify(sent[0]), /Generated-Pass-123/);
}));

test('same arrivalId twice keeps one school and one login, and emails once', () => isolated(async (sent) => {
  const { ws, token } = await withAddress();
  const id = crypto.randomUUID();
  await call({ op: 'arrival', token, arrivalId: id, final: false, arrival: arrival({ state: 'set', reason: 'interrupted' }) });
  await call({ op: 'arrival', token, arrivalId: id, final: true, arrival: arrival() });
  await call({ op: 'arrival', token, arrivalId: id, final: true, arrival: arrival() });
  const w = await store.getWorkspace(ws);
  assert.equal(w.tracker.apps.filter((a) => a.collegeId === 'purdue').length, 1);
  assert.equal(sent.length, 1);
}));

test('not-portal emails the student', () => isolated(async (sent) => {
  const { token } = await withAddress();
  assert.equal((await call({ op: 'not-portal', token, subject: 'Hello' })).status, 200);
  assert.equal(sent[0].subject, "We couldn't find a portal login in that email");
}));

test('turning the inbox off deletes the address', () => isolated(async () => {
  const { ws, token } = await withAddress();
  const off = await inbox.setInbox(ws, { on: false });
  assert.equal(off.address, null);
  assert.equal((await call({ op: 'lookup', token })).status, 404);
}));

test('a new address retires the old one', () => isolated(async () => {
  const { ws, token } = await withAddress();
  const fresh = await inbox.setInbox(ws, { on: true, newAddress: true });
  assert.notEqual(fresh.address.split('@')[0], token);
  assert.equal((await call({ op: 'lookup', token })).status, 404);
  assert.equal(fresh.birthdate, true, 'the birthdate is kept');
}));

test('a forward that ends in todo never replaces a saved login with an unset password', () => isolated(async () => {
  const service = require('../lib/tracker-service.ts');
  const { ws, token } = await withAddress();
  const existing = await service.addApp(ws, { name: 'Purdue University' });
  await service.setLogin(ws, existing.id, { username: 'stu', password: 'Working-Pass-1' });
  const id = crypto.randomUUID();
  await call({ op: 'arrival', token, arrivalId: id, final: false, arrival: arrival({ state: 'set', reason: 'interrupted' }) });
  assert.equal((await logins.readLogins(ws))[existing.id].password, 'Working-Pass-1', 'the placeholder leaves a saved login alone');
  await call({ op: 'arrival', token, arrivalId: id, final: true, arrival: arrival({ state: 'todo', reason: 'PIN expired' }) });
  assert.equal((await logins.readLogins(ws))[existing.id].password, 'Working-Pass-1');
}));

test('a new school whose forward ends in todo is left without a login', () => isolated(async () => {
  const { ws, token } = await withAddress();
  const id = crypto.randomUUID();
  await call({ op: 'arrival', token, arrivalId: id, final: false, arrival: arrival({ state: 'set', reason: 'interrupted' }) });
  await call({ op: 'arrival', token, arrivalId: id, final: true, arrival: arrival({ state: 'todo', reason: 'PIN expired' }) });
  const w = await store.getWorkspace(ws);
  const app = w.tracker.apps.find((a) => a.collegeId === 'purdue');
  assert.equal(app.login, undefined);
  assert.equal((await logins.readLogins(ws))[app.id], undefined);
}));

test('a forward that sets a new password replaces the saved login', () => isolated(async () => {
  const service = require('../lib/tracker-service.ts');
  const { ws, token } = await withAddress();
  const existing = await service.addApp(ws, { name: 'Purdue University' });
  await service.setLogin(ws, existing.id, { username: 'stu', password: 'Old-Pass-1' });
  const id = crypto.randomUUID();
  await call({ op: 'arrival', token, arrivalId: id, final: false, arrival: arrival({ state: 'set', reason: 'interrupted' }) });
  await call({ op: 'arrival', token, arrivalId: id, final: true, arrival: arrival() });
  assert.equal((await logins.readLogins(ws))[existing.id].password, 'Generated-Pass-123');
}));
