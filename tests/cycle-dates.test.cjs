const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { emptyWorkspace } = require('../lib/store.ts');
const { withStudentCycleDates, cycleShift, shiftIso } = require('../lib/cycle-dates.ts');
const { decisionDateOf } = require('../lib/tracker.ts');
const { cycleGuide } = require('../lib/application-cycle.ts');

const ws = (gradYear) => {
  const w = emptyWorkspace();
  w.profile.gradYear = gradYear;
  w.colleges = [{ slug: 'emory', name: 'Emory', deadlines: [{ plan: 'ED I', date: '2026-11-01' }, { plan: 'RD', date: '2027-01-01' }, { plan: 'Old', date: '2025-11-01' }] }];
  w.criticalDates = [{ date: '2026-12-01', label: 'Draft essays', detail: '' }, { date: '2026-12-02', label: 'My own', detail: '', source: 'student' }];
  w.tracker = { ...w.tracker, apps: [{ id: 'a', name: 'Emory', status: 'in_progress', round: 'ED', deadline: '2026-11-01', decisionDate: '', notes: '', followUps: [], createdAt: 1, updatedAt: 1 }] };
  return w;
};

test('a class of 2028 student gets every current-cycle date a year on, marked as moved', () => {
  const out = withStudentCycleDates(ws(2028));
  assert.equal(cycleShift(out), 1);
  assert.deepEqual(out.colleges[0].deadlines, [
    { plan: 'ED I', date: '2027-11-01', projectedFrom: '2026-11-01' },
    { plan: 'RD', date: '2028-01-01', projectedFrom: '2027-01-01' },
    { plan: 'Old', date: '2025-11-01' },
  ]);
  assert.equal(out.criticalDates[0].date, '2027-12-01');
  assert.equal(out.criticalDates[1].date, '2026-12-02', "the student's own date stays as they wrote it");
  assert.equal(out.tracker.apps[0].deadline, '2027-11-01');
  assert.equal(withStudentCycleDates(out), out, 'idempotent: reading again changes nothing');
});

test('switching back to class of 2027 restores the published dates; this year’s seniors are untouched', () => {
  const moved = withStudentCycleDates(ws(2028));
  const back = withStudentCycleDates({ ...moved, profile: { ...moved.profile, gradYear: 2027 } });
  assert.deepEqual(back.colleges[0].deadlines.map((d) => d.date), ['2026-11-01', '2027-01-01', '2025-11-01']);
  assert.equal(back.colleges[0].deadlines.some((d) => d.projectedFrom), false);
  assert.equal(back.tracker.apps[0].deadline, '2026-11-01');
  const senior = ws(2027);
  assert.equal(withStudentCycleDates(senior), senior);
});

test('Feb 29 lands on Feb 28 in a non-leap year', () => {
  assert.equal(shiftIso('2028-02-29', 1), '2029-02-28');
});

test('estimated decision dates move with the cycle', () => {
  const app = { id: 'a', name: 'X', status: 'submitted', round: 'RD', deadline: '', decisionDate: '', notes: '', followUps: [], createdAt: 1, updatedAt: 1 };
  const now = decisionDateOf(app, '2026-11-27', 0);
  const later = decisionDateOf(app, '2026-11-27', 1);
  if (now && later) assert.equal(Number(later.date.slice(0, 4)) - Number(now.date.slice(0, 4)), 1);
});

test('the prompt tells a future-cycle student ED I is open, and a senior that it may have passed', () => {
  assert.match(cycleGuide(ws(2028)), /including ED I.*is open/);
  assert.match(cycleGuide(ws(2027)), /may have passed/);
});
