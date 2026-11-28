const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.join(__dirname, '..', request.slice(2)) + '.ts' : request, ...args); };

const sai = require('../lib/sai-formula.ts');

// ── Formula A against the Department's own worked example ──────────────────
test('Formula A reproduces the 2027-28 guide exemplar (Table 10 inputs, Table 11 SAI 12,198)', () => {
  const r = sai.formulaA({
    parentsMarried: true, familySize: 7,
    // AGI 86,334 + 79,998, plus untaxed IRA (2,000 - 1,000) + max(0, 1,000 - 2,000) = 167,332
    parentIncome: 167_332, parentIncomeTaxPaid: 40_326,
    parentEarners: [{ earnings: 95_456, status: 'single' }, { earnings: 85_002, status: 'qss' }],
    parentCash: 24_789, parentInvestments: 48_574,
    studentIncome: 5_723, studentIncomeTaxPaid: 0, studentEarnings: 6_755, studentCash: 0, studentInvestments: 0,
  });
  assert.equal(r.parentAvailableIncome, 36_451);
  assert.equal(r.parentAdjustedAvailableIncome, 45_255);
  assert.equal(r.parentContribution, 12_198);
  assert.equal(r.studentIncomeContribution, 0);
  assert.equal(r.sai, 12_198);
});

test('tables: income protection allowance, Table A5 brackets, business adjustment, rounding', () => {
  assert.equal(sai.incomeProtectionAllowance(4), 46_590);
  assert.equal(sai.incomeProtectionAllowance(7), 71_550);
  assert.equal(sai.incomeProtectionAllowance(1), 30_300);
  assert.equal(sai.parentContribution(-10_000), -1_958);
  assert.equal(sai.parentContribution(10_000), 2_200);
  assert.equal(sai.parentContribution(50_000), 12_336 + Math.round(0.47 * 4_400));
  assert.equal(sai.adjustedBusinessNetWorth(100_000), 40_000);
  assert.equal(sai.adjustedBusinessNetWorth(1_000_000), 566_000);
  assert.equal(sai.saiRound(11.549), 12);
  assert.equal(sai.saiRound(-11.449), -11);
  assert.equal(sai.povertyGuideline(4, 'CA'), 32_150);
  assert.equal(sai.povertyGuideline(4, 'AK'), 40_190);
  assert.equal(sai.povertyGuideline(4, 'HI'), 36_980);
});

test('SAI is clamped at -1,500', () => {
  const r = sai.formulaA({
    parentsMarried: false, familySize: 6, parentIncome: 5_000, parentIncomeTaxPaid: 0, parentEarners: [{ earnings: 5_000, status: 'hoh' }],
    parentCash: 0, parentInvestments: 0, studentIncome: 0, studentIncomeTaxPaid: 0, studentEarnings: 0, studentCash: 0, studentInvestments: 0,
  });
  assert.equal(r.sai, -1_500);
});

test('Pell: non-filers get max Pell and SAI -1500; poverty-line thresholds; minimum Pell; the 2x max cutoff', () => {
  const base = { parentsFiledTaxes: true, singleParent: false, familySize: 4, state: 'TX' };
  assert.deepEqual(sai.pellFor(3_000, { ...base, parentsFiledTaxes: false }), { sai: -1_500, maxPell: true, minPellIndicator: true, award: sai.MAX_PELL });
  // 175% of 32,150 = 56,263: at that AGI the SAI is held at 0 or below and Pell is the maximum.
  const atLine = sai.pellFor(2_500, { ...base, parentAgi: 56_263 });
  assert.equal(atLine.maxPell, true);
  assert.equal(atLine.sai, 0);
  assert.equal(atLine.award, sai.MAX_PELL);
  assert.equal(sai.pellFor(2_500, { ...base, parentAgi: 56_264 }).maxPell, false);
  // Single parent: 225% of the line.
  assert.equal(sai.pellFor(2_500, { ...base, singleParent: true, parentAgi: 72_000 }).maxPell, true);
  // Above the max-Pell line, Pell = max - SAI while SAI <= max - min.
  assert.equal(sai.pellFor(2_000, { ...base, parentAgi: 60_000 }).award, sai.MAX_PELL - 2_000);
  // 275% of 32,150 = 88,413: minimum Pell for an SAI under twice the maximum.
  assert.equal(sai.pellFor(9_000, { ...base, parentAgi: 88_000 }).award, sai.MIN_PELL);
  assert.equal(sai.pellFor(9_000, { ...base, parentAgi: 90_000 }).award, 0);
  assert.equal(sai.pellFor(2 * sai.MAX_PELL, { ...base, parentAgi: 80_000 }).award, 0);
});

