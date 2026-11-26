const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { emptyWorkspace } = require('../lib/store.ts');
const T = require('../lib/interview-tools.ts');

const school = (name, tier, extra = {}) => ({ name, tier, reason: 'fits', ...extra });
const list = (n, likely = 2, fits = 'yes') => [
  ...Array.from({ length: likely }, (_, i) => school(`Likely ${i}`, 'likely', { fitsBudget: fits })),
  ...Array.from({ length: n - likely }, (_, i) => school(`Other ${i}`, i % 2 ? 'reach' : 'target')),
];
const wsWith = (prefs = {}) => {
  const ws = emptyWorkspace();
  ws.onboarding = { completed: false, listPrefs: { ambition: 'balanced', settings: [], size: 'any', regions: [], notes: '', ...prefs } };
  return ws;
};

function harness(ws) {
  let state = ws;
  const events = [];
  const tools = T.makeInterviewTools(async (fn) => (state = fn(state)), async () => state, (e) => events.push(e));
  return { tools, events, get ws() { return state; } };
}

test('ask_question streams a question event and ends the turn', async () => {
  const h = harness(wsWith());
  assert.equal(h.tools.endTurn(), false);
  const out = await h.tools.execute('ask_question', JSON.stringify({ id: 'setting', kind: 'single', prompt: 'Campus?', options: [{ label: 'City' }, { label: 'Rural' }], min: 0, max: 0 }));
  assert.match(out, /wait for their answer/);
  assert.equal(h.tools.endTurn(), true);
  assert.equal(h.events[0].type, 'question');
  assert.deepEqual(h.events[0].question.options[0], { value: 'City', label: 'City' });
  assert.equal('min' in h.events[0].question, false, 'Codex 0 means absent');
});

test('a choice question needs two options', () => {
  assert.match(T.parseQuestion({ id: 'x', kind: 'single', prompt: 'p', options: [{ label: 'a' }] }), /at least 2 options/);
});

test('unknown tools fall through with null', async () => {
  assert.equal(await harness(wsWith()).tools.execute('web_search', '{}'), null);
});

test('advance_section is refused while required fields are missing', () => {
  const ws = wsWith();
  const r = T.applyAdvance(ws, 'school');
  assert.match(r.error, /Stay on basics: still need name/);
  assert.match(T.applyAdvance(ws, 'list').error, /Not ready for the list: basics/);
  assert.match(T.applyAdvance(ws, 'nowhere').error, /Unknown section/);
});

test('propose_list enforces 8-15 applications and two affordable likely schools', () => {
  const ws = wsWith({ budget: '30-50' });
  assert.match(T.checkListProposal(ws, list(7)), /7 applications/);
  assert.match(T.checkListProposal(ws, list(16)), /16 applications/);
  assert.match(T.checkListProposal(ws, list(10, 2, 'no')), /Only 0 likely schools fit/);
  assert.equal(T.checkListProposal(ws, list(10, 2, 'unknown')), null, 'unknown costs are not held against the list');
  assert.equal(T.checkListProposal(ws, list(10)), null);
  assert.equal(T.checkListProposal(wsWith({ budget: 'unsure' }), list(10, 2, 'unknown')), null);
});

test('UC campuses count as one application', () => {
  const ucs = ['Berkeley', 'Los Angeles', 'San Diego', 'Davis'].map((c) => ({ name: `University of California, ${c}` }));
  assert.equal(T.applicationCount([...ucs, { name: 'Rice University' }]), 2);
});

