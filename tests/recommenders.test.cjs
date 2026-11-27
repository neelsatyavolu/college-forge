const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ts = require('typescript');
const Module = require('node:module');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.join(__dirname, '..', request.slice(2)) + '.ts' : request, ...args); };
process.env.CF_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-recommenders-'));
delete process.env.BLOB_READ_WRITE_TOKEN;

const { receiptFor, letterTasks, isLetterItem, lastName } = require('../public/hub/recommenders.js');
const { emptyWorkspace, getWorkspace, updateWorkspace } = require('../lib/store.ts');
const { applyWorkspacePatch, checkWorkspacePatch } = require('../lib/workspace-patch.ts');
const { parentView } = require('../lib/parent-view.ts');
const { draftRecRequest } = require('../lib/recommenders.ts');
const { makeHubTools } = require('../lib/hub-tools.ts');

// Synthetic people and schools only.
const item = (text, done) => ({ item: text, status: done ? 'Received' : 'Not received', date: '', done, optional: false });
const app = (id, name, deadline, checklist) => ({ id, name, deadline, portal: checklist ? { ok: true, checklist } : null });
const tracker = {
  apps: [
    app('a1', 'Rice University', '2027-01-04', [item('Teacher Evaluation - Ms. Lee', true), item('Teacher Evaluation - Mr. Park', false), item('Secondary School Report', true), item('Mid-Year Report', false)]),
    app('a2', 'Tufts University', '2027-01-04', [item('Teacher Evaluation', true), item('Teacher Evaluation', false), item('School Report', false)]),
    app('a3', 'MIT', '2027-01-05', [item('Application form', true)]),
    app('a4', 'Emory University', '2026-12-01', null),
  ],
};
const lee = { id: 'r1', name: 'Ms. Lee', type: 'teacher', status: 'asked', schools: ['a1', 'a2', 'a3', 'a4', 'gone'] };
const park = { id: 'r2', name: 'Mr. Park', type: 'teacher', status: 'asked', schools: ['a1'] };
const counselor = { id: 'r3', name: 'Dr. Rivera', type: 'counselor', status: 'submitted', schools: ['a1', 'a2'] };
const byApp = (rs) => Object.fromEntries(rs.map((r) => [r.appId, r]));

test('recognizes letter items on real checklists and not other items', () => {
  for (const t of ['Teacher Evaluation', 'Secondary School Report', 'Counselor Recommendation', 'School Report', 'Letter of Recommendation', 'Letters of Rec (2)', 'Recommendation Letter 1']) assert.ok(isLetterItem(t), t);
  for (const t of ['Mid-Year Report', 'Application form', 'Final School Transcript', 'CSS Profile', 'SAT Scores']) assert.ok(!isLetterItem(t), t);
});

test('receiptFor matches by last name, else counts by type, and skips unknown apps', () => {
  const r = byApp(receiptFor(lee, tracker, [lee, park, counselor]));
  assert.deepEqual(Object.keys(r).sort(), ['a1', 'a2', 'a3', 'a4'], 'unknown app id is skipped');
  assert.equal(r.a1.state, 'received');
  assert.equal(r.a1.matched, 'name');
  assert.equal(r.a2.state, 'unclear', 'one of two unnamed teacher letters in: whose is unknown');
  assert.equal(r.a2.matched, 'type');
  assert.deepEqual([r.a2.done, r.a2.total], [1, 2]);
  assert.equal(r.a3.state, 'no portal data', 'portal lists no letter items');
  assert.equal(r.a4.state, 'no portal data', 'never checked');
  assert.equal(byApp(receiptFor(park, tracker, [lee, park]))['a1'].state, 'missing');
  const c = byApp(receiptFor(counselor, tracker, [lee, park, counselor]));
  assert.equal(c.a1.state, 'received', 'school report counts for the counselor');
  assert.equal(c.a2.state, 'missing');
});

test('no false name matches', () => {
  assert.equal(lastName('Ms. Lee'), 'lee');
  assert.equal(lastName('Dr.'), '');
  const leeds = { apps: [app('x', 'Bates', '2027-01-01', [item('Teacher Evaluation - Leeds', true), item('Teacher Evaluation - Smith', false)])] };
  const r = receiptFor({ id: 'q', name: 'Ms. Lee', type: 'teacher', schools: ['x'] }, leeds, [])[0];
  assert.equal(r.matched, 'type', '"Lee" does not match "Leeds"');
  // Another recommender's named item is not counted for this one.
  const named = { apps: [app('y', 'Colby', '2027-01-01', [item('Teacher Evaluation - Park', true), item('Teacher Evaluation', false)])] };
  const lr = receiptFor(lee, { apps: named.apps }, [lee, park]);
  assert.equal(lr.length, 0, 'lee is not assigned to y');
  const lr2 = receiptFor({ ...lee, schools: ['y'] }, named, [lee, park])[0];
  assert.equal(lr2.state, 'missing');
  assert.equal(lr2.total, 1, "Park's item is excluded from Lee's count");
});

