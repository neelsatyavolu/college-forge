const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.join(__dirname, '..', request.slice(2)) + '.ts' : request, ...args); };
process.env.CF_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-gptzero-'));
delete process.env.BLOB_READ_WRITE_TOKEN;
process.env.SESSION_SECRET = 'synthetic-session-secret-for-gptzero-tests-01234';
process.env.PORTAL_LOGINS_KEY = crypto.randomBytes(32).toString('base64');
const { NextRequest } = require('next/server');
const { signInAccount, signSession, SESSION_COOKIE } = require('../lib/session.ts');
const { updateWorkspace, getWorkspace, publicShareView } = require('../lib/store.ts');
const { readDoc } = require('../lib/doc-store.ts');
const { summarize, MAX_FLAGGED } = require('../lib/gptzero.ts');
const { readGptzero, saveGptzero, withToken } = require('../lib/gptzero-login.ts');
const { openJson } = require('../lib/portal-logins.ts');
const gz = require('../app/api/gptzero/route.ts');
const scan = require('../app/api/gptzero/scan/route.ts');
const workspaceRoute = require('../app/api/workspace/route.ts');

// Synthetic people and credentials only.
const PASSWORD = 'synthetic-gz-password-9f3';
const TOKEN = 'synthetic-gz-token-abc';
let n = 0;
async function student() {
  n += 1;
  const account = await signInAccount({ sub: `test-gz-student-${n}`, email: `gz${n}@forge.invalid`, name: 'Sam Student' }, null);
  return { account, cookie: `${SESSION_COOKIE}=${signSession({ sub: account.sub, workspaceId: account.workspaceId, email: account.email, name: account.name })}` };
}
const call = (handler, url, cookie, body, extra = {}) =>
  handler(new NextRequest(`https://forge.test${url}`, { method: body ? 'POST' : 'GET', headers: { cookie, 'content-type': 'application/json', ...extra }, body: body ? JSON.stringify(body) : undefined }));

const REPORT = {
  scanId: 'scan-1',
  documents: [{
    predicted_class: 'mixed', confidence_category: 'medium', result_message: 'We are moderately confident this text is mixed.', version: '2026-01',
    class_probabilities: { ai: 0.4, mixed: 0.5, human: 0.1 },
    sentences: [{ sentence: 'A flagged sentence.', generated_prob: 0.91, highlight_sentence_for_ai: true }, { sentence: 'A human one.', generated_prob: 0.1, highlight_sentence_for_ai: false }],
  }],
};

/** Stubs fetch; `handler(path, init)` returns [status, body]. Records every call. */
function stubFetch(handler) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    calls.push({ host: u.host, path: u.pathname, init, body: init.body ? JSON.parse(init.body) : null });
    const [status, body] = await handler(u.pathname, init);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}
const signinOk = (path) => (path === '/v3/auth/signin-with-password' ? [200, { session: { access_token: TOKEN, expires_at: Date.now() / 1000 + 3600 } }] : null);
const words = (k) => Array.from({ length: k }, (_, i) => `word${i}`).join(' ');

test('summarize survives malformed responses and caps flagged sentences', () => {
  for (const bad of [null, 'x', 42, [], { documents: 'no' }, { documents: [null] }, { documents: [{ class_probabilities: { ai: 'high' }, sentences: [1, null] }] }]) {
    const s = summarize(bad);
    assert.equal(s.verdict, 'unknown');
    assert.equal(s.ai, 0);
    assert.deepEqual(s.flagged, []);
  }
  const many = { documents: [{ predicted_class: 'AI', class_probabilities: { ai: 7, human: -1 }, sentences: Array.from({ length: 100 }, (_, i) => ({ sentence: `S${i}.`, highlight_sentence_for_ai: true, generated_prob: 0.9 })) }] };
  const s = summarize(many);
  assert.equal(s.verdict, 'ai');
  assert.equal(s.ai, 1, 'probabilities clamp to 0-1');
  assert.equal(s.human, 0);
  assert.equal(s.flagged.length, MAX_FLAGGED);
  assert.equal(s.sentences, 100);
});

