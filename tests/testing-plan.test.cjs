const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);

const tp = require('../lib/testing-plan.ts');
const tracker = require('../lib/tracker.ts');
const { viewApp } = require('../lib/tracker-service.ts');

const research = (slug) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'lib', 'school-research', `${slug}.json`), 'utf8'));
const fact = (slug, key) => research(slug).facts.find((f) => f.key === key);
const policyOf = (slug) => {
  const f = fact(slug, 'test_policy');
  return tp.parsePolicy(f.value, f.sourceUrl);
};
const scores = (s) => ({ sat: null, act: null, hasAps: false, ...s });

test('reads real research policies: required, optional, blind, flexible', () => {
  const yale = policyOf('yale-university');
  assert.equal(yale.kind, 'required', 'Yale is test-required even though the text mentions its old test-flexible policy');
  assert.equal(yale.selfReport, true);
  assert.equal(yale.superscore, true);
  assert.match(yale.sourceUrl, /^https:\/\/admissions\.yale\.edu\//);

  const amherst = policyOf('amherst-college');
  assert.equal(amherst.kind, 'optional');
  assert.equal(amherst.selfReport, true);

  assert.equal(policyOf('university-of-california-berkeley').kind, 'blind');
  assert.equal(policyOf('pitzer-college').kind, 'blind', 'test-free counts as blind');
  assert.equal(policyOf('carnegie-mellon-university').kind, 'flexible');
  assert.equal(policyOf('rutgers-university-camden').kind, 'optional', 'an opening "Test-optional" wins over a later mention of test-blind');
  assert.equal(policyOf('drexel-university').kind, 'optional', "'No Harm' test-optional");
  assert.equal(policyOf('university-of-southern-california').selfReport, false);
  assert.equal(policyOf('university-of-wisconsin-madison').superscore, false);
  assert.equal(policyOf('united-states-naval-academy').kind, 'required');
});

test('every research file parses to a known policy', () => {
  const dir = path.join(__dirname, '..', 'lib', 'school-research');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'manifest.json');
  const unknown = files.filter((f) => {
    const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).facts.find((x) => x.key === 'test_policy');
    return p && tp.parsePolicy(p.value).kind === 'unknown';
  });
  assert.deepEqual(unknown, []);
});

test('policy text that matches nothing is unknown, and empty text is unknown', () => {
  assert.equal(tp.parsePolicy('Scores are reviewed holistically').kind, 'unknown');
  assert.equal(tp.parsePolicy('').kind, 'unknown');
  assert.equal(tp.parsePolicy(undefined).kind, 'unknown');
});

test('parses composite middle-50% ranges and skips section-only facts', () => {
  assert.deepEqual(tp.parseRange(fact('yale-university', 'sat_mid50').value, 'SAT'), { low: 1480, high: 1560, mid: 1520, median: false });
  assert.deepEqual(tp.parseRange('1420-1510, median 1470 (enrolled Fall 2025)', 'SAT'), { low: 1420, high: 1510, mid: 1470, median: true });
  assert.deepEqual(tp.parseRange('30.5-33 (enrolled Fall 2025)', 'ACT'), { low: 30.5, high: 33, mid: 31.75, median: false });
  assert.equal(tp.parseRange(fact('harvard-university', 'sat_mid50').value, 'SAT'), null);
  assert.equal(tp.parseRange('1480-1560', 'ACT'), null, 'out of ACT range');
  assert.equal(tp.parseRange('', 'SAT'), null);
  assert.deepEqual(tp.parseRange(fact('bucknell-university', 'sat_mid50').value, 'SAT'), { low: 1170, high: 1360, mid: 1265, median: false }, 'a labeled composite after a preamble');
});

test('exceptions and no-harm policies change the wording, not the sourced facts', () => {
  const newark = tp.recommend(policyOf('rutgers-university-newark'), null, null, scores({ sat: 1500 }));
  assert.equal(newark.advice, 'dont_send');
  assert.match(newark.reason, /different rules; read the policy/);
  assert.doesNotMatch(tp.recommend(policyOf('amherst-college'), null, null, scores({ sat: 1500 })).reason, /different rules/);
  const drexel = policyOf('drexel-university');
  const sat = tp.parseRange(fact('drexel-university', 'sat_mid50').value, 'SAT');
  const low = tp.recommend(drexel, sat, null, scores({ sat: 1100 }));
  assert.equal(low.advice, 'your_call', 'scores never count against you at a no-harm school');
  assert.match(low.reason, /only count when they help/);
});

