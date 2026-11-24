const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const odds = require('../lib/admission-odds.ts');
const { oddsPlan, applicationMaterial } = require('../lib/odds-plan.ts');
const { emptyWorkspace } = require('../lib/store.ts');

const TODAY = '2026-11-19';
function ws(colleges, extra = {}) {
  const w = emptyWorkspace();
  w.applicant.sat = '1500';
  w.colleges = colleges;
  return { ...w, ...extra };
}
const tufts = { slug: 'tufts', name: 'Tufts University', short: 'Tufts', admit: '10%', satRange: '1450-1550', plans: [{ plan: 'ED I', rate: '30%' }], deadline: 'ED I' };

test('round keys read the usual labels', () => {
  assert.equal(odds.roundKey('ED I'), 'ED');
  assert.equal(odds.roundKey('ED II'), 'ED2');
  assert.equal(odds.roundKey('Early Decision 2'), 'ED2');
  assert.equal(odds.roundKey('EA II'), 'EA2');
  assert.equal(odds.roundKey('Early Action'), 'EA');
  assert.equal(odds.roundKey('SCEA'), 'REA');
  assert.equal(odds.roundKey('Regular Decision'), 'RD');
  assert.equal(odds.roundKey('Rolling'), '');
});

test('baseline uses the chosen round rate, else the overall rate', () => {
  assert.deepEqual(odds.baselineFor(tufts, ws([tufts])), { percent: 30, rate: 30, source: 'ED admission rate 30%, SAT inside the middle 50%' });
  const rd = { ...tufts, deadline: 'RD' };
  assert.equal(odds.baselineFor(rd, ws([rd])).percent, 10);
});

test('SAT above the band raises, below lowers, test-optional ignores it', () => {
  const rd = { ...tufts, deadline: 'RD' };
  const high = ws([rd]); high.applicant.sat = '1580';
  assert.equal(odds.baselineFor(rd, high).percent, 13);
  const low = ws([rd]); low.applicant.sat = '1300';
  assert.equal(odds.baselineFor(rd, low).percent, 6);
  const optional = ws([rd]); optional.applicant.sat = '1300'; optional.applicant.satNote = 'Applying test-optional';
  assert.equal(odds.baselineFor(rd, optional).percent, 10);
});

test('UC campuses get no test adjustment', () => {
  const ucla = { slug: 'university-of-california-los-angeles', name: 'UCLA', admit: '9%', satRange: '1300-1500' };
  assert.equal(odds.baselineFor(ucla, ws([ucla])).source, 'Overall admission rate 9%');
});

test('no saved rate means no baseline', () => {
  assert.equal(odds.baselineFor({ slug: 'x', name: 'X' }, ws([])), null);
});

test('an AI estimate is held within three times the starting point', () => {
  const rd = { ...tufts, deadline: 'RD' };
  const r = odds.oddsFromArgs(rd, ws([rd]), { percent: 60, low: 40, high: 80, summary: 'Strong fit.', sources: ['https://tufts.edu/cds'] }, TODAY);
  assert.equal(r.ok, true);
  assert.equal(r.odds.percent, 30);
  assert.equal(r.odds.low, 30);
  assert.equal(r.odds.high, 80);
  assert.match(r.note, /Held to 30% \(from 60%\)/);
  const tiny = odds.oddsFromArgs(rd, ws([rd]), { percent: 0, summary: 'x' }, TODAY);
  assert.equal(tiny.odds.percent, 4);
  assert.deepEqual(odds.boundsFor(4), { min: 2, max: 12 });
});

test('the cap never passes 95% and ranges bracket the estimate', () => {
  assert.deepEqual(odds.boundsFor(80), { min: 27, max: 95 });
  const easy = { slug: 'e', name: 'Easy U', admit: '90%' };
  const r = odds.oddsFromArgs(easy, ws([easy]), { percent: 99, low: 99, high: 10, summary: 'Likely.' }, TODAY);
  assert.deepEqual([r.odds.low, r.odds.percent, r.odds.high], [95, 95, 95]);
});

test('a researched published rate needs a source and replaces the saved one', () => {
  const rd = { ...tufts, deadline: 'RD' };
  const w = ws([rd]);
  assert.equal(odds.oddsFromArgs({ slug: 'x', name: 'X' }, ws([]), { percent: 9, summary: 'x', published_rate: 9 }, TODAY).ok, false);
  const r = odds.oddsFromArgs(rd, w, { percent: 9, summary: 'x', published_rate: 9, published_rate_label: 'RD rate, Class of 2029', sources: ['https://tufts.edu/cds', 'http://insecure.example', 'nope'] }, TODAY);
  assert.equal(r.odds.baseline, 9);
  assert.equal(r.odds.baselineSource, 'RD rate, Class of 2029 9%, SAT inside the middle 50%');
  assert.deepEqual(r.odds.sources, ['https://tufts.edu/cds']);
});