// ── Estimates from a student's (synthetic) aid details ─────────────────────
const os = require('node:os');
process.env.CF_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-aid-estimate-'));
delete process.env.BLOB_READ_WRITE_TOKEN;
const { NextRequest } = require('next/server');
const store = require('../lib/store.ts');
const tracker = require('../lib/tracker.ts');
const est = require('../lib/aid-estimate.ts');
const profile = require('../lib/aid-profile.ts');
const { aidChecklist } = require('../lib/aid-checklist.ts');
const { aidPlan } = require('../lib/aid-plan.ts');
const { parentView } = require('../lib/parent-view.ts');
const { runAidTool } = require('../lib/aid-tools.ts');
const { optionalFields } = require('../lib/interview-checklist.ts');
const workspace = require('../app/api/workspace/route.ts');
const aidRoute = require('../app/api/aid/route.ts');

const fact = (key, value) => ({ key, value, sourceUrl: 'https://example.edu/aid', checkedAt: '2026-10-01' });
const fullNeed = { slug: 'full-need-college', name: 'Full Need College', research: { facts: [fact('sticker_cost', '$80,000 total cost of attendance'), fact('meets_full_need', 'Meets 100% of demonstrated need for all admitted students'), fact('css_profile', 'Required (with FAFSA). Uses IDOC.')] } };
const partial = { slug: 'partial-aid-u', name: 'Partial Aid U', research: { facts: [fact('sticker_cost', '$60,000'), fact('meets_full_need', 'No; average 60% of need met'), fact('net_price_75_110k', '$22,000 (2023-24)'), fact('css_profile', 'Not required')] } };
const family = (aidProfile, prefs = {}) => {
  const ws = store.emptyWorkspace();
  return { ...ws, profile: { ...ws.profile, residency: 'CA' }, colleges: [fullNeed, partial], aidProfile, onboarding: { ...ws.onboarding, listPrefs: { ambition: 'balanced', settings: [], size: 'any', regions: [], notes: '', needAid: true, budget: 'lt15', ...prefs } } };
};

test('married family of 4, $80k: SAI 4,168-5,459 by hand, shown as $100 ranges, partial Pell', () => {
  // Low end: tax 5,343 - 1,000 credits = 4,343; payroll 6,120; IPA 46,590; EEA 5,200 -> PAI 17,747; assets 10,000 x 12% = 1,200;
  // PAAI 18,947 x 22% = 4,168. High end: assets 50,000 -> PAAI 23,747 -> 5,259; student savings 1,000 x 20% = 200 -> 5,459.
  const e = est.estimateSai(family({ householdSize: 4, parentStatus: 'married', parentsFiledTaxes: 'yes', parentAgi: 80_000, parentAssets: '10-50', studentIncome: 'lt5', studentSavings: 'lt1' }));
  assert.equal(e.status, 'ok');
  assert.equal(e.awardYear, '2027-28');
  assert.deepEqual(e.sai, { low: 4_200, high: 5_500 });
  // Pell = 7,395 - SAI: 1,936 to 3,227.
  assert.deepEqual(e.pell, { eligible: 'yes', amount: { low: 1_900, high: 3_200 } });
  assert.ok(e.assumptions.some((a) => /2026-27 maximum/.test(a)));
});

test('single parent of 2 kids at $40k is under 225% of the poverty line: max Pell', () => {
  const e = est.estimateSai(family({ householdSize: 3, parentStatus: 'divorced_separated', parentAgi: 40_000 }));
  assert.ok(e.sai.high <= 0);
  assert.deepEqual(e.pell, { eligible: 'yes', amount: { low: 7_395, high: 7_395 } });
});

