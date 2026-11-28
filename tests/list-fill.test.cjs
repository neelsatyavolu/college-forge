const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { emptyWorkspace } = require('../lib/store.ts');
const { fillToRequested } = require('../lib/list-fill.ts');

const ws = (supp, quick, ambition = 'balanced') => {
  const w = emptyWorkspace();
  w.onboarding = { completed: false, listPrefs: { ambition, settings: [], size: 'any', regions: [], notes: '', suppCount: supp, noSuppCount: quick } };
  return w;
};
const pool = ['reach', 'target', 'likely'].flatMap((tier) => Array.from({ length: 10 }, (_, i) => ({ name: `${tier} College ${i}`, slug: `${tier}-college-${i}`, tier, note: 'fits' })));

test('fills to exactly the requested count, closest to the mix, and says Forge added them', () => {
  const start = [{ name: 'Mine', tier: 'reach', reason: 'mine' }];
  const { schools, added } = fillToRequested(ws(15, 5), start, pool);
  assert.equal(schools.length, 20);
  assert.equal(added.length, 19);
  const n = (t) => schools.filter((s) => s.tier === t).length;
  assert.deepEqual([n('reach'), n('target'), n('likely')], [6, 8, 6], 'balanced: 28% / 42% / rest');
  assert.match(schools[1].reason, /^Added by Forge to reach the 20 applications/);
});

test("leaves a long-enough list, a list without counts, and the student's own schools alone", () => {
  const ten = pool.slice(0, 10).map((c) => ({ ...c, reason: 'x' }));
  assert.equal(fillToRequested(ws(8, 2), ten, pool).added.length, 0);
  const noCounts = emptyWorkspace();
  assert.equal(fillToRequested(noCounts, ten.slice(0, 3), pool).added.length, 0);
  const { schools } = fillToRequested(ws(4, 0), [{ name: 'reach College 0', tier: 'reach', reason: 'mine' }], pool);
  assert.equal(schools.filter((s) => s.name === 'reach College 0').length, 1, 'no duplicate of a school already on the list');
});

test('a second UC campus never counts toward the gap', () => {
  const ucPool = [{ name: 'University of California, Davis', slug: 'uc-davis', tier: 'target', note: '' }, ...pool];
  const { schools } = fillToRequested(ws(3, 0), [{ name: 'University of California, Berkeley', tier: 'reach', reason: 'mine' }], ucPool);
  assert.equal(schools.some((s) => /Davis/.test(s.name)), false);
  assert.equal(schools.length, 3);
});
