const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.join(__dirname, '..', request.slice(2)) + '.ts' : request, ...args); };
process.env.CF_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-essay-schools-'));
delete process.env.BLOB_READ_WRITE_TOKEN;

const { NextRequest } = require('next/server');
const store = require('../lib/store.ts');
const tools = require('../lib/essay-tools.ts');
const { checkWorkspacePatch, applyWorkspacePatch } = require('../lib/workspace-patch.ts');
const { makeHubTools } = require('../lib/hub-tools.ts');
const { parentView } = require('../lib/parent-view.ts');
const { snapshot } = require('../lib/hub-context.ts');
const { planReadiness } = require('../lib/plan-readiness.ts');
const plan = require('../public/hub/essay-archetypes.js');
const workspaceRoute = require('../app/api/workspace/route.ts');

const essay = (id, limit = 250) => ({ id, label: id, prompt: 'p', limit, unit: 'words', starter: '' });
const college = (slug, name) => ({ slug, name, short: name, origin: 'user' });
/** A workspace with Rice, Duke and two UC campuses on the list, each with supplements. */
function sample(over = {}) {
  const ws = store.emptyWorkspace();
  return {
    ...ws,
    colleges: [college('rice-university', 'Rice'), college('duke-university', 'Duke'), college('university-of-california-davis', 'UC Davis'), college('ucla', 'UCLA')],
    essays: {
      commonApp: ws.essays.commonApp,
      supplements: { 'rice-university': [essay('rice-1'), essay('rice-2')], 'duke-university': [essay('duke-1')], 'uc-application': [essay('uc-piq-1', 350)] },
    },
    essayDrafts: { 'rice-1': 'my rice draft' },
    ...over,
  };
}

test('essaySchools accepts only false or null for real-looking school keys, never the Common App', () => {
  assert.equal(checkWorkspacePatch({ essaySchools: { 'rice-university': false, 'uc-application': null } }).ok, true);
  assert.equal(checkWorkspacePatch({ essaySchools: { 'rice-university': true } }).ok, false, 'true is the default and is never stored');
  assert.equal(checkWorkspacePatch({ essaySchools: { 'rice-university': 'no' } }).ok, false);
  assert.equal(checkWorkspacePatch({ essaySchools: { 'bad key!': false } }).ok, false);
  assert.equal(checkWorkspacePatch({ essaySchools: ['rice-university'] }).ok, false);
  assert.equal(checkWorkspacePatch({ essaySchools: null }).ok, false);
  assert.match(tools.checkEssaySchools({ common: false }).error, /Common App/);
  const many = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`s${i}`, false]));
  assert.equal(checkWorkspacePatch({ essaySchools: many }).ok, false);
});

test('opting a school out stores only that school; null puts it back; drafts stay', () => {
  let ws = applyWorkspacePatch(sample(), { essaySchools: { 'rice-university': false, 'uc-application': false } });
  assert.deepEqual(ws.essaySchools, { 'rice-university': false, 'uc-application': false });
  ws = applyWorkspacePatch(ws, { essaySchools: { 'uc-application': null } });
  assert.deepEqual(ws.essaySchools, { 'rice-university': false });
  assert.equal(ws.essayDrafts['rice-1'], 'my rice draft');
  assert.equal(ws.essays.supplements['rice-university'].length, 2, 'prompts are kept too');
});

test('agents see an opted-out school\'s essays as hidden and not_writing', () => {
  const ws = sample({ essaySchools: { 'rice-university': false } });
  const list = tools.essayList(ws);
  const by = (id) => list.find((e) => e.id === id);
  assert.equal(by('rice-1').hidden, true);
  assert.equal(by('rice-1').not_writing, true);
  assert.equal(by('duke-1').hidden, false);
  assert.equal(by('duke-1').not_writing, undefined);
  assert.equal(by('ca-ps-1').not_writing, undefined, 'the Common App is always written');
  assert.equal(tools.essayView(ws, 'rice-2').not_writing, true);
  assert.equal(tools.essayView(ws, 'rice-1').draft, 'my rice draft', 'the draft is still readable');
});

