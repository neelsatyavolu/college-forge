const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ts = require('typescript');
const Module = require('node:module');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.join(__dirname, '..', request.slice(2)) + '.ts' : request, ...args); };
process.env.CF_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-copilot-tools-'));
delete process.env.BLOB_READ_WRITE_TOKEN;
const { getWorkspace, updateWorkspace } = require('../lib/store.ts');
const { makeHubTools } = require('../lib/hub-tools.ts');

test('the copilot has the tracker, sharing, research and settings tools, each once', () => {
  const names = makeHubTools('copilot-names').tools.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, 'no duplicate tool names');
  for (const n of ['list_applications', 'add_application', 'update_application', 'record_decision', 'reveal_decision', 'add_follow_up', 'complete_follow_up', 'add_flag', 'resolve_flag', 'upcoming_dates', 'check_portals', 'create_share_link', 'revoke_share_link', 'get_notes', 'set_essay_status', 'set_portal_settings', 'set_school_research']) {
    assert.ok(names.includes(n), `missing ${n}`);
  }
  assert.ok(!names.includes('complete_onboarding'), 'onboarding completion stays with the setup flow');
});

test('tracker tools run through the copilot', async () => {
  const h = makeHubTools('copilot-tracker');
  const added = JSON.parse(await h.executeTool('add_application', JSON.stringify({ school: 'Rice University', status: 'in_progress', round: 'RD' })));
  assert.equal(added.status, 'in_progress');
  await h.executeTool('add_follow_up', JSON.stringify({ school: 'Rice University', text: 'Ask Ms. Lee for a rec', due: '' }));
  const listed = JSON.parse(await h.executeTool('list_applications', '{}'));
  assert.equal(listed.count, 1);
  assert.match(await h.executeTool('add_application', JSON.stringify({ school: '' })), /Invalid arguments/);
});

test('set_essay_status marks real essays only, and clears', async () => {
  const h = makeHubTools('copilot-essays');
  const ws = await getWorkspace('copilot-essays');
  const id = ws.essays.commonApp[0].id;
  assert.match(await h.executeTool('set_essay_status', JSON.stringify({ essay_id: id, status: 'final' })), /final/);
  assert.equal((await getWorkspace('copilot-essays')).essayStatus[id], 'final');
  assert.match(await h.executeTool('set_essay_status', JSON.stringify({ essay_id: 'nope', status: 'final' })), /No essay with id/);
  await h.executeTool('set_essay_status', JSON.stringify({ essay_id: id, status: 'clear' }));
  assert.equal((await getWorkspace('copilot-essays')).essayStatus[id], undefined);
});

test('portal settings and school research save through the copilot', async () => {
  const h = makeHubTools('copilot-settings');
  assert.match(await h.executeTool('set_portal_settings', JSON.stringify({ emails: 'no' })), /portal emails off/);
  assert.match(await h.executeTool('set_portal_settings', '{}'), /Nothing to change/);
  await updateWorkspace('copilot-settings', (w) => ({ ...w, colleges: [{ slug: 'rice-university', name: 'Rice University', short: 'Rice' }] }));
  const reply = await h.executeTool('set_school_research', JSON.stringify({ college: 'Rice University', complete: false, facts: [{ key: 'admit_rate', value: '7.5%', sourceUrl: 'https://ir.rice.edu/cds', cycle: '2025-26', thirdParty: false }] }));
  assert.match(reply, /Saved 1 facts on Rice University/);
});

test('the mix only changes when the student\'s own message is about it', async () => {
  const save = (userText, args) => makeHubTools('copilot-mix', { userText }).executeTool('set_list_preferences', JSON.stringify(args));
  await save('Open to any region', { regions: ['any'], ambition: 'balanced' });
  let prefs = (await getWorkspace('copilot-mix')).onboarding.listPrefs;
  assert.deepEqual(prefs.regions, ['any']);
  assert.notEqual(prefs.ambitionChosen, true, 'ambition passed along with other prefs is ignored');
  await save('More reach schools', { ambition: 'ambitious' });
  prefs = (await getWorkspace('copilot-mix')).onboarding.listPrefs;
  assert.equal(prefs.ambition, 'ambitious');
  assert.equal(prefs.ambitionChosen, true);
});

test('application counts are saved only when the student gave them, or accepted a recommendation', async () => {
  const save = (userText, args) => makeHubTools('copilot-counts', { userText }).executeTool('set_list_preferences', JSON.stringify(args));
  const out = await save('15', { suppCount: '15', noSuppCount: '0' });
  assert.match(out, /Not saved: noSuppCount/);
  let prefs = (await getWorkspace('copilot-counts')).onboarding.listPrefs;
  assert.equal(prefs.suppCount, 15);
  assert.equal(prefs.noSuppCount, undefined, 'an inferred 0 is dropped');
  await save('five of those', { noSuppCount: '5' });
  assert.equal((await getWorkspace('copilot-counts')).onboarding.listPrefs.noSuppCount, 5);
  await save('none, I am fine writing essays', { noSuppCount: '0' });
  assert.equal((await getWorkspace('copilot-counts')).onboarding.listPrefs.noSuppCount, 0);
  await save('Sounds good, go with that', { suppCount: '8', noSuppCount: '3', countsRecommended: true });
  prefs = (await getWorkspace('copilot-counts')).onboarding.listPrefs;
  assert.deepEqual([prefs.suppCount, prefs.noSuppCount, prefs.countsRecommended], [8, 3, true]);
});

test('resending an already saved count, or Codex empty strings, is not an invented number', async () => {
  const { getWorkspace } = require('../lib/store.ts');
  const first = makeHubTools('copilot-counts', { userText: '8' });
  assert.doesNotMatch(await first.executeTool('set_list_preferences', JSON.stringify({ suppCount: '8' })), /Not saved/);
  // Next turn the student says "2"; the model passes the earlier 8 along, and "" for unused fields.
  const second = makeHubTools('copilot-counts', { userText: '2' });
  const out = await second.executeTool('set_list_preferences', JSON.stringify({ suppCount: '8', noSuppCount: '2', ambition: '', notes: '' }));
  assert.doesNotMatch(out, /Not saved/);
  const prefs = (await getWorkspace('copilot-counts')).onboarding.listPrefs;
  assert.equal(prefs.suppCount, 8);
  assert.equal(prefs.noSuppCount, 2);
  // A count the student never gave is still dropped.
  assert.match(await second.executeTool('set_list_preferences', JSON.stringify({ suppCount: '12' })), /Not saved: suppCount/);
});
