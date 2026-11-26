const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { emptyWorkspace } = require('../lib/store.ts');
const F = require('../lib/list-facts.ts');
const T = require('../lib/interview-tools.ts');

const research = (facts, supplements = []) => ({ slug: 'x', name: 'X', checkedAt: '2026-11-20', complete: true, deadlines: [], supplements, facts: facts.map(([key, value]) => ({ key, value, sourceUrl: 'https://x.edu', checkedAt: '2026-11-20', cycle: '2025-26', thirdParty: false })) });
const r = research([['net_price_75_110k', '$27,982 (2023-24)'], ['net_price_lt30k', '$0 (average grants exceeded the cost) average net price'], ['sticker_cost', '$98,872 estimated 2026-27 COA']]);

test('net price follows the family income bracket, or the full cost without need-based aid', () => {
  assert.deepEqual(F.netPriceFor(r, { incomeBracket: '75-110', needAid: true }), { amount: 27982, basis: 'income', label: '$27,982 average for your income' });
  assert.equal(F.netPriceFor(r, { incomeBracket: 'lt30' }).amount, 0);
  assert.equal(F.netPriceFor(r, { incomeBracket: 'unsure' }), null);
  assert.equal(F.netPriceFor(r, { needAid: false, incomeBracket: 'gt110' }).basis, 'sticker');
  assert.equal(F.netPriceFor(r, { needAid: false }).amount, 98872);
  assert.equal(F.netPriceFor(null, { incomeBracket: 'lt30' }), null);
});

test('supplements come from current prompts or a sourced none note', () => {
  assert.equal(F.supplementsFor(research([], [{ label: 'Why us', prompt: 'p', sourceUrl: 'https://x.edu', cycle: '2026-27' }])), 'yes');
  assert.equal(F.supplementsFor(research([['notes', 'No supplemental essay; Common App personal statement only']])), 'no');
  assert.equal(F.supplementsFor(research([], [{ label: 'old', prompt: 'p', sourceUrl: 'https://x.edu', cycle: '2024-25' }])), null);
});

test('real research files: Miami has no supplements and prices by income', () => {
  const ws = emptyWorkspace();
  ws.onboarding = { completed: false, listPrefs: { ambition: 'balanced', settings: [], size: 'any', regions: [], notes: '', budget: '15-30', needAid: true, incomeBracket: '75-110' } };
  const f = F.studentFacts(ws, 'University of Miami');
  assert.equal(f.supplements, 'no');
  assert.ok(f.netPrice && f.netPrice.amount > 0);
  assert.equal(f.fitsBudget, f.netPrice.amount <= 30000 ? 'yes' : 'no');
});

test('the tier mix must roughly match the chosen ambition', () => {
  const ws = emptyWorkspace();
  ws.onboarding = { completed: false, listPrefs: { ambition: 'balanced', settings: [], size: 'any', regions: [], notes: '' } };
  const mk = (reach, target, likely) => [...Array(reach).fill('reach'), ...Array(target).fill('target'), ...Array(likely).fill('likely')].map((tier, i) => ({ name: `S${i}`, tier, reason: 'r' }));
  assert.equal(T.checkMix(ws, mk(3, 4, 3)), null);
  assert.match(T.checkMix(ws, mk(0, 4, 6)), /about 3 \/ 4 \/ 3/);
  assert.match(T.checkMix(ws, mk(8, 1, 1)), /fix reach/);
  ws.onboarding.listPrefs.ambition = 'conservative';
  assert.equal(T.checkMix(ws, mk(0, 3, 3)), null, 'a small conservative list may skip reaches');
});

test('an out-of-state public never shows the in-state income average as the student\'s price', () => {
  const ws = emptyWorkspace();
  ws.profile = { ...ws.profile, residency: 'OR' };
  ws.onboarding = { completed: false, listPrefs: { ambition: 'balanced', settings: [], size: 'any', regions: [], notes: '', budget: '15-30', needAid: true, incomeBracket: '75-110' } };
  const michigan = F.studentFacts(ws, 'University of Michigan--Ann Arbor', 'university-of-michigan-ann-arbor');
  assert.equal(michigan.outOfState, true);
  assert.equal(michigan.netPrice, null);
  assert.equal(michigan.fitsBudget, null);
  ws.profile.residency = 'MI';
  const resident = F.studentFacts(ws, 'University of Michigan--Ann Arbor', 'university-of-michigan-ann-arbor');
  assert.notEqual(resident.outOfState, true, 'residents get the income average');
  ws.profile.residency = 'OR';
  ws.onboarding.listPrefs.budget = '50plus';
  assert.equal(F.studentFacts(ws, 'University of Michigan--Ann Arbor', 'university-of-michigan-ann-arbor').fitsBudget, 'yes', 'no budget cap, so it fits');
  assert.equal(F.outOfStatePublic({ state: 'CA', isPublic: false }, 'OR'), false, 'privates price everyone the same way');
});