test('recommendation bands at a test-optional school', () => {
  const policy = policyOf('amherst-college');
  const sat = tp.parseRange(fact('amherst-college', 'sat_mid50').value, 'SAT'); // 1470-1540
  const act = tp.parseRange(fact('amherst-college', 'act_mid50').value, 'ACT'); // 33-35
  assert.equal(tp.recommend(policy, sat, act, scores({ sat: 1520 })).advice, 'send');
  assert.equal(tp.recommend(policy, sat, act, scores({ sat: 1505 })).advice, 'send', 'exactly the middle sends');
  const mid = tp.recommend(policy, sat, act, scores({ sat: 1480 }));
  assert.equal(mid.advice, 'your_call');
  assert.match(mid.reason, /SAT 1480 .*1470-1540/);
  assert.equal(tp.recommend(policy, sat, act, scores({ sat: 1400 })).advice, 'consider_withholding');
  assert.equal(tp.recommend(policy, sat, act, scores({ act: 35 })).advice, 'send');
  assert.equal(tp.recommend(policy, sat, act, scores({ sat: 1400, act: 35 })).advice, 'send', 'the better comparison wins');
  assert.equal(tp.recommend(policy, sat, act, scores({ sat: 1400 })).sourceUrl, policy.sourceUrl);
});

test('an ACT is concorded to the SAT when the school publishes only an SAT range', () => {
  const policy = tp.parsePolicy('Test-optional', 'https://example.edu/testing');
  const sat = { low: 1400, high: 1500, mid: 1450, median: false };
  const r = tp.recommend(policy, sat, null, scores({ act: 32 })); // 1430
  assert.equal(r.advice, 'your_call');
  assert.match(r.reason, /ACT 32 \(about 1430 SAT\)/);
  assert.equal(tp.recommend(policy, sat, null, scores({ act: 33 })).advice, 'send'); // 1460
  assert.equal(tp.recommend(policy, sat, null, scores({ act: 29 })).advice, 'consider_withholding'); // 1340
});

test('required, blind, flexible, unknown and no-score cases', () => {
  const none = scores({});
  assert.equal(tp.recommend(policyOf('yale-university'), null, null, scores({ sat: 1300 })).advice, 'send');
  const noScoreRequired = tp.recommend(policyOf('yale-university'), null, null, none);
  assert.equal(noScoreRequired.advice, 'send');
  assert.match(noScoreRequired.reason, /no SAT or ACT score on file/);
  assert.equal(tp.recommend(policyOf('university-of-california-berkeley'), null, null, scores({ sat: 1550 })).advice, 'dont_send');
  assert.equal(tp.recommend(policyOf('carnegie-mellon-university'), null, null, scores({ sat: 1550 })).advice, 'check_site');
  const unknown = tp.recommend(tp.parsePolicy(''), null, null, scores({ sat: 1550 }));
  assert.equal(unknown.advice, 'check_site');
  assert.equal(unknown.label, "Check the school's site");
  assert.equal(tp.recommend(policyOf('amherst-college'), null, null, none).advice, 'no_score');
  assert.equal(tp.recommend(policyOf('amherst-college'), null, null, scores({ sat: 1500 })).advice, 'your_call', 'no published range to compare');
});

test('student scores come from the profile, then the applicant, and ignore placeholders', () => {
  assert.deepEqual(tp.studentScores({ applicant: { sat: '1450' }, profile: { testing: { sat: '—', act: '33', aps: [{ course: 'Calc BC', score: '5' }] } } }), { sat: 1450, act: 33, hasAps: true });
  assert.deepEqual(tp.studentScores({ applicant: { sat: '—' }, profile: { testing: { sat: '1500', aps: [] } } }), { sat: 1500, act: null, hasAps: false });
  assert.deepEqual(tp.studentScores({ applicant: { sat: '2400' }, profile: { testing: { act: '40' } } }), { sat: null, act: null, hasAps: false });
  assert.deepEqual(tp.studentScores({}), { sat: null, act: null, hasAps: false });
});

const app = (extra = {}) => ({ ...tracker.newApp({ name: 'Yale University', slug: 'yale-university' }, 1000), ...extra });

test('editApp validates and merges the testing plan', () => {
  const a = tracker.editApp(app(), { testing: { plan: 'send', method: 'official' } }, 2000);
  assert.deepEqual(a.testing, { plan: 'send', method: 'official' });
  const b = tracker.editApp(a, { testing: { officialSent: '2026-11-20' } }, 3000);
  assert.deepEqual(b.testing, { plan: 'send', method: 'official', officialSent: '2026-11-20' });
  const c = tracker.editApp(b, { testing: { method: '', officialSent: '', apSelfReported: true } }, 4000);
  assert.deepEqual(c.testing, { plan: 'send', apSelfReported: true });
  assert.equal(tracker.editApp(app(), { testing: { apSelfReported: false } }).testing.plan, 'undecided');

  assert.throws(() => tracker.editApp(app(), { testing: { plan: 'maybe' } }), /^Error: Testing plan must be send, withhold or undecided/);
  assert.throws(() => tracker.editApp(app(), { testing: { method: 'email' } }), /^Error: Testing method/);
  assert.throws(() => tracker.editApp(app(), { testing: { officialSent: '11/20/2026' } }), /^Error: Testing: the official scores sent date/);
  assert.throws(() => tracker.editApp(app(), { testing: { officialSent: '2026-02-31' } }), /official scores sent date/);
  assert.throws(() => tracker.editApp(app(), { testing: { apSelfReported: 'yes' } }), /true or false/);
  assert.throws(() => tracker.editApp(app(), { testing: 'send' }), /must be an object/);
});

