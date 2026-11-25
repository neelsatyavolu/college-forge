const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { emptyWorkspace } = require('../lib/store.ts');
const { SECTIONS, missingFields, firstIncomplete, startInterview } = require('../lib/interview-checklist.ts');

function filled() {
  const ws = emptyWorkspace();
  ws.applicant = { ...ws.applicant, name: 'Sam Rivera', gpaUnweighted: '3.8' };
  ws.profile = { ...ws.profile, hs: 'Lincoln High', gradYear: 2027, intended: 'Biology', residency: 'OH' };
  ws.profile.testing = { ...ws.profile.testing, sat: '1400' };
  ws.profile.activities = [{ rank: 1, name: 'Robotics', type: 'Academic' }];
  ws.onboarding = {
    completed: false,
    listPrefs: { ambition: 'balanced', settings: ['suburban'], size: 'any', regions: ['any'], notes: '', budget: '30-50', needAid: true, ed: 'maybe' },
    interview: { ...startInterview(1), deep: [1, 2, 3].map((i) => ({ prompt: `q${i}`, answer: `a${i}` })) },
  };
  return ws;
}

test('sections run in the agreed order', () => {
  assert.deepEqual(SECTIONS, ['basics', 'school', 'testing', 'activities', 'campus', 'money', 'early', 'deep']);
});

test('an empty workspace starts at basics with every basics field missing', () => {
  const ws = emptyWorkspace();
  assert.equal(firstIncomplete(ws), 'basics');
  assert.deepEqual(missingFields(ws, 'basics'), ['name', 'high school', 'graduation year', 'intended major (or "Undecided")', 'state of residence']);
});

test('a fully answered workspace has nothing left', () => {
  assert.equal(firstIncomplete(filled()), null);
});

test('Codex-style 0 and empty strings count as missing', () => {
  const ws = filled();
  ws.profile = { ...ws.profile, gradYear: 0, hs: '' };
  assert.deepEqual(missingFields(ws, 'basics'), ['high school', 'graduation year']);
});

test('school accepts a read transcript instead of a GPA', () => {
  const ws = filled();
  ws.applicant = { ...ws.applicant, gpaUnweighted: '—' };
  assert.deepEqual(missingFields(ws, 'school'), ['unweighted GPA or a transcript']);
  ws.uploads = [{ name: 'transcript.pdf', chars: 900, uploadedAt: 1 }];
  ws.profile = { ...ws.profile, coursework: { honors: [], aps: ['AP Biology'], senior: [] } };
  assert.deepEqual(missingFields(ws, 'school'), []);
});

test('testing is satisfied by SAT, ACT, or a test-optional note', () => {
  const ws = filled();
  ws.profile.testing = { sat: '—', satNote: '', aps: [] };
  ws.applicant = { ...ws.applicant, sat: '—' };
  assert.deepEqual(missingFields(ws, 'testing'), ['SAT, ACT, or test-optional']);
  ws.profile.testing = { sat: '—', satNote: 'Test optional', aps: [] };
  assert.deepEqual(missingFields(ws, 'testing'), []);
});

test('activities accept an explicit none-yet', () => {
  const ws = filled();
  ws.profile = { ...ws.profile, activities: [] };
  assert.deepEqual(missingFields(ws, 'activities'), ['at least one activity (or "none yet")']);
  ws.onboarding.interview = { ...ws.onboarding.interview, noActivities: true };
  assert.deepEqual(missingFields(ws, 'activities'), []);
});

test('money needs a budget and a yes/no on need-based aid', () => {
  const ws = filled();
  ws.onboarding.listPrefs = { ...ws.onboarding.listPrefs, budget: undefined, needAid: undefined };
  assert.deepEqual(missingFields(ws, 'money'), ['yearly budget', 'need-based aid yes/no']);
});

test('deep needs three answers', () => {
  const ws = filled();
  ws.onboarding.interview = { ...ws.onboarding.interview, deep: [{ prompt: 'q', answer: 'a' }] };
  assert.equal(firstIncomplete(ws), 'deep');
  assert.deepEqual(missingFields(ws, 'deep'), ['2 more deeper answers']);
});
