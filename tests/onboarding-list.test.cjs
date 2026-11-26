const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { emptyWorkspace } = require('../lib/store.ts');
const { startInterview } = require('../lib/interview-checklist.ts');
const { applyApprovedList, finishOnboarding } = require('../lib/onboarding-list.ts');

function ws(colleges, draft) {
  const w = emptyWorkspace();
  w.colleges = colleges;
  w.essayDrafts = { 'rice-university-supp-1': 'my draft' };
  w.onboarding = { completed: true, interview: { ...startInterview(1), phase: 'list', listDraft: draft } };
  return w;
}
const rice = { slug: 'rice-university', name: 'Rice University', short: 'Rice', origin: 'user' };
const tulane = { slug: 'tulane-university', name: 'Tulane University', short: 'Tulane', origin: 'user' };
const draft = [
  { name: 'Rice University', tier: 'target', reason: 'r', current: true },
  { name: 'Tulane University', tier: 'likely', reason: 'r', current: true },
  { name: 'Grinnell College', tier: 'target', reason: 'r' },
  { name: 'Made Up U', tier: 'reach', reason: 'r' },
];

test('redo keeps every current school unless the student dropped it, and keeps their drafts', () => {
  const out = applyApprovedList(ws([rice, tulane], draft), ['Rice University', 'Grinnell College'], ['Tulane University'], []);
  assert.deepEqual(out.colleges.map((c) => c.slug), ['rice-university', 'grinnell-college']);
  assert.equal(out.essayDrafts['rice-university-supp-1'], 'my draft');
  assert.equal(out.colleges[0].tier, 'target');
  assert.equal(out.onboarding.interview.phase, 'research');
});

test('a current school the student did not tap keep on is still kept', () => {
  const out = applyApprovedList(ws([rice, tulane], draft), ['Grinnell College'], [], []);
  assert.deepEqual(out.colleges.map((c) => c.slug), ['rice-university', 'tulane-university', 'grinnell-college']);
});

test('only draft schools can be added; formula rows keep their data; likely maps to safety', () => {
  const rows = [{ slug: 'grinnell-college', name: 'Grinnell College', short: 'Grinnell', admit: '9%' }];
  const out = applyApprovedList(ws([], draft), ['Grinnell College', 'Harvard University'], [], rows);
  assert.deepEqual(out.colleges.map((c) => c.slug), ['grinnell-college']);
  assert.equal(out.colleges[0].admit, '9%');
  assert.equal(out.colleges[0].origin, 'agent');
  const likely = applyApprovedList(ws([], [{ name: 'Ohio State', tier: 'likely', reason: 'r' }]), ['Ohio State'], [], []);
  assert.equal(likely.colleges[0].tier, 'safety');
});

test('approving with no draft is an error', () => {
  assert.match(applyApprovedList(ws([], []), ['x'], [], []).error, /no draft/);
});

test('finishing does not touch the list and needs a complete checklist', () => {
  const w = ws([rice], draft);
  assert.match(finishOnboarding(w, 5).error, /basics/);
});

test('the approved list keeps each school\'s price for the student and supplement need', () => {
  const w = ws([], [{ name: 'Grinnell College', tier: 'target', reason: 'r', netPrice: '$21,000 average for your income', supplements: 'no' }]);
  const out = applyApprovedList(w, ['Grinnell College'], [], []);
  assert.equal(out.colleges[0].netPriceForYou, '$21,000 average for your income');
  assert.equal(out.colleges[0].supplementsNeeded, 'no');
});
