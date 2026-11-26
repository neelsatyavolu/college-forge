const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2021, esModuleInterop:true, resolveJsonModule:true}}).outputText, file);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request.startsWith('@/')) {
    const base = path.join(__dirname, '..', request.slice(2));
    return resolve.call(this, fs.existsSync(base + '.ts') ? base + '.ts' : base, ...args);
  }
  return resolve.call(this, request, ...args);
};
process.env.SESSION_SECRET = 'test-'.repeat(8); // made up, only signs test cookies
const { NextRequest } = require('next/server');
const data = require('../public/data/career-ranking.json');
const { createRanker, DEFAULT_WEIGHTS } = require('../lib/career-ranking.ts');
const { buildRankingsView, rankingsViewInput, RANKINGS_DEFAULT_FLAGS } = require('../lib/rankings-view.ts');
const { NO_RANKINGS_ME } = require('../lib/rankings-me.ts');
const route = require('../app/api/rankings/view/route.ts');

const input = (v) => rankingsViewInput.parse(v);

test('the app view ranks schools in the same order as the web ranker', () => {
  const view = buildRankingsView(data, NO_RANKINGS_ME, input({}));
  const all = data.meta.majors.filter(m => m.target).map(m => m.key);
  const web = createRanker(data).rank({ track: 'path', ...RANKINGS_DEFAULT_FLAGS, w: DEFAULT_WEIGHTS }, { targets: all, direct: {} });
  assert.equal(view.view, 'path');
  assert.deepEqual(view.targets, all);
  assert.deepEqual(view.rows.map(r => [r.id, r.rank]), web.map(r => [r.s.id, r.rk]));
  assert.equal(view.rows[0].measures.length, 6);
  // A few Forge-only schools have no catalog logo yet.
  assert.ok(view.rows.every(r => r.logo == null || /^\/logos\//.test(r.logo)));
  assert.ok(view.rows.filter(r => r.logo).length >= view.rows.length - 5);
  assert.ok(!view.tabs.some(t => t.id === 'admitted' || t.id === 'ai'));
});

test('a major tab lists schools without that major as missing', () => {
  const cs = buildRankingsView(data, NO_RANKINGS_ME, input({ view: 'cs' }));
  assert.equal(cs.view, 'cs');
  assert.equal(cs.rows.length + cs.missing.length, data.schools.length);
  assert.deepEqual(cs.rows[0].switches, []);
});

test('admitted schools get their own tab and keep their My path rank', () => {
  const ids = data.schools.slice(0, 3).map(s => s.id);
  const me = { ...NO_RANKINGS_ME, workspace: true, schools: ids.map(id => ({ id, major: [], admitted: true })) };
  const view = buildRankingsView(data, me, input({ view: 'admitted' }));
  assert.equal(view.view, 'admitted');
  assert.deepEqual(view.rows.map(r => r.id).sort(), [...ids].sort());
  assert.ok(view.rows.every(r => r.admitted && /^My path /.test(r.notes[0])));
});

test('a student with schools on their list sees only those schools', () => {
  const ids = data.schools.slice(5, 9).map(s => s.id);
  const me = { ...NO_RANKINGS_ME, workspace: true, schools: ids.map((id, i) => ({ id, major: [], admitted: i === 0 })) };
  for (const v of ['path', 'overall', 'cs', 'admitted']) {
    const view = buildRankingsView(data, me, input({ view: v }));
    const shown = [...view.rows.map(r => r.id), ...view.missing.map(n => data.schools.find(s => s.name === n).id)];
    assert.ok(shown.every(id => ids.includes(id)), v);
  }
  const path = buildRankingsView(data, me, input({}));
  assert.deepEqual(path.rows.map(r => r.id).sort(), [...ids].sort());
  assert.match(path.rows[0].rank, /^(T-)?1$/);
  const admitted = buildRankingsView(data, me, input({ view: 'admitted' }));
  assert.match(admitted.rows[0].notes[0], / of 4$/);
});

test('unknown views and targets fall back, and bad settings are refused', async () => {
  const view = buildRankingsView(data, NO_RANKINGS_ME, input({ view: 'nope', targets: ['nope'] }));
  assert.equal(view.view, 'path');
  assert.equal(view.targets.length, data.meta.majors.filter(m => m.target).length);
  const post = (body) => route.POST(new NextRequest('http://localhost/api/rankings/view', { method: 'POST', body }));
  assert.equal((await post('{')).status, 400);
  assert.equal((await post(JSON.stringify({ weights: { pay: 0, wealth: 0, rep: 0, jobs: 0, floor: 0, campus: 0 } }))).status, 400);
  assert.equal((await post('x'.repeat(5000))).status, 413);
  const ok = await post(JSON.stringify({ view: 'overall' }));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).view, 'overall');
});
