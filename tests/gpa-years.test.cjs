const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { gpaFromYears, withGpaFromYears } = require('../lib/gpa-years.ts');

test('a rise of 0.15 or more across high school is an upward trend; 10th-11th is the recent GPA', () => {
  assert.deepEqual(gpaFromYears({ 9: '3.3', 10: '3.6', 11: '3.9' }), { trend: 'up', recent: '3.75' });
  assert.deepEqual(gpaFromYears({ 9: '3.8', 10: '3.8', 11: '3.85' }), { trend: 'steady', recent: '3.83' });
  assert.deepEqual(gpaFromYears({ 9: '3.9', 10: '3.6', 11: '3.5' }), { trend: 'down', recent: '3.55' });
  assert.deepEqual(gpaFromYears({ 10: '3.4', 11: '3.8' }), { trend: 'up', recent: '3.6' });
  assert.equal(gpaFromYears({ 11: '3.9' }), null, 'one year is no trend');
  assert.equal(gpaFromYears({ 9: '—', 11: '3.9' }), null, 'a cleared year does not count');
  assert.equal(gpaFromYears(undefined), null);
});

test('the yearly GPAs set the stored trend and recent GPA, and nothing else changes without them', () => {
  const ws = { applicant: { gpaUnweighted: '3.7', gpaTrend: 'steady', gpaByYear: { 9: '3.3', 10: '3.6', 11: '3.9' } } };
  const next = withGpaFromYears(ws);
  assert.equal(next.applicant.gpaTrend, 'up');
  assert.equal(next.applicant.gpaRecent, '3.75');
  assert.equal(next.applicant.gpaUnweighted, '3.7');
  assert.equal(withGpaFromYears(next), next, 'already in step: the same object');
  const plain = { applicant: { gpaUnweighted: '3.7', gpaTrend: 'up' } };
  assert.equal(withGpaFromYears(plain), plain);
});

test('PATCH merges years, clears one with a dash, and the saved workspace carries the derived trend', async () => {
  const path = require('node:path'); const os = require('node:os'); const Module = require('node:module');
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.join(__dirname, '..', request.slice(2)) + '.ts' : request, ...args); };
  process.env.CF_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-gpa-years-'));
  delete process.env.BLOB_READ_WRITE_TOKEN;
  const { NextRequest } = require('next/server');
  const store = require('../lib/store.ts');
  const route = require('../app/api/workspace/route.ts');
  const ID = 'gpa-years-route';
  const patch = (body) => route.PATCH(new NextRequest('http://localhost/api/workspace', { method: 'PATCH', headers: { cookie: `cf_workspace=${ID}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  await store.getWorkspace(ID);
  assert.equal((await patch({ applicant: { gpaByYear: { 9: '3.3', 10: '3.6' } } })).status, 200);
  assert.equal((await patch({ applicant: { gpaByYear: { 11: '3.9' } } })).status, 200);
  let ws = await store.getWorkspace(ID);
  assert.deepEqual(ws.applicant.gpaByYear, { 9: '3.3', 10: '3.6', 11: '3.9' });
  assert.equal(ws.applicant.gpaTrend, 'up');
  assert.equal(ws.applicant.gpaRecent, '3.75');
  assert.equal((await patch({ applicant: { gpaByYear: { 9: '5.2' } } })).status, 400, 'out of range');
  await patch({ applicant: { gpaByYear: { 9: '—' } } });
  ws = await store.getWorkspace(ID);
  assert.deepEqual(ws.applicant.gpaByYear, { 10: '3.6', 11: '3.9' });
  assert.equal(ws.applicant.gpaTrend, 'up');
});
