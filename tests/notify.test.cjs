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
