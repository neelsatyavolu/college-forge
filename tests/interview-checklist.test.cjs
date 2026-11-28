const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { emptyWorkspace } = require('../lib/store.ts');
const { SECTIONS, missingFields, firstIncomplete, startInterview } = require('../lib/interview-checklist.ts');

function filled() {
  const ws = emptyWorkspace();
  ws.applicant = { ...ws.applicant, name: 'Sam Rivera', gpaUnweighted: '3.8', gpaScale: '4.0' };
  ws.profile = { ...ws.profile, hs: 'Lincoln High', gradYear: 2027, intended: 'Biology', residency: 'OH' };
  ws.profile.testing = { ...ws.profile.testing, sat: '1400' };
  ws.profile.activities = [{ rank: 1, name: 'Robotics', type: 'Academic', role: 'Build lead', hpw: '10', desc: 'Led the build team of 12 and designed the drivetrain for our regional entry' }];
  ws.onboarding = {
    completed: false,
    listPrefs: { ambition: 'balanced', settings: ['suburban'], size: 'any', regions: ['any'], notes: '', budget: '30-50', needAid: true, ed: 'maybe', ambitionChosen: true, suppCount: 6, noSuppCount: 2, citizenship: 'us', incomeBracket: '48-75' },
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
  assert.deepEqual(missingFields(ws, 'basics'), ['name', 'graduation year', 'intended major (or "Undecided")', 'state of residence', 'citizenship (or not sure)']);
});

test('a fully answered workspace has nothing left', () => {
  assert.equal(firstIncomplete(filled()), null);
});

test('Codex-style 0 and empty strings count as missing', () => {
  const ws = filled();
  ws.profile = { ...ws.profile, gradYear: 0, hs: '' };
  assert.deepEqual(missingFields(ws, 'basics'), ['graduation year'], 'the high school name is optional');
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
  assert.deepEqual(missingFields(ws, 'testing'), ["SAT, ACT, test-optional, or a note that they haven't tested yet"]);
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
  ws.onboarding.listPrefs = { ...ws.onboarding.listPrefs, budget: undefined, needAid: undefined, incomeBracket: undefined };
  assert.deepEqual(missingFields(ws, 'money'), ['yearly budget', 'need-based aid yes/no', 'family income range (or not sure)']);
  ws.onboarding.listPrefs = { ...ws.onboarding.listPrefs, budget: 'unsure', needAid: false, incomeBracket: 'unsure' };
  assert.deepEqual(missingFields(ws, 'money'), [], 'not sure is an answer');
});

test('deep needs three answers', () => {
  const ws = filled();
  ws.onboarding.interview = { ...ws.onboarding.interview, deep: [{ prompt: 'q', answer: 'a' }] };
  assert.equal(firstIncomplete(ws), 'deep');
  assert.deepEqual(missingFields(ws, 'deep'), ['2 more deeper answers']);
});

test('the list plan needs the mix, both counts and the ED stance; zero quick schools is an answer', () => {
  const ws = filled();
  ws.onboarding.listPrefs = { ...ws.onboarding.listPrefs, ambitionChosen: undefined, suppCount: undefined, noSuppCount: undefined, ed: undefined };
  assert.deepEqual(missingFields(ws, 'early'), ['reach / target / likely mix', 'how many schools with supplements', 'how many schools without supplements', 'Early Decision stance']);
  ws.onboarding.listPrefs = { ...ws.onboarding.listPrefs, ambitionChosen: true, suppCount: 7, noSuppCount: 0, ed: 'no' };
  assert.deepEqual(missingFields(ws, 'early'), []);
});

test('international students are not asked for a state', () => {
  const ws = filled();
  ws.profile = { ...ws.profile, residency: '' };
  assert.deepEqual(missingFields(ws, 'basics'), ['state of residence']);
  ws.onboarding.listPrefs = { ...ws.onboarding.listPrefs, citizenship: 'international' };
  assert.deepEqual(missingFields(ws, 'basics'), []);
});

test('a student who has not tested yet can finish the testing section', () => {
  const { emptyWorkspace } = require('../lib/store.ts');
  const C = require('../lib/interview-checklist.ts');
  const { isNotYetTestedNote, isTestOptionalNote } = require('../lib/colleges.ts');
  const ws = emptyWorkspace();
  assert.ok(C.missingFields(ws, 'testing').length, 'nothing given yet');
  ws.applicant.satNote = 'Not taken yet: SAT in March, expects about 1400';
  assert.deepEqual(C.missingFields(ws, 'testing'), []);
  for (const n of ["haven't taken the SAT", 'taking the ACT in April', 'SAT scheduled for March', 'planning to take the SAT']) assert.equal(isNotYetTestedNote(n), true, n);
  assert.equal(isTestOptionalNote('Not taken yet: SAT in March'), false, 'not the same as applying without scores');
});

test('a GPA needs the high school grading scale it came from', () => {
  const ws = filled();
  delete ws.applicant.gpaScale;
  assert.equal(firstIncomplete(ws), 'school');
  assert.match(missingFields(ws, 'school').join(), /grading scale/);
});

test('the top three activities need a role, hours and what the student did', () => {
  const { thinActivities } = require('../lib/interview-checklist.ts');
  const ws = filled();
  ws.profile.activities = [
    { rank: 1, name: 'Robotics', type: 'Academic', role: 'Build lead', hpw: '10', desc: 'Led the build team of 12 and designed the drivetrain' },
    { rank: 2, name: 'Debate', type: 'Club', role: 'Member', hpw: '', desc: 'Debate' },
    { rank: 3, name: 'Piano', type: 'Music', desc: 'Played piano' },
    { rank: 4, name: 'Chess', type: 'Club' },
  ];
  assert.deepEqual(thinActivities(ws.profile.activities), ['Debate', 'Piano']);
  assert.match(missingFields(ws, 'activities').join(), /details \(role, hours a week, what they did\) for Debate, Piano/);
  ws.onboarding.interview = { ...ws.onboarding.interview, activityDetailsDeclined: true };
  assert.deepEqual(missingFields(ws, 'activities'), []);
});
