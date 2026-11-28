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

function harness(ws, hurry) {
  let state = ws;
  const events = [];
  const tools = T.makeInterviewTools(async (fn) => (state = fn(state)), async () => state, (e) => events.push(e), hurry);
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
  ws.applicant = { ...ws.applicant, name: 'Sam', gpaUnweighted: '3.8', gpaScale: '4.0', sat: '1400' };
  ws.profile = { ...ws.profile, hs: 'HS', gradYear: 2027, intended: 'Biology', residency: 'OH', activities: [{ rank: 1, name: 'Robotics', type: 'Academic', role: 'Build lead', hpw: '10', desc: 'Led the build team of 12 and designed the drivetrain for our regional entry' }] };
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
  await h.tools.execute('save_deep_answer', JSON.stringify({ prompt: 'What drives you?', answer: 'Fixing old radios with my grandfather' , followedUp: true}));
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

test('a student applying without scores cannot be shown test-required colleges', () => {
  const ws = wsWith({ budget: 'unsure' });
  ws.applicant.gpaUnweighted = '3.95'; ws.applicant.satNote = 'Test optional';
  const fill = (n, tier) => Array.from({ length: n }, (_, i) => ({ name: `${tier} College ${i}`, tier, reason: 'r', supplements: 'yes' }));
  const list = [{ name: 'Harvard University', tier: 'reach', reason: 'r', supplements: 'yes' }, ...fill(3, 'reach'), ...fill(4, 'target'), ...fill(3, 'likely')];
  const problem = T.checkListProposal(ws, list);
  assert.match(problem, /^Harvard University requires SAT or ACT scores/);
  assert.match(T.studentWarning(problem), /^Heads up: Harvard University requires SAT or ACT scores\. You said you're applying without scores/);
  ws.applicant.satNote = '1500 superscore'; ws.applicant.sat = '1500';
  assert.doesNotMatch(T.checkListProposal(ws, list) || '', /Harvard/);
});

test('past the research budget, a list Forge objects to is shown at once with its warning', async () => {
  const ws = complete(wsWith({ budget: 'lt15', needAid: true }));
  ws.onboarding.listPrefs = { ...ws.onboarding.listPrefs, budget: 'lt15', suppCount: 10, noSuppCount: 0 };
  const h = harness(ws, () => true);
  const out = await h.tools.execute('propose_list', JSON.stringify({ schools: list(10, 2, 'no') }));
  assert.match(out, /^Shown to the student/);
  const ev = h.events.find((e) => e.type === 'list');
  assert.match(ev.warning, /fewer than two likely schools on this list fit your budget/);
});

test('a tight-budget list that needs aid cannot lean on out-of-state publics', () => {
  const ws = wsWith({ budget: 'lt15', needAid: true, suppCount: 8, noSuppCount: 3 });
  ws.profile.residency = 'TX';
  const s = (name, tier, supplements) => ({ name, tier, reason: 'r', supplements, fitsBudget: 'yes' });
  const grokList = [s('University of Tulsa', 'reach', 'yes'), s('Clemson University', 'reach', 'yes'), s('Auburn University', 'target', 'yes'), s('Texas A&M University', 'target', 'yes'), s('University of Alabama', 'target', 'yes'), s('University of South Carolina', 'target', 'yes'), s('University of Oklahoma', 'target', 'yes'), s('University of Arkansas', 'target', 'yes'), s('University of Texas at San Antonio', 'likely', 'no'), s('Texas State University', 'likely', 'no'), s('University of Texas at Arlington', 'likely', 'no')];
  const problem = T.checkListProposal(ws, grokList);
  assert.match(problem, /out-of-state public universities .*Clemson University/);
  assert.match(T.studentWarning(problem), /rarely give need-based aid to nonresidents/);
  ws.onboarding.listPrefs.budget = '50plus';
  assert.doesNotMatch(T.checkListProposal(ws, grokList) || '', /out-of-state/, 'no cap, no rule');
});

test('an international student who needs aid is not required to have likely US schools', () => {
  const s = (name, tier) => ({ name, tier, reason: 'r', supplements: 'yes' });
  const schools = [s('A', 'reach'), s('B', 'reach'), s('C', 'reach'), ...['D', 'E', 'F', 'G', 'H', 'I', 'J'].map((n) => s(n, 'target'))];
  const intl = wsWith({ budget: '30-50', needAid: true, citizenship: 'international', suppCount: 10, noSuppCount: 0 });
  assert.equal(T.needsInternationalAid(intl), true);
  assert.equal(T.checkListProposal(intl, schools), null);
  assert.equal(T.checkMix(intl, schools), null);
  const us = wsWith({ budget: '30-50', needAid: true, citizenship: 'us', suppCount: 10, noSuppCount: 0 });
  assert.match(T.checkListProposal(us, schools) || T.checkMix(us, schools) || '', /likely/);
});

test('a transfer path is saved with the list and shown with it', async () => {
  const ws = complete(wsWith({ budget: 'lt15', needAid: true, suppCount: 6, noSuppCount: 4 }));
  const h = harness(ws, () => true);
  const transferPath = { college: 'San Antonio College', transfersTo: 'University of Texas at San Antonio', reason: 'Alamo Colleges transfer agreement: complete the nursing prerequisites with a 3.0 GPA.' };
  await h.tools.execute('propose_list', JSON.stringify({ schools: list(10, 2, 'yes'), transferPath }));
  assert.deepEqual(h.events.find((e) => e.type === 'list').transferPath, transferPath);
  assert.deepEqual(h.ws.onboarding.interview.transferPath, transferPath);
  assert.deepEqual(h.tools.shown().transferPath, transferPath);
});

test('a transfer path must lead to a different college', () => {
  assert.equal(T.parseTransferPath({ college: 'San Antonio College', transfersTo: 'San Antonio College RN-to-BSN', reason: 'r' }), undefined);
  assert.deepEqual(T.parseTransferPath({ college: 'San Antonio College', transfersTo: 'Texas State University', reason: 'r' }), { college: 'San Antonio College', transfersTo: 'Texas State University', reason: 'r' });
  assert.equal(T.parseTransferPath({ college: 'X', reason: 'r' }), undefined);
});

test('likely schools stay in the regions the student chose (at most one outside)', () => {
  const ws = wsWith({ budget: 'lt15', needAid: true, regions: ['south'], suppCount: 6, noSuppCount: 4 });
  ws.profile.residency = 'TX';
  const s = (name, tier) => ({ name, tier, reason: 'r', supplements: 'unknown', fitsBudget: 'yes' });
  const maria = [s('University of the Incarnate Word', 'target'), s('Texas Lutheran University', 'target'), s('Texas State University', 'likely'), s('Texas A&M University–College Station', 'target'), s('Texas Christian University', 'target'), s('University of Tulsa', 'reach'), s('Baylor University', 'target'), s('D’Youville University', 'likely'), s('Gannon University', 'likely'), s('San Antonio College', 'likely')];
  assert.match(T.farLikelySchools(ws, maria), /D’Youville University \(NY\), Gannon University \(PA\)/);
  assert.match(T.studentWarning(T.farLikelySchools(ws, maria)), /outside the regions you chose/);
  assert.equal(T.farLikelySchools(ws, maria.filter((x) => x.name !== 'Gannon University')), null, 'one far likely school is fine');
  assert.equal(T.farLikelySchools(wsWith({ regions: ['any'] }), maria), null, 'no region chosen, no rule');
});

test('a list far shorter than requested is never shown, even after refusals or when time is short', async () => {
  const ws = complete(wsWith({ budget: 'lt15', needAid: true, suppCount: 8, noSuppCount: 3 }));
  const h = harness(ws, () => true);
  const four = list(4, 2, 'yes');
  for (let i = 0; i < 4; i++) assert.match(await h.tools.execute('propose_list', JSON.stringify({ schools: four })), /^Not shown: this list has 4 applications and the student asked for \d+; Forge won't show fewer than \d+/);
  assert.equal(h.events.some((e) => e.type === 'list'), false);
  assert.equal(T.tooShort(ws, list(8, 2, 'yes')), null, 'two short is allowed');
  assert.match(T.tooShort(ws, list(5, 2, 'yes')), /fewer than 8/);
});

test('out of time, half the requested list is enough to show', () => {
  const ws = complete(wsWith({ budget: 'lt15', needAid: true, suppCount: 8, noSuppCount: 2 }));
  assert.match(T.tooShort(ws, list(6, 2, 'yes')), /fewer than 8/);
  assert.equal(T.tooShort(ws, list(6, 2, 'yes'), true), null);
  assert.match(T.tooShort(ws, list(4, 2, 'yes'), true), /fewer than 5/);
});

test('a one-line deeper answer is sent back for a follow-up first', async () => {
  const h = harness(wsWith());
  const thin = await h.tools.execute('save_deep_answer', JSON.stringify({ prompt: 'What drives you?', answer: 'idk, stuff' }));
  assert.match(thin, /Not saved: .*follow-up/);
  assert.equal((h.ws.onboarding.interview?.deep ?? []).length, 0);
  const after = await h.tools.execute('save_deep_answer', JSON.stringify({ prompt: 'What drives you?', answer: 'idk, stuff', followedUp: true }));
  assert.match(after, /Saved/);
});

test('activity details can be declined after two tries', async () => {
  const h = harness(wsWith());
  await h.tools.execute('set_interview_facts', JSON.stringify({ activityDetails: 'declined' }));
  assert.equal(h.ws.onboarding.interview.activityDetailsDeclined, true);
});
