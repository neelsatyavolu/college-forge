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
process.env.CF_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-essay-visibility-'));
delete process.env.BLOB_READ_WRITE_TOKEN;

const { NextRequest } = require('next/server');
const store = require('../lib/store.ts');
const tools = require('../lib/essay-tools.ts');
const { checkWorkspacePatch } = require('../lib/workspace-patch.ts');
const { makeHubTools } = require('../lib/hub-tools.ts');
const workspaceRoute = require('../app/api/workspace/route.ts');

const ID = 'essay-visibility-route';
const patch = (body, cookie = `cf_workspace=${ID}`) => workspaceRoute.PATCH(new NextRequest('http://localhost/api/workspace', {
  method: 'PATCH', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body),
}));

test('essayHidden accepts only true or null, real-looking ids and at most 500 keys', () => {
  assert.equal(checkWorkspacePatch({ essayHidden: { 'ca-ps-1': true, 'rice-supp-1': null } }).ok, true);
  assert.equal(checkWorkspacePatch({ essayHidden: { 'ca-ps-1': false } }).ok, false);
  assert.equal(checkWorkspacePatch({ essayHidden: { 'ca-ps-1': 'yes' } }).ok, false);
  assert.equal(checkWorkspacePatch({ essayHidden: { 'bad id!': true } }).ok, false);
  assert.equal(checkWorkspacePatch({ essayHidden: ['ca-ps-1'] }).ok, false);
  const many = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`e${i}`, true]));
  assert.equal(checkWorkspacePatch({ essayHidden: many }).ok, false);
  assert.equal(checkWorkspacePatch({ commonAppPrompt: 5 }).ok, false);
});

test('only a Common App personal essay prompt can be chosen', () => {
  const ws = store.emptyWorkspace();
  assert.equal(tools.checkCommonAppPrompt('ca-ps-3', ws).ok, true);
  assert.equal(tools.checkCommonAppPrompt(null, ws).ok, true);
  assert.equal(tools.checkCommonAppPrompt('ca-additional-info', ws).ok, false, 'not in the choose-one set');
  assert.equal(tools.checkCommonAppPrompt('uc-piq-1', ws).ok, false);
});

test('agents see hidden and chosen essays', () => {
  const ws = { ...store.emptyWorkspace(), commonAppPrompt: 'ca-ps-2', essayHidden: { 'ca-additional-info': true } };
  const list = tools.essayList(ws);
  const by = (id) => list.find((e) => e.id === id);
  assert.equal(by('ca-ps-2').hidden, false);
  assert.equal(by('ca-ps-2').chosen, true);
  assert.equal(by('ca-ps-1').hidden, true, 'an unchosen prompt is out of scope');
  assert.equal(by('ca-additional-info').hidden, true);
  assert.equal(tools.essayView(ws, 'ca-ps-1').hidden, true);
});

test('PATCH saves and clears both fields, refuses bad ones, and keeps drafts', async () => {
  await store.getWorkspace(ID);
  let res = await patch({ essayDraft: { id: 'ca-ps-1', text: 'My draft' }, essayHidden: { 'ca-ps-1': true }, commonAppPrompt: 'ca-ps-4' });
  assert.equal(res.status, 200);
  let ws = await store.getWorkspace(ID);
  assert.deepEqual(ws.essayHidden, { 'ca-ps-1': true });
  assert.equal(ws.commonAppPrompt, 'ca-ps-4');
  assert.equal(ws.essayDrafts['ca-ps-1'], 'My draft');

  res = await patch({ commonAppPrompt: 'uc-piq-1' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Common App/);
  assert.equal((await patch({ essayHidden: { 'ca-ps-1': 'no' } })).status, 400);

  await patch({ essayHidden: { 'ca-ps-1': null }, commonAppPrompt: null });
  ws = await store.getWorkspace(ID);
  assert.deepEqual(ws.essayHidden, {});
  assert.equal(ws.commonAppPrompt, undefined);
  assert.equal(ws.essayDrafts['ca-ps-1'], 'My draft');
});

test('replacing the Common App prompts without the chosen one clears the choice', async () => {
  await patch({ commonAppPrompt: 'ca-ps-6' });
  const kept = store.emptyWorkspace().essays.commonApp.filter((e) => e.id !== 'ca-ps-6');
  assert.equal((await patch({ essays: { commonApp: kept } })).status, 200);
  assert.equal((await store.getWorkspace(ID)).commonAppPrompt, undefined);
});

test('the copilot hides, shows and chooses through set_essay_visibility', async () => {
  const h = makeHubTools('essay-visibility-copilot');
  assert.match(await h.executeTool('set_essay_visibility', JSON.stringify({ hide: ['ca-additional-info'], common_app_prompt: 'ca-ps-5' })), /1 essay hidden; Common App prompt: ca-ps-5/);
  let ws = await store.getWorkspace('essay-visibility-copilot');
  assert.equal(ws.commonAppPrompt, 'ca-ps-5');
  assert.match(await h.executeTool('set_essay_visibility', JSON.stringify({ hide: ['nope'] })), /No essay has the id "nope"/);
  assert.match(await h.executeTool('set_essay_visibility', JSON.stringify({ common_app_prompt: 'ca-additional-info' })), /Common App/);
  await h.executeTool('set_essay_visibility', JSON.stringify({ show: ['ca-additional-info'], common_app_prompt: 'clear' }));
  ws = await store.getWorkspace('essay-visibility-copilot');
  assert.deepEqual(ws.essayHidden, {});
  assert.equal(ws.commonAppPrompt, undefined);
  const listed = JSON.parse(await h.executeTool('list_essays', '{}'));
  assert.ok(listed.essays.every((e) => e.hidden === false));
});

test('essayOption saves which option of a choose-one prompt the student answers, and clears with null', async () => {
  assert.equal(tools.checkEssayOption({ 'wake-supp-2': 0 }).ok, true);
  assert.equal(tools.checkEssayOption({ 'wake-supp-2': -1 }).ok, false);
  assert.equal(tools.checkEssayOption({ 'wake-supp-2': 1.5 }).ok, false);
  assert.equal(tools.checkEssayOption({ 'wake-supp-2': 20 }).ok, false);
  assert.equal(tools.checkEssayOption({ 'bad id!': 0 }).ok, false);
  await store.getWorkspace(ID);
  let res = await patch({ essayOption: { 'wake-supp-2': 2 } });
  assert.equal(res.status, 200);
  assert.deepEqual((await store.getWorkspace(ID)).essayOption, { 'wake-supp-2': 2 });
  assert.equal((await patch({ essayOption: { 'wake-supp-2': 'two' } })).status, 400);
  await patch({ essayOption: { 'wake-supp-2': null } });
  assert.deepEqual((await store.getWorkspace(ID)).essayOption, {});
});
