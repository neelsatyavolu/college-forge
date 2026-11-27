const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { archetypeOf, ARCHETYPES, writingTotals, nextDeadline, isOptional, byPromptType } = require('../public/hub/essay-archetypes.js');

const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, '../lib/supplements/prompts.json'), 'utf8'));
/** A prompt from the real dataset, found by school slug and label. */
function real(slug, label) {
  const p = dataset.schools[slug].prompts.find((x) => x.label.startsWith(label));
  assert.ok(p, `${slug} ${label} is in prompts.json`);
  return { id: `${slug}-${label}`, label: p.label, prompt: p.prompt || p.options.join(' '), limit: p.limit || 650, unit: p.unit };
}
const kind = (e) => archetypeOf(e);

test('real prompts from prompts.json land in the expected archetype', () => {
  assert.equal(kind(real('duke-university', 'Why Duke')), 'why-us');
  assert.equal(kind(real('hofstra-university', 'Why This College Essay')), 'why-us');
  assert.equal(kind(real('lehigh-university', 'Why This College Short Response')), 'why-us');
  assert.equal(kind(real('north-carolina-state-university', 'Why This Major Short Response')), 'why-major');
  assert.equal(kind(real('carnegie-mellon-university', 'Essays 1')), 'why-major');
  assert.equal(kind(real('hamilton-college', 'Diversity Short Response')), 'community');
  assert.equal(kind(real('georgetown-university', 'Short Essay 2')), 'challenge');
  assert.equal(kind(real('harvard-university', 'Short answer 4')), 'activity');
  assert.equal(kind(real('university-of-florida', 'Extracurricular Short Response')), 'activity');
  assert.equal(kind(real('brigham-young-university', 'Engaging Topic Essay')), 'curiosity');
  assert.equal(kind(real('princeton-university', 'More About You 2')), 'short');
  assert.equal(kind(real('kansas-state-university', 'Additional Info Short Response')), 'additional');
});

test('Common App prompts are the personal statement and every archetype has a label', () => {
  assert.equal(kind({ id: 'ca-ps-3', label: 'Personal statement', prompt: 'Reflect on a time you questioned a belief.', limit: 650, unit: 'words' }), 'personal');
  assert.ok(ARCHETYPES.every((a) => a.id && a.label));
  const ids = new Set(ARCHETYPES.map((a) => a.id));
  for (const school of Object.values(dataset.schools)) {
    for (const p of school.prompts || []) assert.ok(ids.has(kind({ id: 'x', label: p.label, prompt: p.prompt, limit: p.limit || 650, unit: p.unit })));
  }
});

test('optional prompts are recognised by field, label and placeholder text', () => {
  assert.equal(isOptional({ label: 'Why us', required: false }), true);
  assert.equal(isOptional({ label: 'Anything else (optional)' }), true);
  assert.equal(isOptional({ label: 'Engineering essay (only if this applies to you)' }), true);
  assert.equal(isOptional({ label: 'Short answer / other', prompt: 'Optional second slot for X.' }), true);
  assert.equal(isOptional({ label: 'Why us', prompt: 'Why us?' }), false);
});

const e = (id, limit, extra = {}) => ({ id, label: id, prompt: 'Tell us.', limit, unit: 'words', ...extra });
const words = (n) => Array.from({ length: n }, () => 'w').join(' ');

test('words required counts required prompts plus only the chosen number from each choose-N group', () => {
  const groups = [
    { key: 'common', kind: 'common', items: [e('ca-ps-1', 650), e('ca-ps-2', 650), e('ca-ps-3', 650)] },
    { key: 'uc-application', kind: 'uc', items: Array.from({ length: 8 }, (_, i) => e(`uc-piq-${i + 1}`, 350)) },
    { key: 'duke', kind: 'school', items: [e('duke-why', 250), e('duke-opt', 250, { required: false })] },
    { key: 'gone', kind: 'orphan', items: [e('old', 500)] },
  ];
  const drafts = { 'ca-ps-2': words(700), 'uc-piq-3': words(100), 'uc-piq-5': words(350), 'duke-why': words(50), 'duke-opt': words(200), old: words(500) };
  const t = writingTotals(groups, drafts, { 'uc-piq-5': 'final' });
  // 1 personal statement + 4 PIQs + Duke's required prompt.
  assert.equal(t.required, 6);
  assert.equal(t.wordsRequired, 650 + 4 * 350 + 250);
  // Over-limit text counts only up to the limit; optional and orphan prompts are left out.
  assert.equal(t.wordsWritten, 650 + 100 + 350 + 50);
  assert.equal(t.drafted, 4);
  assert.equal(t.final, 1);
});