test('propose_list waits for the interview to be complete', async () => {
  const h = harness(wsWith());
  assert.match(await h.tools.execute('propose_list', JSON.stringify({ schools: list(10) })), /finish the interview first \(basics/);
  assert.equal(h.events.length, 0);
});

function complete(ws) {
  ws.applicant = { ...ws.applicant, name: 'Sam', gpaUnweighted: '3.8', sat: '1400' };
  ws.profile = { ...ws.profile, hs: 'HS', gradYear: 2027, intended: 'Biology', residency: 'OH', activities: [{ rank: 1, name: 'Robotics', type: 'Academic' }] };
  ws.onboarding.listPrefs = { ...ws.onboarding.listPrefs, settings: ['any'], regions: ['any'], budget: 'unsure', needAid: false, ed: 'no', ambitionChosen: true, suppCount: 10, noSuppCount: 0, citizenship: 'us', incomeBracket: 'unsure' };
  ws.onboarding.interview = { phase: 'interview', section: 'deep', transcript: [], notes: {}, deep: [1, 2, 3].map((i) => ({ prompt: 'q', answer: 'a' })), startedAt: 1 };
  return ws;
}

test('propose_list marks schools already on the list and saves the draft', async () => {
  const ws = complete(wsWith());
  ws.colleges = [{ slug: 'rice-university', name: 'Rice University', short: 'Rice' }];
  const h = harness(ws);
  const schools = [school('Rice University', 'target'), ...list(9)];
  await h.tools.execute('propose_list', JSON.stringify({ schools }));
  assert.equal(h.events[0].type, 'list');
  assert.equal(h.events[0].schools[0].current, true);
  assert.equal(h.ws.onboarding.interview.phase, 'list');
  assert.equal(h.ws.onboarding.interview.listDraft.length, 10);
  assert.equal(h.tools.endTurn(), true);
});

test('set_school_research drops unsourced facts and treats blanks as absent', () => {
  const ws = wsWith();
  ws.colleges = [{ slug: 'rice-university', name: 'Rice University', short: 'Rice' }];
  const r = T.mergeResearch(ws, {
    college: 'Rice University', complete: false,
    facts: [
      { key: 'admit_rate', value: '7.5% (Class of 2029)', sourceUrl: 'https://ir.rice.edu/cds', cycle: '2025-26', thirdParty: false, checkedAt: '' },
      { key: 'merit_aid', value: 'Yes', sourceUrl: '', cycle: '2026-27', thirdParty: false },
      { key: 'made_up', value: 'x', sourceUrl: 'https://a.b', cycle: '2026-27', thirdParty: false },
      { key: 'test_policy', value: 'Required', sourceUrl: 'https://admission.rice.edu/x', cycle: '', thirdParty: false },
    ],
  });
  assert.equal(r.saved, 1);
  assert.equal(r.dropped, 3);
  const facts = r.ws.colleges[0].research.facts;
  assert.equal(facts[0].key, 'admit_rate');
  assert.match(facts[0].checkedAt, /^\d{4}-\d{2}-\d{2}$/);
});

test('research merges by key across calls', () => {
  const ws = wsWith();
  ws.colleges = [{ slug: 'rice-university', name: 'Rice University', short: 'Rice' }];
  const fact = (value) => ({ key: 'admit_rate', value, sourceUrl: 'https://ir.rice.edu/cds', cycle: '2025-26', thirdParty: false });
  const a = T.mergeResearch(ws, { college: 'rice-university', facts: [fact('8%')], complete: false }).ws;
  const b = T.mergeResearch(a, { college: 'rice-university', facts: [fact('7.5%')], complete: true }).ws;
  assert.equal(b.colleges[0].research.facts.length, 1);
  assert.equal(b.colleges[0].research.facts[0].value, '7.5%');
  assert.equal(b.colleges[0].research.complete, true);
});

test('typed answers are stored in the transcript like tile answers, capped', () => {
  let ws = wsWith();
  ws = T.recordTurn(ws, { role: 'assistant', content: 'Campus?', ui: { question: { id: 'q' } }, at: 1 });
  ws = T.recordTurn(ws, { role: 'user', content: 'somewhere near a city but not in it', at: 2 });
  assert.equal(ws.onboarding.interview.transcript[1].content, 'somewhere near a city but not in it');
  for (let i = 0; i < 200; i++) ws = T.recordTurn(ws, { role: 'user', content: String(i), at: i });
  assert.equal(ws.onboarding.interview.transcript.length, T.TRANSCRIPT_CAP);
});

test('deep answers also feed story notes', async () => {
  const h = harness(wsWith());
  await h.tools.execute('save_deep_answer', JSON.stringify({ prompt: 'What drives you?', answer: 'Fixing old radios with my grandfather' }));
  assert.equal(h.ws.onboarding.interview.deep.length, 1);
  assert.match(h.ws.onboarding.storyNotes.other, /old radios/);
});

test('a paragraph repeated later in the same reply is dropped', () => {
  const a = "You don't need to predict your eventual major, but choose a field you'd honestly be happy studying. We'll check each college's rules before counting on a switch.";
  const b = "You don't need to predict your future major, but choose one you'd genuinely want to study. We'll check each college's rules before counting on a switch.";
  assert.equal(T.dedupeParagraphs(`${a}\n\n${b}`), a);
  assert.equal(T.dedupeParagraphs('Nice to meet you!\n\nWhat high school do you attend?'), 'Nice to meet you!\n\nWhat high school do you attend?', 'different paragraphs stay');
  assert.equal(T.dedupeParagraphs('Got it.\n\nGot it.'), 'Got it.\n\nGot it.', 'very short lines are left alone');
});

test('a list must match the student\'s supplement and no-supplement counts (±1); UC counts once and always has supplements', () => {
  const ws = wsWith({ budget: 'unsure', suppCount: 4, noSuppCount: 2 });
  const parsed = T.parseSchools([
    { name: 'University of California, Los Angeles', tier: 'reach', reason: 'r', supplements: 'no' },
    { name: 'University of California, San Diego', tier: 'target', reason: 'r' },
    { name: 'Northwestern University', tier: 'reach', reason: 'r', supplements: 'yes' },
    { name: 'Syracuse University', tier: 'target', reason: 'r', supplements: 'yes' },
    { name: 'Boston University', tier: 'target', reason: 'r', supplements: 'yes' },
    { name: 'University of Missouri', tier: 'likely', reason: 'r', supplements: 'no' },
    { name: 'Arizona State University', tier: 'likely', reason: 'r', supplements: 'no' },
  ]);
  assert.equal(parsed[0].supplements, 'yes', 'UC is always a supplement application');
  assert.equal(T.checkListProposal(ws, parsed), null, '4 supplement apps (UC once) and 2 without');
  const tooFew = parsed.filter((s) => s.supplements !== 'no').slice(0, 2);
  assert.match(T.checkListProposal(ws, tooFew), /asked for 4 applications with supplements and 2 without; this list has 1 with, 0 without and 0 unknown/);
});

test('Forge resets tiers from its admissions data and remembers the AI\'s guess', () => {
  const ws = wsWith();
  ws.applicant = { ...ws.applicant, gpaUnweighted: '3.95', sat: '1560' };
  const { schools, changed } = T.applyDataTiers(ws, [
    { name: 'Massachusetts Institute of Technology', tier: 'target', reason: 'r' },
    { name: 'A College Forge Has No Data For', tier: 'target', reason: 'r' },
  ]);
  assert.equal(schools[0].tier, 'reach');
  assert.equal(schools[0].aiTier, 'target');
  assert.equal(schools[1].tier, 'target', 'unknown colleges keep the AI tier');
  assert.deepEqual(changed, ['Massachusetts Institute of Technology target→reach']);
});

test('the draft list takes net price and supplements from Forge\'s research, not the AI', () => {
  const ws = wsWith({ budget: '15-30', needAid: true, incomeBracket: '75-110' });
  const [miami, ucla] = T.applyStudentFacts(ws, [
    { name: 'University of Miami', tier: 'target', reason: 'r', supplements: 'yes', netPrice: '$5,000', fitsBudget: 'yes' },
    { name: 'University of California, Los Angeles', tier: 'reach', reason: 'r', supplements: 'yes' },
  ]);
  assert.equal(miami.supplements, 'no', 'research says Miami has no supplement');
  assert.match(miami.netPrice, /average for your income/);
  assert.notEqual(miami.netPrice, '$5,000');
  assert.equal(miami.fitsBudget, /\$(\d+),/.test(miami.netPrice) && Number(miami.netPrice.replace(/[^\d]/g, '').slice(0, 5)) <= 30000 ? 'yes' : 'no');
  assert.equal(ucla.supplements, 'yes', 'a UC campus always has the PIQs');
});

test('a list Forge objects to is refused twice, then shown with a plain warning instead of looping', async () => {
  const ws = complete(wsWith({ budget: 'lt15', needAid: true }));
  ws.onboarding.listPrefs = { ...ws.onboarding.listPrefs, budget: 'lt15', suppCount: 10, noSuppCount: 0 };
  const h = harness(ws);
  const schools = list(10, 2, 'no');
  const call = () => h.tools.execute('propose_list', JSON.stringify({ schools }));
  assert.match(await call(), /^Not shown: Only 0 likely schools fit/);
  assert.match(await call(), /^Not shown:/);
  assert.match(await call(), /^Shown to the student/);
  const ev = h.events.find((e) => e.type === 'list');
  assert.match(ev.warning, /fewer than two likely schools on this list fit your budget/);
  assert.equal(h.ws.onboarding.interview.listRefusals, 0, 'the counter resets once a list is shown');
});

test('schools with unknown supplement needs count either way', () => {
  const ws = wsWith({ budget: 'unsure', suppCount: 6, noSuppCount: 4 });
  const mk = (n, supplements) => Array.from({ length: n }, (_, i) => ({ name: `${supplements}-${i}`, tier: i % 3 === 0 ? 'likely' : i % 3 === 1 ? 'target' : 'reach', reason: 'r', supplements }));
  assert.equal(T.checkListProposal(ws, [...mk(6, 'yes'), ...mk(1, 'no'), ...mk(3, 'unknown')]), null, '3 unknown can be the quick apps');
  assert.match(T.checkListProposal(ws, [...mk(9, 'yes'), ...mk(1, 'unknown')]), /9 with, 0 without and 1 unknown/);
});
