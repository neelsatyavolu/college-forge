const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const detail = require('../public/hub/school-detail.js');
const { schoolInsights, majorFitFor, positionIn, compareAcademics } = require('../lib/school-detail.ts');
const { emptyWorkspace } = require('../lib/store.ts');
const { US_NEWS_BY_SLUG } = require('../lib/us-news-rankings.ts');
const career = require('../public/data/career-ranking.json');

const fact = (key, value, extra = {}) => ({ key, value, sourceUrl: 'https://example.edu/page', checkedAt: '2026-09-01', cycle: '2026-27', thirdParty: false, ...extra });

test('chosen round comes from the "EA · Nov 1" label and its matching deadline', () => {
  const c = { slug: 'x', deadline: 'EA · Nov 1', deadlines: [{ plan: 'EA', date: '2026-11-01' }, { plan: 'RD', date: '2027-01-05' }] };
  assert.deepEqual(detail.chosenRound(c), { plan: 'EA', label: 'EA · Nov 1', date: '2026-11-01' });
  assert.equal(detail.roundText(c), 'EA · Nov 1');
  assert.equal(detail.chosenRound({ ...c, deadline: 'ed ii · Jan 1', deadlines: [{ plan: 'ED II', date: '2027-01-01' }] }).date, '2027-01-01');
});

test('a plain date or no deadline means no round is chosen', () => {
  assert.equal(detail.chosenRound({ deadline: 'Jan 5, 2027', deadlines: [{ plan: 'RD', date: '2027-01-05' }] }), null);
  assert.equal(detail.chosenRound({}), null);
  assert.equal(detail.roundText({ deadline: '' }), 'Round not chosen');
});

test('cycle tags: none for the current cycle, "last cycle" for the one before, the year for older', () => {
  assert.equal(detail.cycleTag('2026-27'), null);
  assert.equal(detail.cycleTag(''), null);
  assert.equal(detail.cycleTag('2025-26'), 'last cycle');
  assert.equal(detail.cycleTag('2023-24'), '2023-24 cycle');
});

test('research groups keep every fact, unknown keys under Other, empty groups left out', () => {
  const groups = detail.researchGroups([fact('admit_rate', '9%'), fact('interview', 'Optional, evaluative'), fact('housing', 'Guaranteed 4 years'), fact('merit_aid', '')]);
  assert.deepEqual(groups.map((g) => g.title), ['Admissions', 'Applying', 'Other']);
  assert.equal(groups[0].rows[0].label, 'Admit rate');
  assert.equal(groups[2].rows[0].fact.value, 'Guaranteed 4 years');
  assert.deepEqual(detail.researchGroups(undefined), []);
});

test('dollars reads the highest amount, with k suffixes', () => {
  assert.equal(detail.dollars('$23,450 a year'), 23450);
  assert.equal(detail.dollars('about $18k'), 18000);
  assert.equal(detail.dollars('$12,000–$19,500'), 19500);
  assert.equal(detail.dollars('not published'), null);
});

test('cost for you prefers the researched bracket price and checks it against the budget', () => {
  const college = { netPriceForYou: '$31,000', research: { facts: [fact('net_price_48_75k', '$14,200')] } };
  const fits = detail.costForYou(college, { incomeBracket: '48-75', budget: '15-30' });
  assert.equal(fits.text, '$14,200');
  assert.equal(fits.income, '$48–75k');
  assert.equal(fits.fits, true);
  const over = detail.costForYou(college, { incomeBracket: 'gt110', budget: 'lt15' });
  assert.equal(over.text, '$31,000');
  assert.equal(over.fact, null);
  assert.equal(over.fits, false);
  assert.equal(detail.costForYou(college, { budget: 'unsure' }).fits, null);
  assert.equal(detail.costForYou({}, {}), null);
});

test('supplements carry draft status, skip hidden prompts and follow UC campuses to the UC Application', () => {
  const data = {
    essays: { supplements: {
      duke: [{ id: 'd1', label: 'Why Duke', prompt: 'Why?', limit: 250, unit: 'words' }, { id: 'd2', label: 'Optional: identity', prompt: 'Tell us', limit: 250, unit: 'words' }, { id: 'd3', label: 'Hidden', prompt: 'x', limit: 1, unit: 'words' }],
      'uc-application': [{ id: 'piq1', label: 'PIQ 1', prompt: 'Leadership', limit: 350, unit: 'words' }],
    } },
    essayDrafts: { d1: 'I want to study here because', d2: '' },
    essayStatus: { piq1: 'final' },
    essayHidden: { d3: true },
  };
  const duke = detail.supplementsFor(data, { slug: 'duke', name: 'Duke University' });
  assert.equal(duke.skipped, false);
  assert.deepEqual(duke.items.map((e) => [e.id, e.status, e.required, e.count]), [['d1', 'draft', true, 6], ['d2', 'not started', false, 0]]);
  const ucla = detail.supplementsFor(data, { slug: 'university-of-california-los-angeles', name: 'University of California, Los Angeles' });
  assert.deepEqual(ucla.items.map((e) => [e.id, e.status]), [['piq1', 'final']]);
  assert.equal(detail.supplementsFor({ ...data, essaySchools: { duke: false } }, { slug: 'duke', name: 'Duke' }).skipped, true);
});