test('choose-N picks the started prompts first and explicit chooseGroup fields win over the defaults', () => {
  const groups = [{ key: 'x', kind: 'school', items: [e('a', 200, { chooseGroup: 'x-pick', choose: 1 }), e('b', 300, { chooseGroup: 'x-pick', choose: 1 }), e('c', 100)] }];
  const none = writingTotals(groups, {}, {});
  assert.deepEqual([none.required, none.wordsRequired], [2, 300 + 100]);
  const started = writingTotals(groups, { a: words(20) }, {});
  assert.deepEqual([started.required, started.wordsRequired, started.drafted], [2, 200 + 100, 1]);
});

test('character-limit prompts count toward essays but not toward the word total', () => {
  const t = writingTotals([{ key: 'b', kind: 'school', items: [e('c1', 1500, { unit: 'characters' })] }], { c1: 'abc' }, {});
  assert.deepEqual([t.required, t.drafted, t.wordsRequired, t.wordsWritten], [1, 1, 0, 0]);
});

test('next deadline is the earliest upcoming application round for the chosen round', () => {
  const colleges = [
    { slug: 'a', short: 'A', deadline: 'RD · Jan 5', deadlines: [{ plan: 'ED I', date: '2026-11-01' }, { plan: 'RD', date: '2027-01-05' }] },
    { slug: 'b', short: 'B', deadlines: [{ plan: 'EA', date: '2026-11-15' }, { plan: 'Financial aid', date: '2026-11-02' }] },
    { slug: 'c', short: 'C', deadlines: [{ plan: 'EA', date: '2026-10-15' }] },
  ];
  const next = nextDeadline(colleges, '2026-10-20');
  assert.deepEqual([next.date, next.round, next.college.slug], ['2026-11-15', 'EA', 'b']);
  assert.equal(nextDeadline(colleges.slice(0, 1), '2026-10-20').date, '2027-01-05');
  assert.equal(nextDeadline([{ slug: 'd' }], '2026-10-20'), null);
});

test('the prompt-type view groups by archetype and sorts by limit, longest first', () => {
  const items = [
    { ...e('s1', 100), label: 'Why Rice', prompt: 'Why are you applying to Rice?' },
    { ...e('s2', 300), label: 'Why Duke', prompt: 'Why Duke?' },
    { ...e('s3', 1500, { unit: 'characters' }), label: 'Why BYU', prompt: 'Why do you want to attend BYU?' },
  ];
  const sections = byPromptType(items);
  const why = sections.find((s) => s.id === 'why-us');
  assert.deepEqual(why.items.map((i) => i.id), ['s2', 's3', 's1']);
  assert.equal(sections.every((s) => s.items.length > 0), true);
});

test('an optional extra prompt in the Common App group stays out of the personal-statement pick', () => {
  const groups = [{ key: 'common', kind: 'common', items: [e('ca-ps-1', 650), e('ca-ps-2', 650), { ...e('ca-additional', 650), label: 'Additional information (optional)' }] }];
  const t = writingTotals(groups, {}, {});
  assert.deepEqual([t.required, t.wordsRequired], [1, 650]);
});

test('a final personal statement is the one counted, even when another draft is longer', () => {
  const groups = [{ key: 'common', kind: 'common', items: [e('ca-ps-1', 650), e('ca-ps-2', 650)] }];
  const t = writingTotals(groups, { 'ca-ps-1': words(300), 'ca-ps-2': words(100) }, { 'ca-ps-2': 'final' });
  assert.deepEqual([t.required, t.final, t.wordsWritten], [1, 1, 100]);
});

test('hidden essays and unchosen Common App prompts leave the totals', () => {
  const { visibleItems } = require('../public/hub/essay-archetypes.js');
  const groups = [
    { key: 'common', kind: 'common', items: [e('ca-ps-1', 650), e('ca-ps-2', 650), { ...e('ca-additional-info', 650), required: false }] },
    { key: 'rice', kind: 'school', items: [e('rice-1', 250), e('rice-2', 100)] },
  ];
  const drafts = { 'ca-ps-1': words(500), 'ca-ps-2': words(10) };
  assert.equal(writingTotals(groups, drafts, {}).required, 3);
  const hidden = writingTotals(groups, drafts, {}, { hidden: { 'rice-2': true } });
  assert.deepEqual([hidden.required, hidden.wordsRequired], [2, 900]);
  // The chosen prompt is the counted pick even though another draft is longer.
  const chosen = writingTotals(groups, drafts, {}, { commonAppPrompt: 'ca-ps-2' });
  assert.deepEqual([chosen.required, chosen.wordsWritten], [3, 10]);
  // Additional information stays optional.
  assert.equal(writingTotals([groups[0]], {}, {}, { commonAppPrompt: 'ca-ps-2' }).required, 1);
  assert.deepEqual(visibleItems(groups[0].items, { commonAppPrompt: 'ca-ps-2' }).map((i) => i.id), ['ca-ps-2', 'ca-additional-info']);
});

