const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { planReadiness } = require('../lib/plan-readiness.ts');
const { placeholderSupplementsForCollege, syncEssaySupplements } = require('../lib/essay-supplements.ts');

const college = (slug, extra = {}) => ({ slug, name: slug, short: slug, ...extra });
const essay = (prompt) => [{ id: 'x', label: 'x', prompt, limit: 250, unit: 'words' }];
const workspace = (colleges, supplements = {}) => ({ colleges, essays: { commonApp: [], supplements }, essayDrafts: {} });

test('lists schools that still need official deadlines', () => {
  const ws = workspace([
    college('has-dates', { deadlines: [{ plan: 'EA', date: '2026-11-01' }] }),
    college('has-label', { deadline: 'RD · Jan 5' }),
    college('no-dates'),
  ]);
  assert.deepEqual(planReadiness(ws).missingDeadlines, ['no-dates']);
});

test('sorts essay groups into current, unconfirmed and placeholder prompts', () => {
  const ws = workspace(
    [college('real'), college('stale'), college('empty'), college('no-group')],
    {
      real: essay('Why this school? Tell us.'),
      stale: essay('Why us?\n\n(2024-25 prompts via CollegeVine; confirm on the school\'s site before writing.)'),
      empty: placeholderSupplementsForCollege(college('empty')),
    }
  );
  assert.deepEqual(planReadiness(ws).essays, { current: ['real'], unconfirmed: ['stale'], placeholder: ['empty'] });
});

test('UC campuses share the fixed PIQs and are not flagged for essay research', () => {
  const ws = workspace([college('university-of-california-berkeley', { name: 'University of California, Berkeley' })]);
  assert.deepEqual(planReadiness(syncEssaySupplements(ws)).essays, { current: [], unconfirmed: [], placeholder: [] });
});

test('schools confirmed to have no supplements do not get placeholder groups', () => {
  const out = syncEssaySupplements(workspace([college('not-a-real-school', { supp: 'No supps' })]));
  assert.equal(out.essays.supplements['not-a-real-school'], undefined);
});
