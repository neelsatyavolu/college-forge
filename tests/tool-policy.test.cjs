const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true } }).outputText, file);
const { toolAllowed, sensitiveRefusal } = require('../lib/tool-policy.ts');

test('research turns can only read the web and save research', () => {
  for (const ok of ['web_search', 'web_fetch', 'set_school_research', 'upsert_college', 'set_essays']) assert.ok(toolAllowed('research', ok), ok);
  for (const no of ['create_share_link', 'reveal_decision', 'check_portals', 'remove_application', 'record_decision', 'set_profile_identity', 'propose_list']) assert.equal(toolAllowed('research', no), false, no);
});

test('the interview cannot touch the tracker, sharing or the list directly', () => {
  for (const no of ['upsert_college', 'remove_college', 'rebalance_list', 'add_application', 'update_application', 'record_decision', 'remove_application', 'create_share_link', 'check_portals', 'reveal_decision']) assert.equal(toolAllowed('onboarding', no), false, no);
  for (const ok of ['ask_question', 'propose_list', 'set_testing', 'read_upload', 'set_early_decision']) assert.ok(toolAllowed('onboarding', ok), ok);
  assert.ok(toolAllowed('hub', 'create_share_link'));
});

test('sensitive tools need the student to ask in their own words', () => {
  assert.match(sensitiveRefusal('create_share_link', 'what are my deadlines this week?'), /only runs when the student asks/);
  assert.equal(sensitiveRefusal('create_share_link', 'make a link I can share with my mom'), null);
  assert.match(sensitiveRefusal('reveal_decision', ''), /only runs/);
  assert.equal(sensitiveRefusal('reveal_decision', 'did I get into Rice? show me the decision'), null);
  assert.match(sensitiveRefusal('remove_application', 'update my essays'), /only runs/);
  assert.equal(sensitiveRefusal('web_search', ''), null, 'ordinary tools are not gated');
});
