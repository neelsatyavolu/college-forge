const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { applyRounds, workloadSummary } = require('../lib/application-rounds.ts');

const college = (slug, deadlines, extra = {}) => ({ slug, name: slug, short: slug, deadlines, ...extra });
const ws = (colleges) => ({ colleges });
const both = [{ plan: 'EA', date: '2026-11-01' }, { plan: 'RD', date: '2027-01-05' }];

test('sets the chosen round label from the saved deadline and leaves the input untouched', () => {
  const input = ws([college('a', both), college('b', both)]);
  const out = applyRounds(input, [{ slug: 'a', plan: 'RD' }, { slug: 'b', plan: 'ea' }]);
  assert.deepEqual(out.ws.colleges.map((c) => c.deadline), ['RD · Jan 5', 'EA · Nov 1']);
  assert.deepEqual(out.saved, ['a', 'b']);
  assert.equal(input.colleges[0].deadline, undefined);
});

test('rejects rounds the school does not have and unknown schools', () => {
  const out = applyRounds(ws([college('a', both)]), [{ slug: 'a', plan: 'ED I' }, { slug: 'zzz', plan: 'RD' }]);
  assert.deepEqual(out.saved, []);
  assert.equal(out.problems.length, 2);
  assert.match(out.problems[0], /a has no "ED I" deadline \(has: EA, RD\)/);
  assert.match(out.problems[1], /zzz is not on the list/);
});

test('workload summary groups chosen deadlines by half month and counts essay-heavy schools', () => {
  const colleges = [
    college('a', both, { deadline: 'EA · Nov 1', supp: 'Supps required' }),
    college('b', both, { deadline: 'EA · Nov 1', supp: 'No supps' }),
    college('c', both, { deadline: 'RD · Jan 5', supp: 'Supps required' }),
    college('d', both),
  ];
  assert.equal(
    workloadSummary(ws(colleges)),
    'Nov 1–15: 2 schools, 1 with required supplements (a); Jan 1–15: 1 school, 1 with required supplements (c); no round chosen: d'
  );
});