test('viewApp carries the sourced recommendation, the choice and pending score sends', () => {
  const plain = viewApp(app(), '2026-11-26', { sat: 1500, act: null, hasAps: true });
  assert.equal(plain.testingPlan.policy.kind, 'required');
  assert.equal(plain.testingPlan.recommendation.advice, 'send');
  assert.deepEqual(plain.testingPlan.choice, { plan: 'undecided' });
  assert.equal(plain.testingPlan.hasAps, true);
  assert.equal(plain.testingPlan.needsScoreSend, false);

  const pending = viewApp(app({ testing: { plan: 'send', method: 'official' } }), '2026-11-26');
  assert.equal(pending.testingPlan.needsScoreSend, true);
  const sent = viewApp(app({ testing: { plan: 'send', method: 'official', officialSent: '2026-11-01' } }), '2026-11-26');
  assert.equal(sent.testingPlan.needsScoreSend, false);

  const offList = viewApp({ ...tracker.newApp({ name: 'Nowhere Test College' }, 1000) }, '2026-11-26');
  assert.equal(offList.testingPlan.policy.kind, 'unknown');
  assert.equal(offList.testingPlan.recommendation.advice, 'check_site');
});

test('withholding hides SAT/ACT items only where scores are optional', () => {
  const portal = {
    checkedAt: 1, ok: true, error: '', statusText: '', update: '',
    checklist: [
      { item: 'SAT Scores', status: 'Not received', date: '', done: false, optional: false },
      { item: 'Counselor Recommendation', status: 'Not received', date: '', done: false, optional: false },
    ],
  };
  const amherst = (extra) => ({ ...tracker.newApp({ name: 'Amherst College' }, 1000), ...extra });
  assert.deepEqual(viewApp(amherst({ portal }), '2026-11-26').missing, ['SAT Scores', 'Counselor Recommendation']);
  assert.deepEqual(viewApp(amherst({ portal, testing: { plan: 'withhold' } }), '2026-11-26').missing, ['Counselor Recommendation']);
  assert.deepEqual(viewApp(app({ portal, testing: { plan: 'withhold' } }), '2026-11-26').missing, ['SAT Scores', 'Counselor Recommendation'], 'Yale requires scores, so a missing SAT stays');
  const english = { ...portal, checklist: [{ item: 'English proficiency test scores', status: '', date: '', done: false, optional: false }] };
  assert.deepEqual(viewApp(amherst({ portal: english, testing: { plan: 'withhold' } }), '2026-11-26').missing, ['English proficiency test scores']);
});

test('the applications API saves a testing plan and scores the recommendation with the student\'s SAT', async () => {
  const os = require('node:os');
  const Module = require('node:module');
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...args) {
    return resolve.call(this, request.startsWith('@/') ? path.join(__dirname, '..', request.slice(2)) + '.ts' : request, ...args);
  };
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-that-is-long-enough-1234';
  process.env.PORTAL_LOGINS_KEY = process.env.PORTAL_LOGINS_KEY || require('node:crypto').randomBytes(32).toString('base64');
  const { NextRequest } = require('next/server');
  const session = require('../lib/session.ts');
  const store = require('../lib/store.ts');
  const route = require('../app/api/applications/route.ts');
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-testing-'));
  const prev = process.env.CF_DATA_DIR, blob = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.CF_DATA_DIR = dir;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const ws = 'testing-plan-ws-1';
    const cookie = `forge_session=${session.signSession({ sub: 'xa_TP', workspaceId: ws, email: 'a@b.co', name: 'A' })}`;
    const post = (body) => route.POST(new NextRequest('http://localhost/api/applications', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    await store.updateWorkspace(ws, (w) => ({ ...w, profile: { ...w.profile, testing: { ...w.profile.testing, sat: '1400' } } }));
    const added = await (await post({ action: 'add', name: 'Amherst College' })).json();
    assert.equal(added.success, true);
    assert.equal(added.app.testingPlan.recommendation.advice, 'consider_withholding', '1400 is below Amherst\'s 25th percentile');
    const saved = await (await post({ action: 'update', id: added.app.id, edit: { testing: { plan: 'send', method: 'official' } } })).json();
    assert.equal(saved.success, true);
    assert.equal(saved.app.testingPlan.needsScoreSend, true);
    assert.equal(saved.data.apps[0].testingPlan.choice.method, 'official');
    assert.equal((await post({ action: 'update', id: added.app.id, edit: { testing: { plan: 'maybe' } } })).status, 400);
    assert.equal((await post({ action: 'update', id: added.app.id, edit: { testing: { plan: 'send', extra: 1 } } })).status, 400);
    assert.deepEqual((await store.getWorkspace(ws)).tracker.apps[0].testing, { plan: 'send', method: 'official' });
  } finally {
    if (prev === undefined) delete process.env.CF_DATA_DIR; else process.env.CF_DATA_DIR = prev;
    if (blob !== undefined) process.env.BLOB_READ_WRITE_TOKEN = blob;
    Module._resolveFilename = resolve;
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});