test('an echoed or unsourced rate keeps the saved starting point instead of failing', () => {
  const rd = { ...tufts, deadline: 'RD' };
  const w = ws([rd]);
  const echoed = odds.oddsFromArgs(rd, w, { percent: 9, summary: 'x', published_rate: 10, published_rate_label: 'Rate supplied in request' }, TODAY);
  assert.equal(echoed.ok, true);
  assert.equal(echoed.odds.baselineSource, 'Overall admission rate 10%, SAT inside the middle 50%');
  const echoedWithSource = odds.oddsFromArgs(rd, w, { percent: 9, summary: 'x', published_rate: 10.2, published_rate_label: 'Made up', sources: ['https://tufts.edu/cds'] }, TODAY);
  assert.equal(echoedWithSource.odds.baselineSource, 'Overall admission rate 10%, SAT inside the middle 50%');
  assert.equal(odds.oddsFromArgs(rd, w, { percent: 9, summary: 'x', published_rate: 0, published_rate_label: '', sources: [] }, TODAY).ok, true, 'strict schemas send 0 for none');
  const unsourced = odds.oddsFromArgs(rd, w, { percent: 9, summary: 'x', published_rate: 8 }, TODAY);
  assert.equal(unsourced.ok, true);
  assert.equal(unsourced.odds.baseline, 10);
});

test('a researched rate far from the saved one is refused', () => {
  const rd = { ...tufts, deadline: 'RD' };
  const r = odds.oddsFromArgs(rd, ws([rd]), { percent: 50, summary: 'x', published_rate: 50, sources: ['https://tufts.edu/yield'] }, TODAY);
  assert.equal(r.ok, false);
  assert.match(r.error, /too far from the saved rate/);
});

test('the round comes from the tracker, matched by name, including the portal round', () => {
  const school = { slug: 'tufts', name: 'Tufts University', admit: '10%', plans: [{ plan: 'ED I', rate: '30%' }, { plan: 'ED II', rate: '20%' }] };
  const w = ws([school]);
  w.tracker = { ...w.tracker, apps: [{ id: '1', name: 'Tufts University', status: 'submitted', round: '', portal: { round: 'ED II' } }] };
  assert.equal(odds.chosenRound(school, w), 'ED2');
  assert.equal(odds.baselineFor(school, w).rate, 20);
});

test('a school with no rate is refused until one is researched', () => {
  const r = odds.oddsFromArgs({ slug: 'x', name: 'X College' }, ws([]), { percent: 20, summary: 'x' }, TODAY);
  assert.equal(r.ok, false);
  assert.match(r.error, /published_rate/);
});

test('only recorded or opened decisions count', () => {
  const w = ws([]);
  w.tracker = { ...w.tracker, apps: [
    { id: '1', name: 'Admit U', slug: 'a', status: 'admitted', round: 'EA' },
    { id: '2', name: 'Waiting U', slug: 'b', status: 'complete', round: 'RD' },
    { id: '3', name: 'Hidden U', slug: 'c', status: 'complete', round: 'EA', portal: { ok: true, statusText: 'Admitted', update: 'Decision posted', checklist: [], checkedAt: 1, error: '' } },
  ] };
  assert.deepEqual(odds.knownDecisions(w).map((d) => d.name), ['Admit U']);
});

test('the plan reads the application, then two open schools per step with their bounds', () => {
  const a = { slug: 'a', name: 'A U', short: 'A', admit: '20%' };
  const b = { slug: 'b', name: 'B U', short: 'B' };
  const c = { slug: 'c', name: 'C U', short: 'C', admit: '50%' };
  const done = { slug: 'd', name: 'D U', short: 'D', admit: '5%' };
  const w = ws([a, b, c, done]);
  w.essayDrafts = { 'ca-1': 'My essay text.' };
  w.uploads = [{ name: 'supplements.docx', chars: 5000, uploadedAt: 1 }];
  w.tracker = { ...w.tracker, apps: [{ id: '1', name: 'D U', slug: 'd', status: 'denied', round: 'ED' }] };
  const plan = oddsPlan(w);
  assert.match(plan.read.prompt, /read_application[\s\S]*set_application_read/);
  assert.match(plan.read.prompt, /no names, addresses/);
  assert.ok(plan.read.prompt.length < 8000, 'chat keeps only the first 8,000 characters of a message');
  const material = applicationMaterial(w);
  assert.match(material, /supplements\.docx/);
  assert.match(material, /My essay text\./);
  assert.deepEqual(plan.schools.map((s) => s.label), ['A & B', 'C']);
  assert.deepEqual(plan.schools.map((s) => s.keys), [['a', 'b'], ['c']]);
  assert.match(plan.schools[0].prompt, /A U \[a\], round not chosen: starting point 20% .* held between 7% and 60%/);
  assert.match(plan.schools[0].prompt, /B U \[b\].*no admission rate saved/);
  assert.match(plan.schools[0].prompt, /Decisions so far: D U ED: Denied/);
});