test('sealed login round-trips and is bound to its workspace', async () => {
  await saveGptzero('test-gz-ws-a', { email: 'a@forge.invalid', password: PASSWORD });
  assert.equal((await readGptzero('test-gz-ws-a')).password, PASSWORD);
  const sealed = await readDoc('gptzero/test-gz-ws-a.json');
  assert.ok(!JSON.stringify(sealed).includes(PASSWORD), 'stored encrypted');
  assert.throws(() => openJson('forge-gptzero:test-gz-ws-b', sealed), 'another workspace cannot open it');
  assert.throws(() => openJson('forge-logins:test-gz-ws-a', sealed), 'another purpose cannot open it');
});

test('connect checks the login with GPTZero first and saves nothing when it fails', async () => {
  const s = await student();
  const errors = [];
  const realError = console.error;
  console.error = (...args) => errors.push(args.map(String).join(' '));
  const stub = stubFetch(() => [401, { message: 'bad login' }]);
  try {
    assert.equal((await call(gz.POST, '/api/gptzero', '', { action: 'connect', email: 'gz@forge.invalid', password: PASSWORD })).status, 401);
    assert.equal((await call(gz.POST, '/api/gptzero', s.cookie, { action: 'connect', email: 'gz@forge.invalid', password: PASSWORD }, { origin: 'https://evil.xanom.co' })).status, 403);
    assert.equal((await call(gz.POST, '/api/gptzero', s.cookie, { action: 'connect', email: 'nope', password: PASSWORD })).status, 400);
    const bad = await call(gz.POST, '/api/gptzero', s.cookie, { action: 'connect', email: 'gz@forge.invalid', password: PASSWORD });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /didn't accept/);
    assert.equal(await readGptzero(s.account.workspaceId), null);
  } finally {
    stub.restore();
  }
  const ok = stubFetch((p) => signinOk(p));
  try {
    const res = await (await call(gz.POST, '/api/gptzero', s.cookie, { action: 'connect', email: 'Gz@Forge.invalid', password: PASSWORD })).json();
    assert.equal(res.success, true);
    assert.equal(res.data.connected, true);
    assert.ok(!JSON.stringify(res).includes(PASSWORD));
    assert.ok(ok.calls.every((c) => c.host === 'api.gptzero.me'), 'only the fixed host');
    assert.equal(ok.calls[0].init.redirect, 'error');
    const status = await (await call(gz.GET, '/api/gptzero', s.cookie)).json();
    assert.equal(status.data.connected, true);
    assert.match(status.data.email, /^g•+@forge\.invalid$/);
  } finally {
    ok.restore();
    console.error = realError;
  }
  assert.ok(errors.every((line) => !line.includes(PASSWORD) && !line.includes(TOKEN)), 'logs carry no password or token');
});

test('connect is rate-limited', async () => {
  const s = await student();
  const stub = stubFetch(() => [401, {}]);
  try {
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await call(gz.POST, '/api/gptzero', s.cookie, { action: 'connect', email: 'gz@forge.invalid', password: PASSWORD })).status);
    assert.equal(statuses[5], 429);
  } finally {
    stub.restore();
  }
});

test('withToken signs in again once on a refused token, then gives up', async () => {
  const ws = 'test-gz-ws-token';
  await saveGptzero(ws, { email: 'a@forge.invalid', password: PASSWORD, token: 'stale', tokenExp: Date.now() / 1000 + 3600 });
  let signins = 0;
  const stub = stubFetch((p) => (p === '/v3/auth/signin-with-password' ? (signins++, signinOk(p)) : null));
  try {
    const used = [];
    const fn = async (token) => {
      used.push(token);
      if (token === 'stale') { const { GptzeroError } = require('../lib/gptzero.ts'); throw new GptzeroError('login', 401); }
      return 'ok';
    };
    assert.equal(await withToken(ws, fn), 'ok');
    assert.deepEqual(used, ['stale', TOKEN]);
    assert.equal(signins, 1);
    assert.equal((await readGptzero(ws)).token, TOKEN, 'the new token is cached');
    const always = async () => { const { GptzeroError } = require('../lib/gptzero.ts'); throw new GptzeroError('login', 401); };
    await assert.rejects(withToken(ws, always), /login/);
  } finally {
    stub.restore();
  }
});