test('non-filers get SAI -1,500; high income gets no Pell; independent and missing income say why; needAid false is skipped', () => {
  assert.deepEqual(est.estimateSai(family({ parentsFiledTaxes: 'no' })).sai, { low: -1_500, high: -1_500 });
  const rich = est.estimateSai(family({ householdSize: 4, parentStatus: 'married', parentAgi: 250_000, parentAssets: '100-250' }));
  assert.equal(rich.pell.eligible, 'no');
  assert.ok(rich.sai.low > 30_000);
  assert.equal(est.estimateSai(family({ independent: 'yes' })).status, 'independent');
  assert.equal(est.estimateSai(family({})).status, 'needs_income');
  // The onboarding income range stands in for a missing AGI.
  const ranged = est.estimateSai(family({}, { incomeBracket: '48-75' }));
  assert.equal(ranged.status, 'ok');
  assert.ok(ranged.sai.low < ranged.sai.high);
  assert.equal(est.estimateSai(family({ parentAgi: 50_000 }, { needAid: false })).status, 'not_applying');
});

test('per school: full-need schools cost about the SAI; others use the school average for the income; budget fit', () => {
  const { schools } = est.aidEstimate(family({ householdSize: 4, parentStatus: 'married', parentAgi: 80_000, parentAssets: '10-50', studentIncome: 'lt5', studentSavings: 'lt1' }));
  const [full, part] = schools;
  assert.equal(full.basis, 'full_need');
  assert.deepEqual(full.netPrice, { low: 4_200, high: 5_500 });
  assert.deepEqual(full.need, { low: 74_500, high: 75_800 });
  assert.equal(full.fitsBudget, 'yes');
  assert.equal(part.basis, 'school_average');
  assert.deepEqual(part.netPrice, { low: 22_000, high: 22_000 });
  assert.equal(part.fitsBudget, 'no');
  assert.equal(est.meetsFullNeed('No full-need guarantee; average 88% of need met'), false);
  assert.equal(est.meetsFullNeed('Yes: need-blind and meets full calculated need'), true);
  assert.equal(est.meetsFullNeed('Guarantees 100% of demonstrated need for all applicants who meet deadlines'), true);
  assert.equal(est.meetsFullNeed('Does not meet full need: average 61.2% of need met'), false);
  assert.equal(est.meetsFullNeed('Nearly: on average 97% of need met; meets full need for most'), false);
});

