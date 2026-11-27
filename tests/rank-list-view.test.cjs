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
const { buildRankListView } = require('../lib/rank-list-view.ts');
const { rankList, officialSchools, rankSummary } = require('../public/hub/rank-list.js');
const careerData = require('../public/data/career-ranking.json');
const official = require('../public/data/official-rankings.json');

const app = (id, name, status = 'planning', round = 'RD') => ({ id, name, status, round });

test('the app List matches the web List order and ranks', () => {
  const apps = [app('g', 'Gotham University'), app('a', 'Arizona State University', 'admitted'), app('c', 'Cornell University', 'committed', 'ED'), app('m', 'University of Michigan', 'in_progress', 'EA')];
  const view = buildRankListView(apps, careerData, official, null);
  const web = rankList(apps, careerData.schools, officialSchools(official), official.extra, null);
  assert.deepEqual(view.rows.map((r) => r.id), web.map((r) => r.app.id));
  assert.equal(view.rows.at(-1).id, 'g');
  assert.equal(view.rows.at(-1).position, null);
  assert.equal(view.rows.at(-1).summary, 'Not ranked');
  assert.deepEqual(view.rows.slice(0, 3).map((r) => r.position), [1, 2, 3]);
  assert.equal(view.rows[0].summary, rankSummary(web[0].ranks).text);
  assert.equal(view.rows[0].average, Math.round(web[0].avg * 10) / 10);
  assert.equal(view.rows.find((r) => r.id === 'c').outcome, 'committed');
  assert.equal(view.rows.find((r) => r.id === 'a').outcome, 'admitted');
  assert.equal(view.rows.find((r) => r.id === 'm').outcome, null);
  assert.match(view.copyText, /Cornell University - ED1/);
});

test('no applications gives an empty list', () => {
  assert.deepEqual(buildRankListView([], careerData, official, null), { rows: [], copyText: '' });
});
