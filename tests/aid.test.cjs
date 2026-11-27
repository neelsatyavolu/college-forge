const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.join(__dirname, '..', request.slice(2)) + '.ts' : request, ...args); };
process.env.CF_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-aid-'));
delete process.env.BLOB_READ_WRITE_TOKEN;
const { NextRequest } = require('next/server');
const store = require('../lib/store.ts');
const tracker = require('../lib/tracker.ts');
const plan = require('../lib/aid-plan.ts');
const validate = require('../lib/aid-validate.ts');
const { parentView } = require('../lib/parent-view.ts');
const { makeHubTools } = require('../lib/hub-tools.ts');
const exporter = require('../lib/export.ts');
const workspace = require('../app/api/workspace/route.ts');
const aidRoute = require('../app/api/aid/route.ts');
const deadlinePlan = require('../public/hub/deadline-plan.js');

const req = (id, body, method = 'PATCH', pathname = '/api/workspace') =>
  new NextRequest('http://localhost' + pathname, { method, headers: { cookie: `cf_workspace=${id}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const app = (over) => ({ ...tracker.newApp({ name: over.name, slug: over.slug }, 1), ...over });
const college = (slug, name, extra = {}) => ({ slug, name, short: name, ...extra });

// ── CSS / IDOC reading ─────────────────────────────────────────────────────

test('CSS Profile wording from real research facts', () => {
  const cases = [
    ['Not required; FAFSA only (CDS 2025-26 H8)', 'not_required'],
    ['Required (with FAFSA) for need-based aid. Due Nov 15 for EA/ED I', 'required'],
    ['CSS Profile + FAFSA required for need-based aid', 'required'],
    ['Not applicable: tuition, room and board are covered', 'not_required'],
    ['CSS Profile not used. Apply with the Princeton Financial Aid Application', 'not_required'],
    ['FAFSA required for aid; CSS Profile also accepted (not required). Aid deadlines: Nov 1', 'not_required'],
    ['Not listed: admissions and aid pages require only the FAFSA', 'unknown'],
    ['Not mentioned; IU aid starts with the FAFSA', 'unknown'],
    ['Domestic applicants: FAFSA plus Faye', 'unknown'],
    ['', 'unknown'],
  ];
  for (const [text, want] of cases) assert.equal(plan.classifyCss(text), want, text);
  assert.equal(plan.mentionsIdoc('CSS Profile, FAFSA and IDOC required; due Nov 1'), true);
  assert.equal(plan.mentionsIdoc('CSS Profile + FAFSA required'), false);
});

test('aid deadline kinds match the hub deadline tones', () => {
  for (const p of ['Financial aid priority', 'CSS Profile (ED)', 'FAFSA', 'Merit scholarship', 'Presidential Fellows', 'ED I', 'Honors program']) {
    const label = deadlinePlan.deadlineTone(p).label;
    const want = label === 'Aid' ? 'aid' : label === '$' ? 'scholarship' : null;
    assert.equal(plan.deadlineKind(p), want, p);
  }
});

test('dollars reads plain and $ amounts, and skips words', () => {
  assert.equal(plan.dollars('$5,000'), 5000);
  assert.equal(plan.dollars('5000'), 5000);
  assert.equal(plan.dollars('$12.5k per year'), 12500);
  assert.equal(plan.dollars('TBD'), 0);
  assert.equal(plan.dollars(undefined), 0);
});

// ── aidPlan ────────────────────────────────────────────────────────────────

function aidWorkspace() {
  const ws = store.emptyWorkspace();
  const research = (value) => ({ slug: 'x', name: 'x', checkedAt: '2026-11-01', complete: true, deadlines: [], supplements: [], facts: [{ key: 'css_profile', value, sourceUrl: 'https://aid.example.edu/css', checkedAt: '2026-11-01', cycle: '2026-27', thirdParty: false }] });
  return {
    ...ws,
    colleges: [
      college('css-u', 'CSS University', { research: research('CSS Profile, FAFSA and IDOC required'), deadlines: [{ plan: 'CSS Profile (ED)', date: '2026-11-15' }, { plan: 'CSS Profile (RD)', date: '2027-02-01' }, { plan: 'ED', date: '2026-11-01' }, { plan: 'Merit scholarship', date: '2026-12-01' }] }),
      college('fafsa-u', 'FAFSA University', { research: research('Not required; FAFSA only') }),
      college('skip-u', 'Skip University', { research: research('Required with FAFSA'), deadlines: [{ plan: 'Financial aid', date: '2026-12-01' }] }),
    ],
    scholarships: [
      { id: 'w1', name: 'Local', status: 'won', amount: '$1,500' },
      { id: 'w2', name: 'Club', status: 'won', amount: 'TBD' },
      { id: 'o1', name: 'Open', status: 'researching', amount: '$9,000' },
    ],
    tracker: {
      ...ws.tracker,
      apps: [
        app({ id: 'a-css', name: 'CSS University', slug: 'css-u', round: 'ED', followUps: [{ id: 'f1', text: 'Send CSS Profile fee waiver', due: '', done: false, createdAt: 1 }, { id: 'f2', text: 'Write thank-you note', due: '', done: false, createdAt: 1 }] }),
        app({ id: 'a-fafsa', name: 'FAFSA University', slug: 'fafsa-u' }),
        app({ id: 'a-skip', name: 'Skip University', slug: 'skip-u', ignoreAid: true }),
        app({ id: 'a-denied', name: 'Denied College', status: 'denied' }),
        app({ id: 'a-gone', name: 'Withdrawn College', status: 'withdrawn' }),
        app({ id: 'a-unknown', name: 'Nowhere Institute of Testing' }),
      ],
    },
  };
}

test('aidPlan rows: CSS, IDOC, deadlines, ignoreAid, stopped apps and totals', () => {
  const p = plan.aidPlan(aidWorkspace(), '2026-11-02');
  assert.deepEqual(p.schools.map((s) => s.appId), ['a-css', 'a-fafsa', 'a-skip', 'a-unknown'], 'denied and withdrawn apps are left out');
  const css = p.schools[0];
  assert.equal(css.css, 'required');
  assert.equal(css.idoc, true);
  assert.equal(css.cssSource, 'https://aid.example.edu/css');
  assert.deepEqual(css.deadlines.map((d) => d.kind), ['aid', 'scholarship', 'aid'], 'round deadlines are not aid deadlines');
  assert.deepEqual(css.followUps.map((f) => f.id), ['f1'], 'only aid follow-ups');
  assert.deepEqual(css.todos, [
    { text: 'Submit the CSS Profile for CSS University', due: '2026-11-15' },
    { text: 'Upload tax documents to IDOC for CSS University', due: '2026-11-15' },
  ], 'due on the ED aid deadline');
  assert.equal(p.schools[1].css, 'not_required');
  assert.deepEqual(p.schools[1].todos, []);
  const skip = p.schools[2];
  assert.equal(skip.ignoreAid, true);
  assert.equal(skip.css, 'required');
  assert.deepEqual(skip.deadlines, []);
  assert.deepEqual(skip.todos, []);
  assert.equal(p.schools[3].css, 'unknown');
  assert.deepEqual(p.totals, { cssSchools: 1, idocSchools: 1, scholarshipsWon: 2, wonAmount: 1500 });
});

test('aidPlan drops to-dos already added or already done', () => {
  const ws = aidWorkspace();
  const withTodo = {
    ...ws,
    financialAid: { ...ws.financialAid, idocStatus: 'submitted' },
    tracker: { ...ws.tracker, apps: ws.tracker.apps.map((a) => (a.id === 'a-css' ? tracker.addFollowUp(a, 'Submit the CSS Profile for CSS University') : a)) },
  };
  assert.deepEqual(plan.aidPlan(withTodo, '2026-11-02').schools[0].todos, []);
});

test('a school without saved research falls back to the audited file', () => {
  const ws = store.emptyWorkspace();
  const p = plan.aidPlan({ ...ws, tracker: { ...ws.tracker, apps: [app({ id: 'a1', name: 'Amherst College' })] } }, '2026-11-02');
  assert.equal(p.schools[0].css, 'required');
  assert.match(p.schools[0].cssSource, /^https:\/\/www\.amherst\.edu\//);
});

// ── Validation ─────────────────────────────────────────────────────────────

test('scholarship and financial aid validation', () => {
  assert.equal(validate.checkScholarship({ name: 'A', status: 'maybe' }, false).ok, false);
  assert.equal(validate.checkScholarship({ name: 'x'.repeat(201) }, false).ok, false);
  assert.equal(validate.checkScholarship({ url: 'javascript:alert(1)' }, false).ok, false);
  assert.equal(validate.checkScholarship({ url: 'https://' }, false).ok, false);
  assert.equal(validate.checkScholarship({ kind: 'mystery' }, false).ok, false);
  assert.equal(validate.checkScholarship({ id: '', name: 'New' }, false).ok, true, 'an empty id creates');
  assert.equal(validate.checkScholarshipList([{ status: 'won' }]).ok, false, 'a whole row needs a name');
  assert.equal(validate.checkScholarshipList(Array.from({ length: 201 }, (_, i) => ({ name: `S${i}` }))).ok, false);
  assert.equal(validate.checkFinancialAid({ cssStatus: 'done' }).ok, false);
  assert.equal(validate.checkFinancialAid({ idocStatus: 'n_a', fafsaStatus: 'submitted' }).ok, true);
  assert.equal(validate.checkFinancialAid({ fafsaStatus: 'n_a' }).ok, false, 'FAFSA has no n_a');
  assert.equal(validate.isAidDate('2026-02-30'), false);
  assert.equal(validate.isAidDate('2026-02-28'), true);
});

test('aid offers: whole dollars, $ text accepted, bad values rejected, null clears', () => {
  const a = app({ id: 'o1', name: 'Offer U' });
  const withOffer = tracker.editApp(a, { aidOffer: { costOfAttendance: '$85,000', grants: 60000.4, loans: '', notes: ' Renewable ' } }, 5);
  assert.deepEqual(withOffer.aidOffer, { costOfAttendance: 85000, grants: 60000, notes: 'Renewable', updatedAt: 5 });
  assert.throws(() => tracker.editApp(a, { aidOffer: { grants: -1 } }), /Aid amounts/);
  assert.throws(() => tracker.editApp(a, { aidOffer: { grants: 'lots' } }), /Aid amounts/);
  assert.equal(tracker.editApp(withOffer, { aidOffer: null }).aidOffer, undefined);
});

test('the same open follow-up is not added twice', () => {
  let a = app({ id: 'd1', name: 'Dup U' });
  a = tracker.addFollowUp(a, 'Submit the CSS Profile');
  a = tracker.addFollowUp(a, 'submit the css profile');
  assert.equal(a.followUps.length, 1);
});

// ── PATCH /api/workspace ───────────────────────────────────────────────────

test('PATCH rejects bad aid writes and leaves the workspace unchanged', async () => {
  const id = 'aid-patch-workspace';
  await store.updateWorkspace(id, (ws) => ({ ...ws, colleges: [college('on-list', 'On List U')], scholarships: [{ id: 'old', name: 'Old', status: 'researching', deadline: 'next spring' }] }));
  const before = await store.getWorkspace(id);
  const bad = [
    { scholarship: { name: 'A', status: 'maybe' } },
    { scholarship: { name: 'A', url: 'javascript:alert(1)' } },
    { scholarship: { name: 'x'.repeat(300) } },
    { scholarship: { name: 'A', deadline: 'next week' } },
    { scholarship: { name: 'A', slug: 'not-on-list' } },
    { financialAid: { cssStatus: 'done' } },
    { financialAid: { idocStatus: 'yes' } },
    { scholarships: [{ id: 'old', name: 'Old', status: 'researching', deadline: 'changed text' }] },
  ];
  for (const body of bad) {
    const res = await workspace.PATCH(req(id, body));
    assert.equal(res.status, 400, JSON.stringify(body));
    const j = await res.json();
    assert.equal(j.success, false);
    assert.ok(j.error && !/\n|Error:|\.ts\b/.test(j.error), 'a user-facing message');
  }
  const after = await store.getWorkspace(id);
  assert.equal(after.revision, before.revision);
  assert.deepEqual(after.scholarships, before.scholarships);
});

test('PATCH saves slug, kind and idocStatus, and keeps an old free-text deadline on re-save', async () => {
  const id = 'aid-patch-ok';
  await store.updateWorkspace(id, (ws) => ({ ...ws, colleges: [college('on-list', 'On List U')], scholarships: [{ id: 'old', name: 'Old', status: 'researching', deadline: 'next spring' }] }));
  let res = await workspace.PATCH(req(id, { scholarship: { name: 'Dean award', slug: 'on-list', amount: '$4,000', deadline: '2027-03-01', status: 'won' } }));
  assert.equal(res.status, 200);
  res = await workspace.PATCH(req(id, { financialAid: { idocStatus: 'in_progress' } }));
  assert.equal(res.status, 200);
  res = await workspace.PATCH(req(id, { scholarship: { id: 'old', status: 'submitted', deadline: 'next spring' } }));
  assert.equal(res.status, 200);
  const ws = await store.getWorkspace(id);
  const award = ws.scholarships.find((s) => s.name === 'Dean award');
  assert.equal(award.slug, 'on-list');
  assert.equal(award.kind, 'school', 'a school link defaults to the school kind');
  assert.equal(ws.financialAid.idocStatus, 'in_progress');
  assert.equal(ws.scholarships.find((s) => s.id === 'old').status, 'submitted');
});

test('older workspaces read IDOC as n_a', async () => {
  const fresh = store.emptyWorkspace();
  assert.equal(fresh.financialAid.idocStatus, 'n_a');
});

// ── GET /api/aid ───────────────────────────────────────────────────────────

test('GET /api/aid returns the caller\'s own rows only', async () => {
  const mine = 'aid-route-mine';
  const other = 'aid-route-other';
  await store.updateWorkspace(other, (ws) => ({ ...ws, tracker: { ...ws.tracker, apps: [app({ id: 'secret', name: 'Other Student College' })] } }));
  await store.updateWorkspace(mine, (ws) => ({ ...ws, tracker: { ...ws.tracker, apps: [app({ id: 'mine', name: 'Amherst College' })] } }));
  const res = await aidRoute.GET(new NextRequest(`http://localhost/api/aid?workspace=${other}`, { headers: { cookie: `cf_workspace=${mine}` } }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const j = await res.json();
  assert.deepEqual(j.data.schools.map((s) => s.appId), ['mine']);
  assert.ok(!JSON.stringify(j).includes('Other Student College'));
  const anon = await (await aidRoute.GET(new NextRequest('http://localhost/api/aid'))).json();
  assert.deepEqual(anon.data.schools, [], 'no cookie gets a new, empty workspace');
});

// ── Copilot tools ──────────────────────────────────────────────────────────

test('copilot aid tools validate and read the aid plan', async () => {
  const id = 'aid-copilot';
  await store.updateWorkspace(id, (ws) => ({ ...ws, colleges: [college('amherst-college', 'Amherst College')], tracker: { ...ws.tracker, apps: [app({ id: 'am', name: 'Amherst College', slug: 'amherst-college' })] } }));
  const h = makeHubTools(id);
  assert.ok(h.tools.some((t) => t.name === 'get_aid_plan'));
  assert.match(await h.executeTool('set_scholarships', JSON.stringify({ scholarships: [{ name: 'A', status: 'maybe' }] })), /status must be/);
  assert.match(await h.executeTool('set_scholarships', JSON.stringify({ scholarships: [{ name: 'A', url: 'javascript:x' }] })), /links must start/);
  assert.match(await h.executeTool('set_scholarships', JSON.stringify({ scholarships: [{ name: 'A', slug: 'nowhere' }] })), /isn't on your list/);
  assert.match(await h.executeTool('set_scholarships', JSON.stringify({ scholarships: [{ name: 'Amherst award', slug: 'amherst-college' }] })), /Saved 1/);
  assert.match(await h.executeTool('set_financial_aid', JSON.stringify({ cssStatus: 'finished' })), /CSS Profile status/);
  assert.match(await h.executeTool('set_financial_aid', JSON.stringify({ idocStatus: 'in_progress', fafsaStatus: '' })), /Updated/);
  const ws = await store.getWorkspace(id);
  assert.equal(ws.financialAid.idocStatus, 'in_progress');
  assert.equal(ws.scholarships[0].kind, 'school');
  const rows = JSON.parse(await h.executeTool('get_aid_plan', '{}'));
  assert.equal(rows.schools[0].css, 'required');
});

// ── Sharing and export ─────────────────────────────────────────────────────

test('parents see the aid checklist and IDOC, never offers or school award amounts', () => {
  const ws = aidWorkspace();
  const seeded = {
    ...ws,
    scholarships: [...ws.scholarships, { id: 'sch', name: 'Dean award', status: 'won', amount: '$20,000', kind: 'school', slug: 'css-u' }],
    tracker: { ...ws.tracker, apps: ws.tracker.apps.map((a) => (a.id === 'a-css' ? { ...a, aidOffer: { grants: 77777, updatedAt: 1 } } : a)) },
  };
  const basic = parentView(seeded, 'basic');
  assert.equal(basic.aidBySchool, undefined);
  const standard = parentView(seeded, 'standard');
  assert.equal(standard.financialAid.idocStatus, 'n_a');
  assert.equal(standard.aidBySchool.find((r) => r.appId === 'a-css').css, 'required');
  assert.equal(standard.scholarships.find((s) => s.id === 'sch').amount, undefined);
  assert.equal(standard.scholarships.find((s) => s.id === 'w1').amount, '$1,500', 'outside awards keep their amount');
  for (const view of [standard, parentView(seeded, 'full')]) {
    const text = JSON.stringify(view);
    assert.ok(!text.includes('77777'), 'no aid offer');
    assert.ok(!text.includes('$20,000'), 'no school award amount');
  }
});

test('exports list the IDOC status', () => {
  const ws = { ...store.emptyWorkspace(), financialAid: { fafsaStatus: 'submitted', cssStatus: 'submitted', idocStatus: 'in_progress' } };
  const names = Object.keys(exporter).filter((k) => typeof exporter[k] === 'function');
  const texts = names.map((n) => { try { return String(exporter[n](ws)); } catch { return ''; } }).join('\n');
  assert.match(texts, /IDOC: (\*\*)?in_progress/);
});

// ── Review follow-ups ──────────────────────────────────────────────────────

test('explicit negatives win: "not accepted" and "no IDOC"', () => {
  const uchicago = 'CSS Profile NOT accepted (no IDOC): submit the free UChicago Financial Aid Worksheet plus FAFSA';
  assert.equal(plan.classifyCss(uchicago), 'not_required');
  assert.equal(plan.mentionsIdoc(uchicago), false);
  assert.equal(plan.mentionsIdoc('IDOC not used'), false);
});

test('offer amounts reject malformed text', () => {
  const a = app({ id: 'm1', name: 'Malformed U' });
  for (const bad of ['$', '1,2', '12,00', 'abc']) assert.throws(() => tracker.editApp(a, { aidOffer: { grants: bad } }), /Aid amounts/, bad);
  assert.equal(tracker.editApp(a, { aidOffer: { grants: '$12,000.50' } }).aidOffer.grants, 12001);
});

test('school links: kind follows the link, and older whole-list saves keep it', async () => {
  const id = 'aid-kinds';
  await store.updateWorkspace(id, (ws) => ({ ...ws, colleges: [college('on-list', 'On List U')], scholarships: [{ id: 'x', name: 'X', status: 'won', kind: 'outside', amount: '$9' }, { id: 'y', name: 'Y', status: 'won', kind: 'school', slug: 'on-list', amount: '$7' }] }));
  assert.equal((await workspace.PATCH(req(id, { scholarship: { id: 'x', slug: 'on-list' } }))).status, 200);
  // An older client re-saves the whole list without the new fields.
  assert.equal((await workspace.PATCH(req(id, { scholarships: [{ id: 'x', name: 'X', status: 'won', amount: '$9' }, { id: 'y', name: 'Y', status: 'won', amount: '$7' }] }))).status, 200);
  const ws = await store.getWorkspace(id);
  assert.deepEqual(ws.scholarships.map((s) => [s.id, s.kind, s.slug]), [['x', 'school', 'on-list'], ['y', 'school', 'on-list']]);
  assert.equal((await workspace.PATCH(req(id, { scholarship: { id: 'x', slug: '' } }))).status, 200);
  const cleared = (await store.getWorkspace(id)).scholarships.find((s) => s.id === 'x');
  assert.equal(cleared.slug, undefined);
  assert.equal(cleared.kind, 'outside');
});

test('a college added in the same patch can be linked; legacy deadlines compare exactly', async () => {
  const id = 'aid-combined';
  await store.updateWorkspace(id, (ws) => ({ ...ws, scholarships: [{ id: 'old', name: 'Old', status: 'researching', deadline: 'next spring ' }] }));
  assert.equal((await workspace.PATCH(req(id, { colleges: [college('new-u', 'New U')], scholarship: { name: 'New award', slug: 'new-u' } }))).status, 200);
  assert.equal((await workspace.PATCH(req(id, { colleges: [], scholarship: { name: 'Gone', slug: 'other-u' } }))).status, 400);
  assert.equal((await workspace.PATCH(req(id, { scholarship: { id: 'old', notes: 'x', deadline: 'next spring ' } }))).status, 200);
});

test('a single add past 200 scholarships is refused', async () => {
  const id = 'aid-limit';
  await store.updateWorkspace(id, (ws) => ({ ...ws, scholarships: Array.from({ length: 200 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, status: 'researching' })) }));
  assert.equal((await workspace.PATCH(req(id, { scholarship: { name: 'One more' } }))).status, 400);
  assert.equal((await workspace.PATCH(req(id, { scholarship: { id: 's1', status: 'won' } }))).status, 200, 'edits still work');
});

test('full share links hide aid offers and school award amounts', () => {
  const ws = aidWorkspace();
  const view = store.publicShareView({
    ...ws,
    scholarships: [{ id: 'sch', name: 'Dean award', status: 'won', amount: '$20,000', kind: 'school', slug: 'css-u' }, { id: 'out', name: 'Local', status: 'won', amount: '$1,500' }],
    tracker: { ...ws.tracker, apps: ws.tracker.apps.map((a) => ({ ...a, aidOffer: { grants: 77777, updatedAt: 1 } })) },
  });
  const text = JSON.stringify(view);
  assert.ok(!text.includes('77777'));
  assert.ok(!text.includes('$20,000'));
  assert.ok(text.includes('$1,500'));
});

test('a refused copilot scholarship write does not bump the revision', async () => {
  const id = 'aid-copilot-rev';
  const before = (await store.getWorkspace(id)).revision;
  const h = makeHubTools(id);
  assert.match(await h.executeTool('set_scholarships', JSON.stringify({ scholarships: [{ name: 'A', slug: 'nowhere' }] })), /isn't on your list/);
  assert.equal((await store.getWorkspace(id)).revision, before);
});