test('scan reads the saved draft, needs 50 words, saves only totals and stays out of share links', async () => {
  const s = await student();
  const ws = s.account.workspaceId;
  const essayId = (await getWorkspace(ws)).essays.commonApp[0].id;
  assert.equal((await call(scan.POST, '/api/gptzero/scan', '', { essayId })).status, 401);
  assert.equal((await call(scan.POST, '/api/gptzero/scan', s.cookie, { essayId: 'not-an-essay' })).status, 404);
  await updateWorkspace(ws, (w) => ({ ...w, essayDrafts: { ...w.essayDrafts, [essayId]: words(20) } }));
  assert.match((await (await call(scan.POST, '/api/gptzero/scan', s.cookie, { essayId })).json()).error, /at least 50 words/);

  await updateWorkspace(ws, (w) => ({ ...w, essayDrafts: { ...w.essayDrafts, [essayId]: words(120) } }));
  assert.equal((await call(scan.POST, '/api/gptzero/scan', s.cookie, { essayId })).status, 409, 'not connected yet');

  await saveGptzero(ws, { email: 'a@forge.invalid', password: PASSWORD });
  const stub = stubFetch((p) => signinOk(p) || [200, REPORT]);
  try {
    const res = await (await call(scan.POST, '/api/gptzero/scan', s.cookie, { essayId, text: 'ignored client text' })).json();
    assert.equal(res.success, true);
    assert.equal(res.result.verdict, 'mixed');
    assert.deepEqual(res.result.flagged, [{ sentence: 'A flagged sentence.', prob: 0.91 }]);
    const sent = stub.calls.find((c) => c.path === '/v3/ai/text');
    assert.equal(sent.body.document, words(120), 'the server draft, not the request text');
    assert.equal(sent.init.headers.authorization, `Bearer ${TOKEN}`);
    assert.ok(stub.calls.every((c) => c.host === 'api.gptzero.me'));
  } finally {
    stub.restore();
  }
  const saved = (await getWorkspace(ws)).essayAiChecks[essayId];
  assert.equal(saved.verdict, 'mixed');
  assert.equal(saved.words, 120);
  assert.equal(saved.flagged, undefined, 'sentences are not stored');
  assert.equal(publicShareView(await getWorkspace(ws)).essayAiChecks, undefined, 'share links never see checks');

  const quota = stubFetch((p) => signinOk(p) || [429, {}]);
  try {
    assert.equal((await call(scan.POST, '/api/gptzero/scan', s.cookie, { essayId })).status, 429);
  } finally {
    quota.restore();
  }
});

test('a check that finishes after the draft changed is not saved', async () => {
  const s = await student();
  const ws = s.account.workspaceId;
  const essayId = (await getWorkspace(ws)).essays.commonApp[0].id;
  await updateWorkspace(ws, (w) => ({ ...w, essayDrafts: { ...w.essayDrafts, [essayId]: words(80) } }));
  await saveGptzero(ws, { email: 'a@forge.invalid', password: PASSWORD });
  const stub = stubFetch(async (p) => {
    if (p !== '/v3/ai/text') return signinOk(p);
    await updateWorkspace(ws, (w) => ({ ...w, essayDrafts: { ...w.essayDrafts, [essayId]: words(90) } }));
    return [200, REPORT];
  });
  try {
    const res = await (await call(scan.POST, '/api/gptzero/scan', s.cookie, { essayId })).json();
    assert.equal(res.success, true);
    assert.equal(res.result.flaggedCount, 1);
  } finally {
    stub.restore();
  }
  assert.equal((await getWorkspace(ws)).essayAiChecks, undefined, 'the newer draft keeps no stale verdict');
});

test('reset deletes the GPTZero login', async () => {
  const s = await student();
  await saveGptzero(s.account.workspaceId, { email: 'a@forge.invalid', password: PASSWORD });
  const req = new NextRequest('https://forge.test/api/workspace', { method: 'POST', headers: { cookie: s.cookie, 'content-type': 'application/json', origin: 'https://forge.test' }, body: JSON.stringify({ action: 'reset' }) });
  assert.equal((await workspaceRoute.POST(req)).status, 200);
  assert.equal(await readGptzero(s.account.workspaceId), null);
});

