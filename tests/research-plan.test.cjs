const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { emptyWorkspace } = require('../lib/store.ts');
const R = require('../lib/research-plan.ts');

const college = (slug, research) => ({ slug, name: `${slug} College`, short: slug, ...(research ? { research } : {}) });
const fact = (key, value, extra = {}) => ({ key, value, sourceUrl: 'https://x.edu/a', checkedAt: '2026-11-20', cycle: '2026-27', thirdParty: false, ...extra });
const curated = {
  slug: 'alpha', name: 'Alpha College', checkedAt: '2026-11-20', complete: true,
  facts: [fact('admit_rate', '9%'), fact('merit_aid', 'None', { thirdParty: true })],
  deadlines: [{ plan: 'ED', date: '2026-11-01', sourceUrl: 'https://x.edu/d', cycle: '2026-27' }, { plan: 'RD', date: '2026-01-02', sourceUrl: 'https://x.edu/d', cycle: '2025-26' }],
  supplements: [{ label: 'Why Alpha', prompt: 'Why Alpha? (200 words)', limit: 200, unit: 'words', sourceUrl: 'https://x.edu/e', cycle: '2026-27' }],
};

test('queue keeps list order and skips complete and given-up schools', () => {
  const ws = emptyWorkspace();
  ws.colleges = [college('a'), college('b', { complete: true, facts: [] }), college('c', { complete: false, needsReview: true, facts: [] }), college('d')];
  assert.deepEqual(R.researchQueue(ws).map((c) => c.slug), ['a', 'd']);
});

test('three incomplete steps mark a school for review', () => {
  let ws = emptyWorkspace();
  ws.colleges = [college('a')];
  for (let i = 0; i < 3; i++) ws = R.recordAttempt(ws, 'a');
  assert.equal(ws.colleges[0].research.attempts, 3);
  assert.equal(ws.colleges[0].research.needsReview, true);
  assert.deepEqual(R.researchQueue(ws), []);
});

test('a closed tab resumes at the first unfinished school', () => {
  const ws = emptyWorkspace();
  ws.colleges = [college('a', { complete: true, facts: [] }), college('b', { complete: false, facts: [fact('admit_rate', '9%')] }), college('c')];
  assert.deepEqual(R.researchSteps(ws).map((s) => s.slug), ['b', 'c']);
});

test('curated research is imported: facts, current deadlines, current prompts over placeholders', () => {
  const ws = emptyWorkspace();
  ws.colleges = [college('alpha')];
  const out = R.importCurated(ws, (s) => (s === 'alpha' ? curated : null), Date.parse('2027-01-10'));
  const c = out.colleges[0];
  assert.equal(c.research.facts.length, 2);
  assert.equal(c.research.complete, false, 'an older file is re-verified before complete');
  assert.deepEqual(c.deadlines, [{ plan: 'ED', date: '2026-11-01' }]);
  assert.equal(out.essays.supplements.alpha[0].prompt, 'Why Alpha? (200 words)');
  assert.equal(out.essays.supplements.alpha[0].id, 'alpha-supp-1');
});

test('curated import never replaces deadlines or real prompts the student already has', () => {
  const ws = emptyWorkspace();
  ws.colleges = [{ ...college('alpha'), deadlines: [{ plan: 'EA', date: '2026-11-15' }] }];
  ws.essays.supplements = { alpha: [{ id: 'alpha-x', label: 'Mine', prompt: 'A real prompt the student is answering', limit: 250, unit: 'words', source: 'official' }] };
  const out = R.importCurated(ws, () => curated);
  assert.deepEqual(out.colleges[0].deadlines, [{ plan: 'EA', date: '2026-11-15' }]);
  assert.equal(out.essays.supplements.alpha[0].id, 'alpha-x');
});

test('the prompt includes facts on file and stays under the chat limit', () => {
  const ws = emptyWorkspace();
  ws.profile = { ...ws.profile, intended: 'Physics', residency: 'TX' };
  const c = { ...college('alpha'), research: { ...curated, facts: Array.from({ length: 300 }, (_, i) => fact('notes', `long note ${i} `.repeat(4))) } };
  const p = R.researchPrompt(c, ws);
  assert.match(p, /Research alpha College \[alpha\] for this student \(intended major Physics, resident of TX/);
  assert.match(p, /Already on file/);
  assert.ok(p.length < 8000);
  assert.match(R.researchPrompt(college('beta'), ws), /from scratch/);
});

test('a complete curated file checked in the last two weeks needs no AI step', () => {
  const ws = emptyWorkspace();
  ws.colleges = [college('alpha')];
  const out = R.importCurated(ws, () => curated, Date.parse('2026-11-27'));
  assert.equal(out.colleges[0].research.complete, true);
  assert.deepEqual(R.researchQueue(out), []);
  const partial = R.importCurated(ws, () => ({ ...curated, complete: false }), Date.parse('2026-11-27'));
  assert.equal(partial.colleges[0].research.complete, false, 'a partial file still gets a step');
});