test('letterTasks: ask 4 weeks early, nudge within 10 days, thank once received', () => {
  const notAsked = { id: 'n', name: 'Mr. Kim', type: 'teacher', status: 'not_asked', schools: ['a1', 'a4'] };
  const tasks = letterTasks([notAsked, lee, counselor], tracker, '2026-12-28');
  const ask = tasks.find((t) => t.kind === 'ask');
  assert.equal(ask.due, '2026-11-03', 'four weeks before Emory on Dec 1');
  assert.equal(ask.overdue, true);
  const nudges = tasks.filter((t) => t.kind === 'nudge');
  assert.deepEqual(nudges.map((t) => `${t.recId}:${t.appId}`).sort(), ['r3:a2'], 'no nudge from an unclear count');
  assert.equal(letterTasks([lee], tracker, '2026-12-01').filter((t) => t.kind === 'nudge').length, 0, 'not within 10 days yet');
  assert.ok(!tasks.some((t) => t.kind === 'thank'), 'no thank-you while a school is missing');

  const done = { id: 'd', name: 'Ms. Lee', type: 'teacher', status: 'asked', schools: ['a1'] };
  assert.equal(letterTasks([done], tracker, '2026-12-28').filter((t) => t.kind === 'thank').length, 1);
  assert.equal(letterTasks([{ ...done, thankYouSent: true }], tracker, '2026-12-28').length, 0);
  assert.equal(letterTasks([{ ...done, status: 'waived' }], tracker, '2026-12-28').length, 0);
  assert.equal(letterTasks([{ id: 's', name: 'Coach Ortiz', type: 'other', status: 'submitted' }], tracker, '2026-12-28')[0].kind, 'thank', 'submitted with no schools assigned');
});

test('ambiguous slots, optional slots, roles and closed apps', () => {
  const one = { apps: [app('s', 'Bates', '2027-01-01', [item('Teacher Evaluation', true), { ...item('Optional Teacher Evaluation', false), optional: true }, item('School Reports', true)])] };
  const t1 = { id: 't1', name: 'Ms. Lee', type: 'teacher', status: 'asked', schools: ['s'] };
  const t2 = { id: 't2', name: 'Mr. Park', type: 'teacher', status: 'asked', schools: ['s'] };
  assert.equal(receiptFor(t1, one, [t1])[0].state, 'received', 'empty optional slot is not missing');
  assert.equal(receiptFor(t1, one, [t1, t2])[0].state, 'unclear', 'one unnamed letter cannot credit two teachers');
  assert.equal(letterTasks([t1, t2], one, '2026-12-28').filter((t) => t.kind === 'thank').length, 0);
  const coach = { id: 'c', name: 'Coach Ortiz', type: 'other', status: 'asked', schools: ['s'] };
  assert.equal(receiptFor(coach, one, [coach])[0].state, 'no portal data', "a School Report isn't the coach's letter");
  const counselor = { id: 'k', name: 'Dr. Rivera', type: 'counselor', status: 'asked', schools: ['s'] };
  assert.equal(receiptFor(counselor, one, [counselor])[0].state, 'received', 'plural School Reports is the counselor');
  const closed = { apps: [{ ...app('d', 'Colby', '2026-12-30', [item('Teacher Evaluation', false)]), stage: 'denied' }] };
  assert.equal(letterTasks([{ ...t1, schools: ['d'] }], closed, '2026-12-28').length, 0, 'no nudges for a closed application');
});

const wsWithApps = () => {
  const ws = emptyWorkspace();
  return { ...ws, tracker: { ...ws.tracker, apps: [{ id: 'a1', name: 'Rice University', deadline: '2027-01-04' }, { id: 'a2', name: 'Tufts University', deadline: '' }] } };
};