test('writing totals and visible schools leave opted-out schools out', () => {
  const groups = [
    { key: 'common', kind: 'common', items: [essay('ca-ps-1', 650)] },
    { key: 'rice-university', kind: 'school', items: [essay('rice-1'), essay('rice-2')] },
    { key: 'uc-application', kind: 'uc', items: [{ ...essay('uc-piq-1', 350), chooseGroup: 'uc', choose: 4 }] },
  ];
  assert.equal(plan.writingTotals(groups, {}, {}).required, 4);
  const t = plan.writingTotals(groups, {}, {}, { essaySchools: { 'rice-university': false } });
  assert.deepEqual([t.required, t.wordsRequired], [2, 1000]);
  assert.equal(plan.writingTotals(groups, {}, {}, { essaySchools: { common: false } }).required, 4, 'the Common App never drops out');
  assert.equal(plan.isSchoolSkipped('rice-university', { essaySchools: { 'rice-university': false } }), true);
  assert.equal(plan.isSchoolSkipped('rice-university', {}), false);
});

test('the pick list has one row per Essays group, with UC campuses together', () => {
  const rows = plan.essaySchools(sample().colleges, { essaySchools: { 'duke-university': false } });
  assert.deepEqual(rows.map((r) => [r.key, r.writing]), [['rice-university', true], ['duke-university', false], ['uc-application', true]]);
  assert.equal(rows[2].subtitle, 'UC Davis · UCLA');
  assert.equal(plan.essayGroupKey({ slug: 'ucla', name: 'UCLA' }), 'uc-application');
  assert.equal(plan.essayGroupKey({ slug: 'rice-university', name: 'Rice' }), 'rice-university');
});

test('parents, the copilot snapshot and the plan leave opted-out schools out', () => {
  const ws = sample({ essaySchools: { 'rice-university': false } });
  const view = parentView(ws, 'full');
  assert.equal(view.essays.supplements['rice-university'], undefined);
  assert.ok(view.essays.supplements['duke-university']);
  assert.equal(view.essayDrafts['rice-1'], undefined, 'an opted-out school\'s drafts never leave the server');
  const snap = snapshot(ws);
  assert.match(snap, /Not writing supplements for: rice-university/);
  assert.doesNotMatch(snap, /rice-university\(2\)/);
  assert.equal(planReadiness(ws).essays.placeholder.includes('rice-university'), false);
});

test('turning off the UC Application also covers supplements saved under a campus slug', () => {
  const base = sample();
  const ws = { ...base, essays: { ...base.essays, supplements: { ...base.essays.supplements, ucla: [essay('ucla-extra')] } }, essayDrafts: { 'ucla-extra': 'campus draft' }, essaySchools: { 'uc-application': false } };
  assert.equal(tools.essayList(ws).find((e) => e.id === 'ucla-extra').not_writing, true);
  assert.equal(parentView(ws, 'full').essayDrafts['ucla-extra'], undefined);
});

test('two list rows on one slug give one pick row', () => {
  const rows = plan.essaySchools([college('rice-university', 'Rice'), college('rice-university', 'Rice University')], {});
  assert.deepEqual(rows.map((r) => r.key), ['rice-university']);
});

const ID = 'essay-schools-route';
const patch = (body) => workspaceRoute.PATCH(new NextRequest('http://localhost/api/workspace', {
  method: 'PATCH', headers: { cookie: `cf_workspace=${ID}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
}));

test('PATCH saves and clears essaySchools and refuses bad values', async () => {
  await store.getWorkspace(ID);
  assert.equal((await patch({ essaySchools: { 'rice-university': false } })).status, 200);
  assert.deepEqual((await store.getWorkspace(ID)).essaySchools, { 'rice-university': false });
  const bad = await patch({ essaySchools: { 'rice-university': true } });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /false or null/);
  assert.equal((await patch({ essaySchools: { 'rice-university': null } })).status, 200);
  assert.deepEqual((await store.getWorkspace(ID)).essaySchools, {});
});

test('the copilot stops and starts writing for a school through set_essay_visibility', async () => {
  const wsId = 'essay-schools-copilot';
  await store.updateWorkspace(wsId, () => sample());
  const h = makeHubTools(wsId);
  assert.match(await h.executeTool('set_essay_visibility', JSON.stringify({ not_writing_for: ['rice-university'] })), /not writing for: rice-university/);
  assert.deepEqual((await store.getWorkspace(wsId)).essaySchools, { 'rice-university': false });
  assert.match(await h.executeTool('set_essay_visibility', JSON.stringify({ not_writing_for: ['nowhere'] })), /No school on the Essays tab has the key "nowhere"/);
  const listed = JSON.parse(await h.executeTool('list_essays', '{}'));
  assert.equal(listed.essays.find((e) => e.id === 'rice-1').not_writing, true);
  await h.executeTool('set_essay_visibility', JSON.stringify({ writing_for: ['rice-university'] }));
  const ws = await store.getWorkspace(wsId);
  assert.deepEqual(ws.essaySchools, {});
  assert.equal(ws.essayDrafts['rice-1'], 'my rice draft');
});
