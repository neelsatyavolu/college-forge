const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  return resolve.call(this, request.startsWith('@/') ? path.join(__dirname, '..', request.slice(2)) + '.ts' : request, ...args);
};

const { stateAfter, changesBetween, composeEmail } = require('../lib/notify/changes.ts');

const result = (over = {}) => ({
  checkedAt: 1,
  ok: true,
  error: '',
  statusText: 'Awaiting materials',
  update: '',
  checklist: [
    { item: 'Application', status: 'Received', date: '', done: true, optional: false },
    { item: 'Transcript', status: 'Awaiting', date: '', done: false, optional: false },
  ],
  ...over,
});
const ok = (over) => ({ ok: true, result: result(over) });
const fail = (code, message = 'Approve the Duo push.') => ({ ok: false, code, message });
const UNSUB = 'https://forge.xanom.co/api/notify/unsubscribe?t=x';

test('first check sets a baseline without changes', () => {
  assert.deepEqual(changesBetween(null, stateAfter(null, ok())), []);
});

test('first check with a decision already up reports it', () => {
  assert.deepEqual(changesBetween(null, stateAfter(null, ok({ update: 'Reply to Offer of Admission' }))), [{ kind: 'decision' }]);
});

test('update text appearing reports a decision', () => {
  const prev = stateAfter(null, ok());
  const next = stateAfter(prev, ok({ update: 'Reply to Offer of Admission' }));
  assert.ok(changesBetween(prev, next).some((c) => c.kind === 'decision'));
});

test('a decision status reports a decision without naming it', () => {
  const prev = stateAfter(null, ok());
  const next = stateAfter(prev, ok({ statusText: 'Admitted' }));
  const changes = changesBetween(prev, next);
  assert.ok(changes.some((c) => c.kind === 'decision'));
  assert.ok(!changes.some((c) => c.kind === 'status'));
});

test('same update twice reports nothing', () => {
  const a = stateAfter(null, ok({ update: 'View Update' }));
  const b = stateAfter(a, ok({ update: 'View Update' }));
  assert.deepEqual(changesBetween(a, b), []);
});

test('unreachable after ok keeps the old state and reports nothing', () => {
  const a = stateAfter(null, ok());
  const b = stateAfter(a, fail('unreachable'));
  assert.deepEqual(b, a);
  assert.deepEqual(changesBetween(a, b), []);
});

test('mfa after ok reports one problem, a second mfa reports nothing', () => {
  const a = stateAfter(null, ok());
  const b = stateAfter(a, fail('mfa'));
  assert.deepEqual(changesBetween(a, b, 'Approve the Duo push.'), [{ kind: 'problem', code: 'mfa', message: 'Approve the Duo push.' }]);
  const c = stateAfter(b, fail('mfa'));
  assert.deepEqual(changesBetween(b, c, 'Approve the Duo push.'), []);
});

test('a newly received item is reported', () => {
  const a = stateAfter(null, ok());
  const b = stateAfter(a, ok({ checklist: result().checklist.map((c) => ({ ...c, done: true })) }));
  assert.deepEqual(changesBetween(a, b), [{ kind: 'received', items: ['Transcript'] }]);
});

test('email subject and body never contain the portal decision words', () => {
  const email = composeEmail('University at Buffalo', [{ kind: 'decision' }], 'https://forge.xanom.co', { unsubscribeUrl: UNSUB, portalUrl: 'https://ubconnect.buffalo.edu/apply/status' });
  assert.equal(email.subject, 'University at Buffalo: decision received');
  assert.ok(!/admit|accept|congratulations|denied|waitlist/i.test(email.subject + email.text + email.html));
});

test('email includes the unsubscribe link and Forge branding', () => {
  const email = composeEmail('Purdue', [{ kind: 'received', items: ['Transcript'] }], 'https://forge.xanom.co', { unsubscribeUrl: UNSUB });
  assert.ok(email.text.includes(UNSUB));
  assert.ok(email.html.includes(UNSUB.replace(/&/g, '&amp;')));
  assert.ok(email.text.includes('Forge'));
  assert.ok(!/College Apps/.test(email.text + email.html));
});

// ── Sending from checks (Task 2) ─────────────────────────────────────────────

const os = require('node:os');
const crypto = require('node:crypto');
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-that-is-long-enough-1234';
process.env.PORTAL_LOGINS_KEY = process.env.PORTAL_LOGINS_KEY || crypto.randomBytes(32).toString('base64');
process.env.FORGE_SERVICE_KEY = 'svc-test-key';
process.env.RESEND_API_KEY = 're_test';
process.env.FORGE_ORIGIN = 'https://forge.test';

const { NextRequest } = require('next/server');
const session = require('../lib/session.ts');
const service = require('../lib/tracker-service.ts');
const store = require('../lib/store.ts');
const { runChecks } = require('../lib/portal-check.ts');
const send = require('../lib/notify/send.ts');
const unsubRoute = require('../app/api/notify/unsubscribe/route.ts');

