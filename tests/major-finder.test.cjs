const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { emptyWorkspace } = require('../lib/store.ts');
const { suggestMajors, interestsFromText, INTERESTS, ACTIVITIES, BROAD_SHARE } = require('../lib/major-finder.ts');
const T = require('../lib/interview-tools.ts');
const { toolAllowed } = require('../lib/tool-policy.ts');
const career = require('../public/data/career-ranking.json');

const ws = (courses = [], aps = [], activities = []) => {
  const w = emptyWorkspace();
  w.profile.intended = 'Undecided';
  w.profile.coursework = { aps: courses, honors: [], senior: [] };
  w.profile.testing.aps = aps;
  w.profile.activities = activities.map((name, i) => ({ rank: i + 1, name, type: 'Club', role: 'Writer', hpw: '4', desc: 'Wrote and edited stories for the school paper every week' }));
  return w;
};

test('only suggests majors most colleges offer', () => {
  const all = suggestMajors(ws(), { interests: Object.keys(INTERESTS), dislikes: [] }, 50);
  assert.ok(all.length > 5);
  for (const m of all) {
    const offered = career.schools.filter((s) => s.tracks?.[m.key]).length;
    assert.ok(offered / career.schools.length >= BROAD_SHARE, `${m.key} is niche`);
  }
  assert.equal(all.some((m) => ['legal', 'crim', 'engtech', 'nursing'].includes(m.key)), false);
});

test('interests decide the field, courses break the tie', () => {
  const stem = ws(['AP Physics C', 'AP Calculus BC'], [{ course: 'Physics C: Mechanics', score: '5' }], ['Robotics']);
  const top = suggestMajors(stem, { interests: ['build', 'science'], dislikes: [] });
  assert.equal(top[0].key, 'eng');
  assert.equal(top[0].readiness, 'strong');
  assert.ok(top[0].evidence.includes('Robotics'));
  assert.ok(top[0].evidence.some((e) => /AP Physics C: Mechanics \(5\)/.test(e)));
});

test('every suggestion matches at least one interest', () => {
  for (const m of suggestMajors(ws(), { interests: ['writing'], dislikes: [] })) assert.ok(m.matches.length > 0);
});

test('dislikes push majors down', () => {
  const liked = suggestMajors(ws(), { interests: ['numbers'], dislikes: [] }).map((m) => m.key);
  const avoided = suggestMajors(ws(), { interests: ['numbers'], dislikes: ['money'] }).map((m) => m.key);
  assert.ok(liked.includes('econ'));
  assert.ok(avoided.indexOf('econ') === -1 || avoided.indexOf('econ') > liked.indexOf('econ'));
});

test('competitive majors carry a caution, stronger without preparation', () => {
  const none = suggestMajors(ws(), { interests: ['build', 'numbers'], dislikes: [] }, 50).find((m) => m.key === 'cs');
  const ready = suggestMajors(ws(['AP Computer Science A']), { interests: ['build', 'numbers'], dislikes: [] }, 50).find((m) => m.key === 'cs');
  assert.match(none.caution, /competitive at \d+ of the \d+ colleges/);
  assert.match(none.caution, /don't show preparation/);
  assert.doesNotMatch(ready.caution, /don't show preparation/);
  assert.ok(ready.score > none.score);
});

test('unknown interest keys are ignored', () => {
  assert.deepEqual(suggestMajors(ws(), { interests: ['astrology', 7], dislikes: [] }).map((m) => m.key), suggestMajors(ws(), { interests: [], dislikes: [] }).map((m) => m.key));
});

test('suggest_majors runs in onboarding and does not end the turn', async () => {
  let state = ws(['AP Biology']);
  const tools = T.makeInterviewTools(async (fn) => (state = fn(state)), async () => state, () => {});
  const out = JSON.parse(await tools.execute('suggest_majors', JSON.stringify({ interests: ['life'], dislikes: [], said: '' })));
  assert.equal(out.majors[0].key, 'bio');
  assert.equal(tools.endTurn(), false);
  assert.equal(toolAllowed('onboarding', 'suggest_majors'), true);
});

test('the interest options fit an ask_question tile', () => {
  const keys = Object.keys(INTERESTS);
  assert.ok(keys.length <= 12, 'ask_question keeps 12 options');
  for (const label of [...Object.values(INTERESTS), ...Object.values(ACTIVITIES)]) assert.ok(label.length <= 80);
  assert.deepEqual(Object.keys(ACTIVITIES), keys);
});

test('loose answers are read: "i like reading and smth"', () => {
  assert.deepEqual(interestsFromText('i like reading and smth'), { likes: ['writing'], dislikes: [] });
  const top = suggestMajors(ws(), { interests: [], dislikes: [], said: 'i like reading and smth' });
  assert.equal(top[0].matches.length > 0, true);
  assert.ok(['english', 'history', 'lang', 'polisci', 'comm'].includes(top[0].key));
});

test('a dislike in the same sentence counts as a dislike', () => {
  assert.deepEqual(interestsFromText('drawing is fun but i hate coding'), { likes: ['create'], dislikes: ['build'] });
  assert.deepEqual(interestsFromText("idk, animals maybe. i don't really like math"), { likes: ['life'], dislikes: ['numbers'] });
});

test('words inside other words are not cues', () => {
  assert.deepEqual(interestsFromText('somebody already started a party, label it ready'), { likes: [], dislikes: [] });
});

test('nothing to go on ranks by preparation alone', () => {
  const top = suggestMajors(ws(['AP Biology', 'Honors Chemistry'], [{ course: 'Biology', score: '5' }]), { said: 'idk' });
  assert.equal(top[0].key, 'bio');
});

test('suggest_majors reports what it heard', async () => {
  let state = ws();
  const tools = T.makeInterviewTools(async (fn) => (state = fn(state)), async () => state, () => {});
  const out = JSON.parse(await tools.execute('suggest_majors', JSON.stringify({ interests: [], dislikes: [], said: 'i like reading and smth' })));
  assert.deepEqual(out.heard.likes, [INTERESTS.writing]);
});

const { missingFields, isUndecided } = require('../lib/interview-checklist.ts');

test('an undecided student is offered the quiz before the interview moves past activities', async () => {
  let state = ws([], [], ['Newspaper']);
  assert.match(missingFields(state, 'activities').join(), /find-your-major/);
  const tools = T.makeInterviewTools(async (fn) => (state = fn(state)), async () => state, () => {});
  await tools.execute('suggest_majors', JSON.stringify({ interests: [], dislikes: [], said: 'i like reading and smth' }));
  assert.deepEqual(missingFields(state, 'activities'), []);
});

test('declining the quiz also clears it, and a named major never needs it', async () => {
  let state = ws([], [], ['Newspaper']);
  const tools = T.makeInterviewTools(async (fn) => (state = fn(state)), async () => state, () => {});
  await tools.execute('set_interview_facts', JSON.stringify({ majorFinder: 'declined' }));
  assert.deepEqual(missingFields(state, 'activities'), []);
  const named = ws([], [], ['Newspaper']);
  named.profile.intended = 'Economics';
  assert.deepEqual(missingFields(named, 'activities'), []);
  for (const t of ['Undecided', 'no clue tbh', 'not sure', 'idk', '']) assert.equal(isUndecided(t), true, t);
  for (const t of ['Economics', 'Computer science']) assert.equal(isUndecided(t), false, t);
});
