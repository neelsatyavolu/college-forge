const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true } }).outputText, file);
const hub = require('../public/hub/deadline-plan.js');
const { timeline } = require('../public/hub/timeline-plan.js');
const server = require('../lib/aid-deadlines.ts');
const { exportCalendar } = require('../lib/export.ts');

// Synthetic student: what they told Forge about aid and merit money.
const prefs = (needAid, meritInterest) => ({ onboarding: { completed: true, listPrefs: needAid === undefined ? {} : { needAid }, interview: meritInterest ? { meritInterest } : undefined } });
const PLANS = ['EA', 'RD', 'FAFSA', 'CSS Profile', 'Financial aid priority', 'Priority aid', 'Merit scholarship', 'Presidential Fellows', 'Honors program'];
const shown = (data) => hub.visibleDeadlines(PLANS.map((plan) => ({ plan, date: '2026-12-01' })), data).map((d) => d.plan);

test('not applying for aid hides need-based aid dates, keeps rounds and scholarships', () => {
  assert.deepEqual(shown(prefs(false)), ['EA', 'RD', 'Merit scholarship', 'Presidential Fellows', 'Honors program']);
});

test('no to merit aid hides scholarship dates; both no leaves only rounds and programs', () => {
  assert.deepEqual(shown(prefs(true, 'no')), ['EA', 'RD', 'FAFSA', 'CSS Profile', 'Financial aid priority', 'Priority aid', 'Honors program']);
  assert.deepEqual(shown(prefs(false, 'no')), ['EA', 'RD', 'Honors program']);
});

test('unknown or unsure keeps every date', () => {
  assert.deepEqual(shown(prefs(undefined)), PLANS);
  assert.deepEqual(shown(prefs(undefined, 'unsure')), PLANS);
  assert.deepEqual(shown({}), PLANS);
  assert.deepEqual(shown(null), PLANS);
});

test('the server filter and the hub filter agree', () => {
  for (const data of [prefs(true), prefs(false), prefs(undefined), prefs(false, 'no'), prefs(true, 'yes'), prefs(undefined, 'no')]) {
    for (const plan of PLANS) assert.equal(server.showsDeadline(plan, data), hub.showsDeadline(plan, data), `${plan} ${JSON.stringify(data.onboarding)}`);
  }
});

test('aid dates name their form', () => {
  const form = (p) => (hub.aidForm(p) || {}).form || null;
  assert.equal(form('FAFSA'), 'FAFSA');
  assert.equal(form('CSS Profile (ED)'), 'CSS Profile');
  assert.equal(form('Financial aid priority'), 'School aid form');
  assert.equal(form('Merit scholarship'), 'Scholarship');
  assert.equal(form('ED I'), null);
  assert.ok(hub.aidForm('FAFSA').note.length > 10);
});

const school = (slug, deadline) => ({
  slug, name: slug, short: slug, deadline,
  deadlines: [{ plan: 'EA', date: '2026-12-01' }, { plan: 'RD', date: '2027-01-05' }, { plan: 'CSS Profile', date: '2026-12-10' }, { plan: 'FAFSA', date: '2027-02-01' }, { plan: 'Merit scholarship', date: '2026-12-15' }],
});
const kinds = (data, apps = []) => timeline(data, apps, '2026-11-27').months.flatMap((m) => m.events).map((e) => [e.sub, e.kind]);

test('timeline gives aid dates their own kind and leaves them out when the student opted out', () => {
  const colleges = [school('alpha', 'EA · Dec 1')];
  assert.deepEqual(kinds({ colleges, ...prefs(true) }), [['EA', 'deadline'], ['CSS Profile', 'aid'], ['Merit scholarship', 'scholarship'], ['RD', 'other-round'], ['FAFSA', 'aid']]);
  assert.deepEqual(kinds({ colleges, ...prefs(false) }), [['EA', 'deadline'], ['Merit scholarship', 'scholarship'], ['RD', 'other-round']]);
  assert.deepEqual(kinds({ colleges, ...prefs(false, 'no') }), [['EA', 'deadline'], ['RD', 'other-round']]);
  const t = timeline({ colleges, ...prefs(true) }, [], '2026-11-27');
  assert.deepEqual(t.aid.map((e) => [e.form.form, e.date]), [['CSS Profile', '2026-12-10'], ['Scholarship', '2026-12-15'], ['FAFSA', '2027-02-01']]);
  assert.deepEqual(timeline({ colleges, ...prefs(false, 'no') }, [], '2026-11-27').aid, []);
});

test('aid dates stay open after the application is sent, and go once it is denied or withdrawn', () => {
  const colleges = [school('alpha', 'EA · Dec 1')];
  const sent = timeline({ colleges, ...prefs(true) }, [{ slug: 'alpha', name: 'alpha', stage: 'waiting' }], '2026-11-27');
  assert.ok(sent.aid.length === 3 && sent.aid.every((e) => !e.done));
  assert.deepEqual(timeline({ colleges, ...prefs(true) }, [{ slug: 'alpha', name: 'alpha', stage: 'closed' }], '2026-11-27').aid, []);
});

test('the calendar feed leaves out aid dates the student opted out of', () => {
  const ws = (p) => ({ colleges: [school('alpha', 'EA · Dec 1')], criticalDates: [], profile: { gradYear: '2027' }, ...p });
  const titles = (p) => exportCalendar(ws(p), '2026-11-27').text.split(/\r?\n/).filter((l) => l.startsWith('SUMMARY:')).map((l) => l.slice(8));
  assert.ok(titles(prefs(true)).some((t) => /FAFSA/.test(t)));
  const off = titles(prefs(false, 'no'));
  assert.equal(off.some((t) => /FAFSA|CSS|scholarship/i.test(t)), false, off.join(' | '));
  assert.ok(off.some((t) => /EA/.test(t)));
});
