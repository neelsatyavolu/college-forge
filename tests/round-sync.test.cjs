const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { syncRounds, roundIdOf } = require('../lib/round-sync.ts');

// Synthetic school with three rounds and an aid date.
const DEADLINES = [{ plan: 'ED I', date: '2026-11-01' }, { plan: 'EA', date: '2026-11-15' }, { plan: 'RD', date: '2027-01-05' }, { plan: 'CSS Profile', date: '2026-11-15' }];
const ws = (collegeRound, appRound, appDeadline = '') => ({
  colleges: [{ slug: 'alpha', name: 'Alpha', short: 'Alpha', deadline: collegeRound, deadlines: DEADLINES }],
  tracker: { apps: [{ id: 'a1', slug: 'alpha', name: 'Alpha', round: appRound, deadline: appDeadline, status: 'planning' }] },
});

test('round ids from deadline plans', () => {
  assert.deepEqual(['ED I', 'ED II', 'Early Decision 2', 'EA', 'REA', 'SCEA', 'RD', 'Regular Decision', 'Rolling', 'CSS Profile (ED)', 'Priority'].map(roundIdOf), ['ED', 'ED2', 'ED2', 'EA', 'REA', 'REA', 'RD', 'RD', 'Rolling', '', '']);
});

test('a round picked on the Timeline goes to the application', () => {
  const out = syncRounds(ws('', ''), ws('EA · Nov 15', ''));
  assert.equal(out.tracker.apps[0].round, 'EA');
  assert.equal(out.tracker.apps[0].deadline, '2026-11-15');
});

test('a round picked on Progress goes to the list school, or clears a pick it no longer matches', () => {
  const out = syncRounds(ws('EA · Nov 15', 'EA', '2026-11-15'), ws('EA · Nov 15', 'ED'));
  assert.equal(out.colleges[0].deadline, 'ED I · Nov 1');
  const none = syncRounds(ws('EA · Nov 15', 'EA'), ws('EA · Nov 15', 'Rolling'));
  assert.equal(none.colleges[0].deadline, '');
});

test('nothing changes when neither side moved or they already agree', () => {
  const same = ws('RD · Jan 5', 'RD');
  assert.equal(syncRounds(same, same), same);
  const agree = ws('RD · Jan 5', 'RD');
  assert.equal(syncRounds(ws('EA · Nov 15', 'EA'), agree), agree);
});