test('patch validation: bad email and dates refused, unknown app ids dropped, empty clears', () => {
  assert.equal(checkWorkspacePatch({ recommendation: { name: 'X', email: 'not-an-email' } }).ok, false);
  assert.equal(checkWorkspacePatch({ recommendation: { name: 'X', email: 'a@b.co'.padStart(260, 'a') } }).ok, false);
  assert.equal(checkWorkspacePatch({ recommendation: { name: 'X', askedAt: '2026-13-40' } }).ok, false);
  assert.equal(checkWorkspacePatch({ recommendation: { name: 'X', schools: 'a1' } }).ok, false);
  assert.equal(checkWorkspacePatch({ recommendation: { name: 'X', thankYouSent: 'yes' } }).ok, false);
  assert.equal(checkWorkspacePatch({ recommendation: { name: 'X', bragSheet: 'x'.repeat(4001) } }).ok, false);
  assert.equal(checkWorkspacePatch({ recommendation: { name: 'X', email: ' t@school.org ', askedAt: '2026-10-01', schools: ['a1'] } }).ok, true);
  assert.equal(checkWorkspacePatch({ recommendations: [null] }).ok, false);
  assert.equal(checkWorkspacePatch({ recommendations: [{ name: 'X', email: 'bad' }] }).ok, false);

  let ws = applyWorkspacePatch(wsWithApps(), { recommendation: { id: 'r1', name: 'Ms. Lee', email: ' t@school.org ', askedAt: '2026-10-01', schools: ['a1', 'nope', 'a1', 'a2'], thankYouSent: false, bragSheet: 'Robotics' } });
  let r = ws.recommendations[0];
  assert.equal(r.email, 't@school.org');
  assert.deepEqual(r.schools, ['a1', 'a2']);
  assert.equal(r.askedAt, '2026-10-01');
  ws = applyWorkspacePatch(ws, { recommendation: { id: 'r1', status: 'submitted' } });
  r = ws.recommendations[0];
  assert.equal(r.email, 't@school.org', 'fields not in the patch are kept');
  assert.equal(r.status, 'submitted');
  ws = applyWorkspacePatch(ws, { recommendation: { id: 'r1', email: '', bragSheet: '', askedAt: '' } });
  r = ws.recommendations[0];
  assert.equal(r.email, undefined);
  assert.equal(r.bragSheet, undefined);
  assert.equal(r.askedAt, undefined);
  ws = applyWorkspacePatch(ws, { recommendations: [{ id: 'r9', name: 'Mr. Park', type: 'teacher', status: 'asked', schools: ['a2', 'ghost'], email: 'bad' }] });
  assert.deepEqual(ws.recommendations[0].schools, ['a2']);
  assert.equal(ws.recommendations[0].email, undefined);
});

test('parent view strips notes, email and brag sheet unless full', () => {
  const ws = applyWorkspacePatch(wsWithApps(), { recommendation: { id: 'r1', name: 'Ms. Lee', email: 't@school.org', notes: 'private', bragSheet: 'private brag', schools: ['a1'], askedAt: '2026-10-01' } });
  const std = parentView(ws, 'standard').recommendations[0];
  assert.equal(std.email, undefined);
  assert.equal(std.notes, undefined);
  assert.equal(std.bragSheet, undefined);
  assert.deepEqual(std.schools, ['a1']);
  assert.equal(std.askedAt, '2026-10-01');
  const full = parentView(ws, 'full').recommendations[0];
  assert.equal(full.email, 't@school.org');
  assert.equal(full.bragSheet, 'private brag');
});

test('draftRecRequest uses saved facts and placeholders, never sends', () => {
  const base = wsWithApps();
  const ws = { ...base, applicant: { ...base.applicant, name: 'Sam Student' }, profile: { ...base.profile, intended: 'Biology', activities: [{ rank: 1, name: 'Science Olympiad', type: 'Academic', role: 'Captain', hpw: '6' }] } };
  const text = draftRecRequest(ws, { id: 'r1', name: 'Ms. Lee', type: 'teacher', subject: 'AP Chemistry', status: 'not_asked', schools: ['a1', 'a2'] });
  assert.match(text, /Dear Ms\. Lee/);
  assert.match(text, /AP Chemistry/);
  assert.match(text, /study Biology/);
  assert.match(text, /Rice University, Tufts University/);
  assert.match(text, /earliest deadline is 2027-01-04/);
  assert.match(text, /Science Olympiad, Captain, 6 hrs\/week/);
  assert.match(text, /\nSam$/m);
});

test('copilot draft_rec_request and set_recommendations keep the new fields valid', async () => {
  const h = makeHubTools('rec-tools');
  const added = JSON.parse(await h.executeTool('add_application', JSON.stringify({ school: 'Rice University', status: 'in_progress', round: 'RD' })));
  const out = await h.executeTool('set_recommendations', JSON.stringify({ recommendations: [{ name: 'Ms. Lee', type: 'teacher', subject: 'Chemistry', schools: [added.id, 'made-up'], email: 'nope' }] }));
  assert.match(out, /Saved 1/);
  const rec = (await getWorkspace('rec-tools')).recommendations[0];
  assert.deepEqual(rec.schools, [added.id]);
  assert.equal(rec.email, undefined);
  await h.executeTool('set_recommendations', JSON.stringify({ recommendations: [{ id: rec.id, name: 'Ms. Lee', type: 'teacher', status: 'submitted' }] }));
  const again = (await getWorkspace('rec-tools')).recommendations[0];
  assert.equal(again.status, 'submitted');
  assert.deepEqual(again.schools, [added.id], 'fields the model left out are kept');
  assert.match(await h.executeTool('set_recommendations', JSON.stringify({ recommendations: [null] })), /needs a name/);
  assert.match(await h.executeTool('draft_rec_request', JSON.stringify({ recommender: 'lee' })), /Dear Ms\. Lee[\s\S]*Brag sheet outline/);
  assert.match(await h.executeTool('draft_rec_request', JSON.stringify({ recommender: 'nobody' })), /No recommender/);
});

test('the hub loads the shared helper and the panel', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public/hub/index.html'), 'utf8');
  assert.match(html, /<script src="\.\/recommenders\.js"><\/script>/);
  assert.match(html, /LettersPanel\.jsx Track\.jsx/);
});
