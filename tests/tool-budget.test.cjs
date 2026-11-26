const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const B = require('../lib/tool-budget.ts');

test('the final round comes at the time budget or the last round, never without a wrap-up', () => {
  const w = { afterMs: 1000, tools: ['propose_list'], note: 'n' };
  assert.equal(B.isFinalRound(undefined, 0, 13, 14, 999999), false);
  assert.equal(B.isFinalRound(w, 0, 2, 14, 500), false);
  assert.equal(B.isFinalRound(w, 0, 2, 14, 1000), true, 'time is up');
  assert.equal(B.isFinalRound(w, 0, 13, 14, 10), true, 'last round');
});

test('the final round offers only the finishing tools', () => {
  const tools = ['web_search', 'web_fetch', 'propose_list', 'ask_question', 'upsert_college'].map((name) => ({ name, description: '', parameters: {} }));
  assert.deepEqual(B.finalTools(tools, B.ONBOARDING_WRAP_UP).map((t) => t.name), ['propose_list', 'ask_question']);

});

test('a request never runs past the turn deadline', () => {
  const w = B.ONBOARDING_WRAP_UP;
  assert.equal(B.requestTimeout(undefined, 0, 180_000, 999_999), 180_000);
  assert.equal(B.requestTimeout(w, 0, 180_000, 0), 180_000, 'early: the full cap');
  assert.equal(B.requestTimeout(w, 0, 180_000, w.afterMs + 60_000), w.deadlineMs - w.afterMs - 60_000, 'a late final round: what is left');
  assert.ok(w.deadlineMs - w.afterMs >= 180_000, 'a final round starting on time gets three minutes');
  assert.ok(w.deadlineMs < 300_000, 'inside the route limit');
});

test('the final round sends short tool outputs', () => {
  assert.equal(B.trimForFinal('short'), 'short');
  const long = 'x'.repeat(5000);
  const t = B.trimForFinal(long);
  assert.ok(t.length < 1300);
  assert.match(t, /trimmed; you read the full text earlier/);
});