test('"#shortlist/<slug>" opens a school; other hashes do not', () => {
  assert.equal(detail.slugFromHash('#shortlist/duke-university'), 'duke-university');
  assert.equal(detail.slugFromHash(detail.hashFor('a b')), 'a b');
  assert.equal(detail.slugFromHash('#shortlist'), null);
  assert.equal(detail.slugFromHash('#explore/duke-university'), null);
  assert.equal(detail.slugFromHash('#shortlist/%E0%A4%A'), null);
});

test('positionIn places a value against a range', () => {
  assert.equal(positionIn(1300, 1350, 1500), 'below');
  assert.equal(positionIn(1350, 1350, 1500), 'within');
  assert.equal(positionIn(1520, 1350, 1500), 'above');
});

const workspace = () => { const ws = emptyWorkspace(); ws.applicant.gpaUnweighted = '3.75'; ws.applicant.sat = '1420'; ws.profile.intended = 'Computer Science'; return ws; };

test('academic comparisons use the school snapshot and skip SAT at test-blind UCs', () => {
  const ws = workspace();
  const school = [...US_NEWS_BY_SLUG.values()].find((s) => s.sat25 && s.sat75 && s.gpa && !s.gpaWeighted && !s.slug.startsWith('university-of-california-'));
  const rows = compareAcademics(ws, school);
  assert.deepEqual(rows.map((r) => r.label), ['SAT', 'GPA']);
  assert.equal(rows[0].theirs, `${school.sat25}–${school.sat75} middle 50%`);
  const uc = [...US_NEWS_BY_SLUG.values()].find((s) => s.slug.startsWith('university-of-california-') && s.sat25);
  if (uc) assert.ok(!compareAcademics(ws, uc).some((r) => r.label === 'SAT'));
  assert.deepEqual(compareAcademics(ws, undefined), []);
  const none = emptyWorkspace();
  assert.deepEqual(compareAcademics(none, school), []);
});

test('major fit reads offered majors and switching levels from the career data', () => {
  const school = career.schools.find((s) => s.checked !== false && s.tracks.cs && (s.switch?.lv?.cs ?? 0) > 0);
  const fit = majorFitFor(school.id, 'Computer Science');
  assert.equal(fit.offered, true);
  assert.equal(fit.checked, true);
  assert.equal(fit.switching[0].major, 'Computer science');
  assert.equal(fit.switching[0].level, school.switch.lv.cs);
  assert.equal(majorFitFor(school.id, 'Undecided'), null);
  assert.equal(majorFitFor(school.id, ''), null);
  assert.deepEqual(majorFitFor(1, 'Computer Science'), { intended: 'Computer Science', offered: null, switching: [], checked: false });
});

test('school insights are only for schools on the list', () => {
  const ws = workspace();
  const row = US_NEWS_BY_SLUG.get('cornell-university');
  ws.colleges = [{ slug: row.slug, name: row.name, short: row.name, scorecardId: row.scorecardId }];
  const out = schoolInsights(ws, row.slug);
  assert.equal(out.slug, row.slug);
  assert.ok(out.fit && out.fit.reasons.length);
  assert.equal(out.major.intended, 'Computer Science');
  assert.equal(schoolInsights(ws, 'not-on-list'), null);
});

test('not applying for aid prices the school at its full cost, by residency when it prices residents apart', () => {
  const split = { location: 'Auburn, AL', research: { facts: [fact('sticker_cost', '$39,516 Alabama resident (tuition/fees $13,572), $63,540 non-resident'), fact('net_price_48_75k', '$14,200')] } };
  const home = detail.costForYou(split, { needAid: false, incomeBracket: '48-75', budget: '30-50' }, { residency: 'AL' });
  assert.deepEqual([home.text, home.basis, home.residency, home.fits], ['$39,516', 'full', 'in-state', true]);
  const away = detail.costForYou(split, { needAid: false, budget: '30-50' }, { residency: 'GA' });
  assert.deepEqual([away.text, away.residency, away.fits], ['$63,540', 'out-of-state', false]);
  const unknown = detail.costForYou(split, { needAid: false, budget: '30-50' }, {});
  assert.deepEqual([unknown.text, unknown.fits], ['Depends on your residency', null]);
  const priv = detail.costForYou({ research: { facts: [fact('sticker_cost', '$92,000 total')] } }, { needAid: false, budget: '50plus' }, {});
  assert.deepEqual([priv.text, priv.fits], ['$92,000', null]);
});

test('research facts skip what the page shows above and other income bands', () => {
  const facts = [fact('admit_rate', '9%'), fact('interview', 'Optional'), fact('housing', 'Guaranteed'), fact('net_price_lt30k', '$2,000'), fact('net_price_48_75k', '$9,000'), fact('merit_aid', 'Some')];
  const keys = (prefs) => detail.researchGroups(facts, prefs).flatMap((g) => g.rows.map((r) => r.fact.key));
  assert.deepEqual(keys({ incomeBracket: '48-75' }), ['merit_aid', 'net_price_48_75k', 'housing']);
  assert.deepEqual(keys({ needAid: false, incomeBracket: '48-75' }), ['merit_aid', 'housing']);
  assert.deepEqual(keys({}), ['merit_aid', 'net_price_lt30k', 'net_price_48_75k', 'housing']);
});