test('a refused fresh sign-in marks the saved login failed: no more GPTZero calls until it is re-entered', async () => {
  const s = await student();
  const ws = s.account.workspaceId;
  await saveGptzero(ws, { email: 'a@forge.invalid', password: PASSWORD });
  const stub = stubFetch(() => [401, { message: 'bad login' }]);
  try {
    await assert.rejects(withToken(ws, async () => 'never'), /login/);
    assert.equal(stub.calls.length, 1, 'one sign-in attempt');
    const saved = await readGptzero(ws);
    assert.equal(saved.failed, true);
    assert.equal(saved.password, '', 'the refused password is not kept');
    await assert.rejects(withToken(ws, async () => 'never'), /login/);
    assert.equal(stub.calls.length, 1, 'no automatic retry with the refused login');

    const status = (await (await call(gz.GET, '/api/gptzero', s.cookie)).json()).data;
    assert.equal(status.connected, false);
    assert.equal(status.failed, true);
    assert.match(status.error, /GPTZero sign-in failed/);
    assert.match(status.email, /^a•+@forge\.invalid$/);

    await updateWorkspace(ws, (w) => ({ ...w, essayDrafts: { ...w.essayDrafts, [w.essays.commonApp[0].id]: words(80) } }));
    const essayId = (await getWorkspace(ws)).essays.commonApp[0].id;
    const res = await call(scan.POST, '/api/gptzero/scan', s.cookie, { essayId });
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /GPTZero sign-in failed. Re-enter your login/);
    assert.equal(stub.calls.length, 1, 'the scan does not call GPTZero either');
  } finally {
    stub.restore();
  }
  // Re-entering the login clears the failure.
  const ok = stubFetch((p) => signinOk(p));
  try {
    assert.equal((await (await call(gz.POST, '/api/gptzero', s.cookie, { action: 'connect', email: 'a@forge.invalid', password: PASSWORD })).json()).data.connected, true);
    assert.equal((await readGptzero(ws)).failed, undefined);
  } finally {
    ok.restore();
  }
});

test('a refused sign-in does not mark a login the student re-entered meanwhile', async () => {
  const ws = 'test-gz-ws-race';
  await saveGptzero(ws, { email: 'a@forge.invalid', password: 'old-synthetic-password' });
  const stub = stubFetch(async () => {
    await saveGptzero(ws, { email: 'a@forge.invalid', password: PASSWORD });
    return [401, {}];
  });
  try {
    await assert.rejects(withToken(ws, async () => 'never'), /login/);
  } finally {
    stub.restore();
  }
  const saved = await readGptzero(ws);
  assert.equal(saved.failed, undefined);
  assert.equal(saved.password, PASSWORD);
});

test('workspace ids that change when cleaned are refused, so file name and AAD always match', async () => {
  for (const bad of ['../x', 'a/b', 'ws a', 'x'.repeat(65), '', 'ws\u0000']) {
    await assert.rejects(saveGptzero(bad, { email: 'a@forge.invalid', password: PASSWORD }), /workspace id/);
    await assert.rejects(readGptzero(bad), /workspace id/);
  }
  await saveGptzero('ws_ok-1', { email: 'a@forge.invalid', password: PASSWORD });
  assert.equal((await readGptzero('ws_ok-1')).email, 'a@forge.invalid');
});

test('an oversized GPTZero response is cut off while streaming, not after reading it all', async () => {
  const real = globalThis.fetch;
  let pulled = 0;
  const chunk = new Uint8Array(64 * 1024).fill(32);
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull(controller) { pulled += chunk.length; controller.enqueue(chunk); }, // endless, no content-length
  }), { status: 200 });
  try {
    const { signIn } = require('../lib/gptzero.ts');
    await assert.rejects(signIn('a@forge.invalid', PASSWORD), /upstream/);
    assert.ok(pulled <= 2 * 1024 * 1024 + 4 * chunk.length, `stopped near the cap (read ${pulled} bytes)`);
  } finally {
    globalThis.fetch = real;
  }
});