test('pickSets finds choose-N sets with more than one pick, and pickPatch hides the prompts not picked', () => {
  const { pickSets, pickPatch } = require('../public/hub/essay-archetypes.js');
  const piq = (n) => ({ id: `uc-piq-${n}`, label: `PIQ ${n}`, prompt: 'p', limit: 350, unit: 'words' });
  const items = [...Array.from({ length: 8 }, (_, i) => piq(i + 1)), { id: 'ca-ps-1', label: 'PS 1', prompt: 'p', limit: 650, unit: 'words' }];
  const sets = pickSets(items);
  assert.equal(sets.length, 1, 'the Common App set picks one, so it has its own control');
  assert.equal(sets[0].choose, 4);
  assert.deepEqual(sets[0].items.map((i) => i.id), Array.from({ length: 8 }, (_, i) => `uc-piq-${i + 1}`));
  assert.deepEqual(pickPatch(sets[0].items, ['uc-piq-1', 'uc-piq-3', 'uc-piq-5', 'uc-piq-8']), {
    'uc-piq-1': null, 'uc-piq-2': true, 'uc-piq-3': null, 'uc-piq-4': true,
    'uc-piq-5': null, 'uc-piq-6': true, 'uc-piq-7': true, 'uc-piq-8': null,
  });
});

test('markSegments splits a draft into plain and flagged runs, skipping sentences no longer in the text', () => {
  const { markSegments } = require('../public/hub/essay-archetypes.js');
  const text = 'I grew up near the sea. The waves taught me patience.\n\nLater I left.';
  assert.deepEqual(markSegments(text, ['The waves taught me patience.', 'A sentence I deleted.', '  Later I left. ']), [
    { text: 'I grew up near the sea. ', mark: false },
    { text: 'The waves taught me patience.', mark: true },
    { text: '\n\n', mark: false },
    { text: 'Later I left.', mark: true },
  ]);
  assert.deepEqual(markSegments('abc', []), [{ text: 'abc', mark: false }]);
  assert.deepEqual(markSegments('', ['x']), []);
});

test('audience sets: pick the college you apply to, hide the other colleges’ prompts, keep shared ones', () => {
  const { audienceSet, audiencePatch, chosenAudience } = require('../public/hub/essay-archetypes.js');
  const p = (id, audience) => ({ id, label: id, prompt: 'p', limit: 250, unit: 'words', ...(audience ? { audience } : {}) });
  const items = [p('why'), p('cals-1', 'CALS'), p('cals-2', 'CALS'), p('eng-1', 'Engineering'), p('as-1', 'Arts and Sciences')];
  const set = audienceSet(items);
  assert.deepEqual(set.audiences, ['CALS', 'Engineering', 'Arts and Sciences']);
  assert.equal(set.shared, true);
  assert.deepEqual(audiencePatch(items, 'CALS'), { 'cals-1': null, 'cals-2': null, 'eng-1': true, 'as-1': true });
  assert.deepEqual(audiencePatch(items, ''), { 'cals-1': true, 'cals-2': true, 'eng-1': true, 'as-1': true }, 'none of these hides every program prompt');
  assert.equal(chosenAudience(items, {}), null, 'nothing chosen while every program prompt shows');
  assert.equal(chosenAudience(items, { 'eng-1': true, 'as-1': true }), 'CALS');
  assert.equal(chosenAudience(items, { 'cals-1': true, 'cals-2': true, 'eng-1': true, 'as-1': true }), '');
  assert.equal(audienceSet([p('a', 'X'), p('b')]), null, 'one audience is an only-if-it-applies prompt, not a choice');
});

test('sidebarLabel drops the college prefix and turns optional / only-if notes into tags', () => {
  const { sidebarLabel } = require('../public/hub/essay-archetypes.js');
  assert.deepEqual(sidebarLabel({ label: 'Cornell David A. Duffield College of Engineering: Question 2 (only if this applies to you)', audience: 'Cornell David A. Duffield College of Engineering' }), { text: 'Question 2', tag: '' });
  assert.deepEqual(sidebarLabel({ label: 'DC Start essay (only if this applies to you)', audience: 'Brooks School' }), { text: 'DC Start essay', tag: 'If it applies' });
  assert.deepEqual(sidebarLabel({ label: 'Written supplement (optional)' }), { text: 'Written supplement', tag: 'Optional' });
  assert.deepEqual(sidebarLabel({ label: 'Why Wake?' }), { text: 'Why Wake?', tag: '' });
  assert.deepEqual(sidebarLabel({ label: 'College of Arts and Sciences (only if this applies to you)', audience: 'College of Arts and Sciences' }), { text: 'College of Arts and Sciences', tag: '' });
});