test('a school whose decision was opened on the portal is not estimated', () => {
  const { portalDecisionKey } = require('../lib/tracker.ts');
  const a = { slug: 'a', name: 'A U', short: 'A', admit: '20%' };
  const app = { id: '1', name: 'A U', status: 'complete', round: 'EA', portal: { ok: true, statusText: 'Admitted', update: 'Decision posted', checklist: [], checkedAt: 1, error: '' } };
  const w = ws([a]);
  w.tracker = { ...w.tracker, apps: [app] };
  assert.equal(oddsPlan(w).schools.length, 1, 'unopened: still estimated, nothing revealed');
  w.tracker = { ...w.tracker, apps: [{ ...app, decisionSeen: portalDecisionKey(app) }] };
  assert.equal(oddsPlan(w).schools.length, 0);
});

test('tracked schools not on the shortlist are estimated by tracker id with their Scorecard numbers', () => {
  const listed = { slug: 'a', name: 'A U', short: 'A', admit: '20%' };
  const w = ws([listed]);
  w.tracker = { ...w.tracker, apps: [
    { id: 'x1', name: 'A U', slug: 'a', status: 'submitted', round: 'EA' },
    { id: 'x2', name: 'B College', status: 'submitted', round: 'RD' },
    { id: 'x3', name: 'C Institute', status: 'admitted', round: 'EA' },
  ] };
  w.schoolStats = { x2: { admit: '12%', satRange: '1400-1500', checkedAt: 'now' } };
  assert.deepEqual(odds.oddsTargets(w).map((t) => t.key), ['a', 'app:x2', 'app:x3']);
  const plan = oddsPlan(w);
  assert.deepEqual(plan.schools.flatMap((s) => s.keys), ['a', 'app:x2']);
  assert.match(plan.schools[0].prompt, /B College \[app:x2\], RD: starting point 15% \(Overall admission rate 12%, SAT above the middle 50%\)/);
});

test('the profile fingerprint changes with the scores the estimate used, not with unrelated edits', () => {
  const base = ws([tufts]);
  const fp = odds.profileFingerprint(base);
  assert.match(fp, /^[0-9a-f]{8}$/);
  assert.equal(odds.profileFingerprint(ws([tufts])), fp, 'same profile, same fingerprint');
  const newSat = ws([tufts]); newSat.applicant.sat = '1520';
  assert.notEqual(odds.profileFingerprint(newSat), fp);
  const act = ws([tufts]); act.profile.testing = { ...act.profile.testing, act: '34' };
  assert.notEqual(odds.profileFingerprint(act), fp);
  const optional = ws([tufts]); optional.applicant.satNote = 'Test optional';
  assert.notEqual(odds.profileFingerprint(optional), fp);
  const unrelated = ws([tufts, { slug: 'x', name: 'X' }]);
  unrelated.applicant.name = 'Someone else';
  unrelated.profile.counselor = 'A counselor';
  unrelated.onboarding = { ...unrelated.onboarding, listPrefs: { ambition: 'ambitious', settings: [], size: 'any', regions: [], notes: '' } };
  assert.equal(odds.profileFingerprint(unrelated), fp, 'name, counselor, list and list balance do not change it');
  const caseOnly = ws([tufts]); caseOnly.profile.residency = 'ca';
  const upper = ws([tufts]); upper.profile.residency = 'CA';
  assert.equal(odds.profileFingerprint(caseOnly), odds.profileFingerprint(upper));
});

test('a saved estimate records the profile it was made from', () => {
  const rd = { ...tufts, deadline: 'RD' };
  const w = ws([rd]);
  const r = odds.oddsFromArgs(rd, w, { percent: 10, summary: 'Fits.', sources: [] }, TODAY);
  assert.equal(r.ok, true);
  assert.equal(r.odds.profileFingerprint, odds.profileFingerprint(w));
  const read = odds.readFromArgs({ summary: 'Strong reader.' }, TODAY, w);
  assert.equal(read.profileFingerprint, odds.profileFingerprint(w));
});
