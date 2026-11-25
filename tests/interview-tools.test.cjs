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
  assert.match(T.checkListProposal(ws, list(10, 2, 'unknown')), /Only 0 likely schools fit/);
  assert.equal(T.checkListProposal(ws, list(10)), null);
  assert.equal(T.checkListProposal(wsWith({ budget: 'unsure' }), list(10, 2, 'unknown')), null);
});

test('UC campuses count as one application', () => {
  const ucs = ['Berkeley', 'Los Angeles', 'San Diego', 'Davis'].map((c) => ({ name: `University of California, ${c}` }));
  assert.equal(T.applicationCount([...ucs, { name: 'Rice University' }]), 2);
});

test('propose_list marks schools already on the list and saves the draft', async () => {
  const ws = wsWith();
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
