const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const ts = require('typescript');
const Module = require('node:module');
const path = require('node:path');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.join(__dirname, '..', request.slice(2)) + '.ts' : request, ...args); };
const { emptyWorkspace } = require('../lib/store.ts');
const R = require('../lib/research-runner.ts');
const V = require('../lib/token-vault.ts');

const ws = (slugs) => {
  const w = emptyWorkspace();
  w.colleges = slugs.map((slug) => ({ slug, name: slug }));
  w.onboarding = { ...w.onboarding, interview: { phase: 'research', section: 'deep', transcript: [], notes: {}, deep: [], startedAt: 0 } };
  return w;
};

test('a run starts six workers and two workers never take the same school', () => {
  const { ws: w, run, start } = R.beginRun(ws(['a', 'b']), 1000);
  assert.equal(start.length, R.WORKERS);
  const one = R.claimNext(w, run.runId, 0, 2000);
  const two = R.claimNext(one.ws, run.runId, 1, 2000);
  const three = R.claimNext(two.ws, run.runId, 2, 2000);
  assert.deepEqual([one.slug, two.slug, three.slug], ['a', 'b', null]);
  assert.equal(three.ws.onboarding.interview.researchRun.live.a, 'searching');
});

test('an expired claim is picked up again; a stale run id claims nothing', () => {
  const { ws: w, run } = R.beginRun(ws(['a']), 0);
  const first = R.claimNext(w, run.runId, 0, 1000);
  assert.equal(R.claimNext(first.ws, run.runId, 1, 1000 + 300_000).slug, 'a');
  assert.equal(R.claimNext(w, 'other-run', 0, 1000).slug, null);
});

test('finishing every school finishes the run; a failed step stays queued', () => {
  const { ws: w, run } = R.beginRun(ws(['a', 'b']), 0);
  let x = R.claimNext(w, run.runId, 0, 10).ws;
  x = R.claimNext(x, run.runId, 1, 10).ws;
  x = R.finishStep(x, run.runId, 'b', false);
  assert.equal(x.onboarding.interview.researchRun.live.b, 'queued');
  assert.equal(R.maybeFinish(x, run.runId, 20).finished, false);
  x = { ...x, colleges: x.colleges.map((c) => ({ ...c, research: { complete: true, facts: [] } })) };
  x = R.finishStep(x, run.runId, 'a', true);
  const done = R.maybeFinish(x, run.runId, 20);
  assert.equal(done.finished, true);
  assert.ok(done.ws.onboarding.interview.researchRun.finishedAt);
});

test('starting again keeps the run and restarts only silent workers', () => {
  const { ws: w, run } = R.beginRun(ws(['a']), 0);
  const busy = R.claimNext(w, run.runId, 3, R.STALE_WORKER_MS).ws;
  const again = R.beginRun(busy, R.STALE_WORKER_MS + 1000);
  assert.equal(again.run.runId, run.runId);
  assert.deepEqual(again.start, [0, 1, 2, 4, 5]);
});

test('the vault encrypts with AES-GCM and rejects a wrong key or tampering', () => {
  const k = crypto.randomBytes(32);
  const entry = { provider: 'codex', tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: 5 }, savedAt: 1, createdAt: 1, binding: 'b' };
  const sealed = V.sealVault(entry, k);
  assert.doesNotMatch(sealed, /refreshToken|"r"/);
  assert.deepEqual(V.openVault(sealed, k), entry);
  assert.equal(V.openVault(sealed, crypto.randomBytes(32)), null);
  const box = JSON.parse(sealed);
  box.body = Buffer.from('x' + Buffer.from(box.body, 'base64').toString('latin1')).toString('base64');
  assert.equal(V.openVault(JSON.stringify(box), k), null);
});

test('hand-offs are signed per workspace, run and worker', () => {
  const k = crypto.randomBytes(32);
  const sig = V.signRun('ws1', 'run1', 2, k);
  assert.equal(V.verifyRun('ws1', 'run1', 2, sig, k), true);
  assert.equal(V.verifyRun('ws1', 'run1', 3, sig, k), false);
  assert.equal(V.verifyRun('ws2', 'run1', 2, sig, k), false);
  assert.equal(V.verifyRun('ws1', 'run1', 2, 'nope', k), false);
});

test('a school that was just tried waits behind ones not tried yet', () => {
  const w0 = ws(['a', 'b']);
  w0.colleges[0] = { ...w0.colleges[0], research: { attempts: 1, complete: false, facts: [] } };
  const { ws: w, run } = R.beginRun(w0, 0);
  assert.equal(R.claimNext(w, run.runId, 0, 10).slug, 'b');
});

test('a stored sign-in syncs only with the browser that started research', () => {
  const cookie = V.newBinding();
  const entry = { provider: 'grok', tokens: {}, savedAt: 0, createdAt: 0, binding: V.bindingHash(cookie) };
  assert.equal(V.boundTo(entry, cookie), true);
  assert.equal(V.boundTo(entry, V.newBinding()), false);
  assert.equal(V.boundTo(entry, undefined), false);
});

test('signing out stops the run so the page stops waiting', () => {
  const { ws: w, run } = R.beginRun(ws(['a']), 0);
  const stopped = R.stopRun(R.claimNext(w, run.runId, 0, 10).ws, null, R.SIGN_IN_GONE, 20);
  const r = stopped.onboarding.interview.researchRun;
  assert.equal(r.finishedAt, 20);
  assert.deepEqual(r.claims, {});
  assert.equal(R.isRunActive(r), false);
});