test('checklist: 2025 taxes, CSS schools from research, noncustodial parent profile when divorced, IDOC, official links only', () => {
  const ws = family({ parentStatus: 'divorced_separated' });
  const apps = [fullNeed, partial].map((c) => tracker.newApp({ name: c.name, slug: c.slug }, 1));
  const withApps = { ...ws, tracker: { ...ws.tracker, apps } };
  const steps = aidChecklist(withApps, aidPlan(withApps));
  const css = steps.find((s) => s.id === 'css');
  assert.match(steps.find((s) => s.id === 'documents').title, /2025/);
  assert.match(css.items.join(' '), /Full Need College/);
  assert.doesNotMatch(css.items.join(' '), /Partial Aid U/);
  assert.match(css.items.join(' '), /Noncustodial Parent Profile/);
  assert.ok(steps.some((s) => s.id === 'idoc'));
  for (const link of steps.flatMap((s) => s.links)) assert.match(link.url, /^https:\/\/([a-z]+\.)?(studentaid\.gov|collegeboard\.org|fsapartners\.ed\.gov)\//);
});

// ── Validation, saving and privacy ─────────────────────────────────────────
test('aid details: ranges validated, "" clears in the form, tool blanks ignored, unknown fields refused', () => {
  assert.equal(profile.parseAidProfile({ parentAssets: 'lots' }).ok, false);
  assert.equal(profile.parseAidProfile({ householdSize: 40 }).ok, false);
  assert.equal(profile.parseAidProfile({ ssn: '123-45-6789' }).ok, false);
  assert.deepEqual(profile.parseAidProfile({ parentAgi: '$85,000', parentAssets: '' }).value, { parentAgi: 85_000, parentAssets: null });
  assert.deepEqual(profile.parseAidProfile({ householdSize: 0, parentAssets: '', benefits: 'yes' }, 'tool').value, { benefits: 'yes' });
  assert.deepEqual(profile.applyAidProfile({ parentAssets: 'lt10', householdSize: 4 }, { parentAssets: null, householdSize: 5 }), { householdSize: 5 });
});

test('the money section offers aid details only to students applying for aid or unsure, and never requires them', () => {
  assert.match(optionalFields(family({}), 'money')[0], /aid details \(optional/);
  assert.deepEqual(optionalFields(family({}, { needAid: false }), 'money'), []);
  assert.deepEqual(optionalFields(family({}), 'campus'), []);
});

const req = (id, body, method = 'PATCH', pathname = '/api/workspace') =>
  new NextRequest('http://localhost' + pathname, { method, headers: { cookie: `cf_workspace=${id}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

test('PATCH saves aid details, refuses bad ones with a plain message, and GET /api/aid returns the estimate', async () => {
  const id = 'aid-estimate-patch';
  await store.updateWorkspace(id, (ws) => ({ ...ws, onboarding: { ...ws.onboarding, listPrefs: { ambition: 'balanced', settings: [], size: 'any', regions: [], notes: '', needAid: true } } }));
  let res = await workspace.PATCH(req(id, { aidProfile: { householdSize: 'four' } }));
  assert.equal(res.status, 400);
  assert.doesNotMatch((await res.json()).error, /Error:|\.ts\b|\n/);
  res = await workspace.PATCH(req(id, { aidProfile: { householdSize: 4, parentAgi: 70000, parentStatus: 'married' } }));
  assert.equal(res.status, 200);
  assert.deepEqual((await store.getWorkspace(id)).aidProfile, { householdSize: 4, parentAgi: 70_000, parentStatus: 'married' });
  res = await aidRoute.GET(req(id, undefined, 'GET', '/api/aid'));
  const j = await res.json();
  assert.equal(j.data.estimate.status, 'ok');
  assert.ok(Array.isArray(j.data.checklist) && j.data.checklist.length >= 5);
  assert.equal(j.data.details.parentAgi, 70_000);
});

test('needAid null ("not sure") clears the answer', async () => {
  const id = 'aid-estimate-needaid';
  await store.updateWorkspace(id, (ws) => ({ ...ws, onboarding: { ...ws.onboarding, listPrefs: { ambition: 'balanced', settings: [], size: 'any', regions: [], notes: '', needAid: false } } }));
  const res = await workspace.PATCH(req(id, { listPrefs: { needAid: null } }));
  assert.equal(res.status, 200);
  assert.equal((await store.getWorkspace(id)).onboarding.listPrefs.needAid, undefined);
});

test('aid details never reach parent views or full share links', () => {
  const ws = { ...family({ parentAgi: 123_456, parentAssets: 'gt500', homeEquity: 'gt500' }), shares: [] };
  for (const level of ['basic', 'standard', 'full']) assert.doesNotMatch(JSON.stringify(parentView(ws, level)), /123456|gt500|aidProfile/);
  assert.doesNotMatch(JSON.stringify(store.publicShareView(ws)), /123456|gt500|aidProfile/);
});

test('set_aid_details saves only known fields and get_aid_estimate reads them back', async () => {
  let ws = family({});
  const mutate = async (fn) => (ws = fn(ws));
  const read = async () => ws;
  assert.match(await runAidTool('set_aid_details', { parentAgi: 90_000, householdSize: 0, parentAssets: '' }, mutate, read), /Saved parentAgi/);
  assert.deepEqual(ws.aidProfile, { parentAgi: 90_000 });
  const refused = await runAidTool('set_aid_details', { ssn: '1' }, mutate, read);
  assert.doesNotMatch(refused, /Saved/);
  assert.deepEqual(ws.aidProfile, { parentAgi: 90_000 });
  const out = JSON.parse(await runAidTool('get_aid_estimate', {}, mutate, read));
  assert.equal(out.estimate.status, 'ok');
  assert.equal(await runAidTool('something_else', {}, mutate, read), null);
});

test('needAid false turns aid forms off for every school unless the student turned one back on', () => {
  const ws = family({}, { needAid: false });
  const apps = [tracker.newApp({ name: fullNeed.name, slug: fullNeed.slug }, 1), { ...tracker.newApp({ name: partial.name, slug: partial.slug }, 1), ignoreAid: false }];
  const plan = aidPlan({ ...ws, tracker: { ...ws.tracker, apps } });
  assert.deepEqual(plan.schools.map((s) => s.ignoreAid), [true, false]);
  assert.equal(plan.totals.cssSchools, 0);
});