async function isolated(run) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-notify-'));
  const prev = process.env.CF_DATA_DIR, blob = process.env.BLOB_READ_WRITE_TOKEN, realFetch = globalThis.fetch;
  process.env.CF_DATA_DIR = dir;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try { await run(dir); } finally {
    globalThis.fetch = realFetch;
    if (prev === undefined) delete process.env.CF_DATA_DIR; else process.env.CF_DATA_DIR = prev;
    if (blob !== undefined) process.env.BLOB_READ_WRITE_TOKEN = blob;
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

/** Stubs the College Apps check service and Resend. `portal.snapshot` / `portal.error` set what the next check sees. */
function stubNetwork() {
  const portal = { snapshot: { statusText: 'Awaiting materials', update: '', checklist: [] }, error: null };
  const sent = [];
  const resend = { fail: false };
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u === 'https://collegeapps.n3el.dev/api/service/check') {
      if (portal.error) return new Response(JSON.stringify(portal.error), { status: 422 });
      return new Response(JSON.stringify({ snapshot: portal.snapshot }), { status: 200 });
    }
    if (u === 'https://api.resend.com/emails') {
      if (resend.fail) return new Response('{}', { status: 500 });
      sent.push(JSON.parse(init.body));
      return new Response('{}', { status: 200 });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  return { portal, sent, resend };
}

async function ownedWorkspace() {
  const account = await session.signInAccount({ sub: 'xa_NOTIFY', email: 'student@example.com', name: 'Stu' }, null);
  const a = await service.addApp(account.workspaceId, { name: 'Purdue University' });
  await service.setLogin(account.workspaceId, a.id, { username: 'u', password: 'p' });
  return { ws: account.workspaceId, id: a.id };
}

test('sweep emails the owner when a decision appears', () => isolated(async () => {
  const net = stubNetwork();
  const { ws, id } = await ownedWorkspace();
  await runChecks(ws, { appIds: [id], notify: true });
  assert.equal(net.sent.length, 0, 'the first check only sets a baseline');
  net.portal.snapshot = { statusText: 'Awaiting materials', update: 'Reply to Offer of Admission', checklist: [] };
  await runChecks(ws, { appIds: [id], notify: true });
  assert.equal(net.sent.length, 1);
  assert.deepEqual(net.sent[0].to, ['student@example.com']);
  assert.equal(net.sent[0].subject, 'Purdue University: decision received');
  assert.equal(net.sent[0].from, 'Forge <no-reply@n3el.dev>');
}));

test('manual check updates baseline without sending', () => isolated(async () => {
  const net = stubNetwork();
  const { ws, id } = await ownedWorkspace();
  await runChecks(ws, { appIds: [id], notify: true });
  net.portal.snapshot = { statusText: '', update: 'View Update', checklist: [] };
  await runChecks(ws, { appIds: [id] });
  await runChecks(ws, { appIds: [id], notify: true });
  assert.equal(net.sent.length, 0);
}));

test('a two-step prompt emails once, not on every check', () => isolated(async () => {
  const net = stubNetwork();
  const { ws, id } = await ownedWorkspace();
  await runChecks(ws, { appIds: [id], notify: true });
  net.portal.error = { error: 'This portal asks for a Duo push.', code: 'mfa' };
  await runChecks(ws, { appIds: [id], notify: true });
  await runChecks(ws, { appIds: [id], notify: true });
  assert.equal(net.sent.length, 1);
  assert.equal(net.sent[0].subject, "We couldn't check your Purdue University portal");
}));

test('a portal outage sends nothing', () => isolated(async () => {
  const net = stubNetwork();
  const { ws, id } = await ownedWorkspace();
  await runChecks(ws, { appIds: [id], notify: true });
  net.portal.error = { error: 'The portal is down.', code: 'unreachable' };
  await runChecks(ws, { appIds: [id], notify: true });
  assert.equal(net.sent.length, 0);
}));

test('skips workspaces without an owner', () => isolated(async () => {
  const net = stubNetwork();
  const ws = 'anon-notify-1';
  const a = await service.addApp(ws, { name: 'Purdue University' });
  await service.setLogin(ws, a.id, { username: 'u', password: 'p' });
  net.portal.snapshot = { statusText: '', update: 'View Update', checklist: [] };
  await runChecks(ws, { appIds: [a.id], notify: true });
  assert.equal(net.sent.length, 0);
}));

test('emails off sends nothing', () => isolated(async () => {
  const net = stubNetwork();
  const { ws, id } = await ownedWorkspace();
  await runChecks(ws, { appIds: [id], notify: true });
  await service.setEmails(ws, false);
  net.portal.snapshot = { statusText: '', update: 'View Update', checklist: [] };
  await runChecks(ws, { appIds: [id], notify: true });
  assert.equal(net.sent.length, 0);
}));

test('failed send keeps the old state so the next sweep retries', () => isolated(async () => {
  const net = stubNetwork();
  const { ws, id } = await ownedWorkspace();
  await runChecks(ws, { appIds: [id], notify: true });
  net.portal.snapshot = { statusText: '', update: 'View Update', checklist: [] };
  net.resend.fail = true;
  await runChecks(ws, { appIds: [id], notify: true });
  net.resend.fail = false;
  await runChecks(ws, { appIds: [id], notify: true });
  assert.equal(net.sent.length, 1);
}));

test('unsubscribe link turns emails off', () => isolated(async () => {
  stubNetwork();
  const { ws } = await ownedWorkspace();
  const t = send.unsubscribeToken(ws);
  const res = await unsubRoute.GET(new NextRequest(`https://forge.test/api/notify/unsubscribe?t=${encodeURIComponent(t)}`));
  assert.equal(res.status, 200);
  assert.equal((await store.getWorkspace(ws)).tracker.emails, false);
}));

test('bad unsubscribe token changes nothing and returns 200', () => isolated(async () => {
  stubNetwork();
  const { ws } = await ownedWorkspace();
  const forged = send.unsubscribeToken(ws).replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
  const res = await unsubRoute.GET(new NextRequest(`https://forge.test/api/notify/unsubscribe?t=${encodeURIComponent(forged)}`));
  assert.equal(res.status, 200);
  assert.equal((await store.getWorkspace(ws)).tracker.emails, true);
}));
