const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { emptyWorkspace } = require('../lib/store.ts');
const { suggestMajors, INTERESTS, BROAD_SHARE } = require('../lib/major-finder.ts');
const T = require('../lib/interview-tools.ts');
const { toolAllowed } = require('../lib/tool-policy.ts');
const career = require('../public/data/career-ranking.json');

const ws = (courses = [], aps = [], activities = []) => {
  const w = emptyWorkspace();
  w.profile.intended = 'Undecided';
  w.profile.coursework = { aps: courses, honors: [], senior: [] };
  w.profile.testing.aps = aps;
  w.profile.activities = activities.map((name, i) => ({ rank: i + 1, name, type: 'Club' }));
  return w;
};

test('only suggests majors most colleges offer', () => {
  const all = suggestMajors(ws(), Object.keys(INTERESTS), [], 50);
  assert.ok(all.length > 5);
  for (const m of all) {
    const offered = career.schools.filter((s) => s.tracks?.[m.key]).length;
    assert.ok(offered / career.schools.length >= BROAD_SHARE, `${m.key} is niche`);
  }
  assert.equal(all.some((m) => ['legal', 'crim', 'engtech', 'nursing'].includes(m.key)), false);
});

test('interests decide the field, courses break the tie', () => {
  const stem = ws(['AP Physics C', 'AP Calculus BC'], [{ course: 'Physics C: Mechanics', score: '5' }], ['Robotics']);
  const top = suggestMajors(stem, ['build', 'science'], []);
  assert.equal(top[0].key, 'eng');
  assert.equal(top[0].readiness, 'strong');
  assert.ok(top[0].evidence.includes('Robotics'));
  assert.ok(top[0].evidence.some((e) => /AP Physics C: Mechanics \(5\)/.test(e)));
});

test('every suggestion matches at least one interest', () => {
  for (const m of suggestMajors(ws(), ['writing'], [])) assert.ok(m.matches.length > 0);
});

test('dislikes push majors down', () => {
  const liked = suggestMajors(ws(), ['numbers'], []).map((m) => m.key);
  const avoided = suggestMajors(ws(), ['numbers'], ['money']).map((m) => m.key);
  assert.ok(liked.includes('econ'));
  assert.ok(avoided.indexOf('econ') === -1 || avoided.indexOf('econ') > liked.indexOf('econ'));
});

test('competitive majors carry a caution, stronger without preparation', () => {
  const none = suggestMajors(ws(), ['build', 'numbers'], [], 50).find((m) => m.key === 'cs');
  const ready = suggestMajors(ws(['AP Computer Science A']), ['build', 'numbers'], [], 50).find((m) => m.key === 'cs');
  assert.match(none.caution, /competitive at \d+ of the \d+ colleges/);
  assert.match(none.caution, /don't show preparation/);
  assert.doesNotMatch(ready.caution, /don't show preparation/);
  assert.ok(ready.score > none.score);
});

test('unknown interest keys are ignored', () => {
  assert.deepEqual(suggestMajors(ws(), ['astrology', 7], []).map((m) => m.key), suggestMajors(ws(), [], []).map((m) => m.key));
});

test('suggest_majors runs in onboarding and does not end the turn', async () => {
  let state = ws(['AP Biology']);
  const tools = T.makeInterviewTools(async (fn) => (state = fn(state)), async () => state, () => {});
  const out = JSON.parse(await tools.execute('suggest_majors', JSON.stringify({ interests: ['life'], dislikes: [] })));
  assert.equal(out.majors[0].key, 'bio');
  assert.equal(tools.endTurn(), false);
  assert.equal(toolAllowed('onboarding', 'suggest_majors'), true);
});

test('the interest options fit an ask_question tile', () => {
  const keys = Object.keys(INTERESTS);
  assert.ok(keys.length <= 12, 'ask_question keeps 12 options');
  for (const label of Object.values(INTERESTS)) assert.ok(label.length <= 80);
});
