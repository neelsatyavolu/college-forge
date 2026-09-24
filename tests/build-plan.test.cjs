const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { buildPlan, SCHOOLS_PER_STEP } = require('../lib/build-plan.ts');
const { placeholderSupplementsForCollege } = require('../lib/essay-supplements.ts');

const college = (slug, extra = {}) => ({ slug, name: `${slug} University`, short: slug, ...extra });
const dated = { deadlines: [{ plan: 'RD', date: '2027-01-01' }] };
const current = [{ id: 'x', label: 'Why us', prompt: 'Why this school?', limit: 250, unit: 'words' }];
const workspace = (colleges, supplements = {}) => ({ colleges, criticalDates: [], essays: { commonApp: [], supplements }, essayDrafts: {} });

test('batches only the schools that still need deadlines or prompts', () => {
  const ws = workspace(
    [college('done', dated), college('a'), college('b', dated), college('c'), college('d', dated)],
    {
      done: current, a: current, c: current, d: current,
      b: placeholderSupplementsForCollege(college('b')),
    }
  );
  const { schools } = buildPlan(ws);
  const slugs = schools.map((s) => [...s.prompt.matchAll(/\[([a-z-]+)\]/g)].map((m) => m[1]));
  assert.deepEqual(slugs, [['a', 'b'], ['c']]);
  assert.equal(SCHOOLS_PER_STEP, 2);
  assert.match(schools[0].prompt, /a University \[a\]: deadlines\n/);
  assert.match(schools[0].prompt, /b University \[b\]: supplement prompts \(placeholder\)/);
  assert.equal(schools[0].label, 'a & b');
});

test('a complete plan has no school steps but still refreshes milestones', () => {
  const plan = buildPlan(workspace([college('done', dated)], { done: current }));
  assert.deepEqual(plan.schools, []);
  assert.match(plan.rounds.prompt, /set_application_rounds/);
  assert.match(plan.milestones.prompt, /set_critical_dates/);
  for (const step of [plan.rounds, plan.milestones]) assert.match(step.prompt, /do not search the web/);
});

test('last-cycle prompts saved while this year is unreleased get rechecked', () => {
  const stale = [{ ...current[0], label: 'Why us (last cycle — this year\'s not released yet)' }];
  const { schools } = buildPlan(workspace([college('a', dated)], { a: stale }));
  assert.match(schools[0].prompt, /supplement prompts \(unconfirmed\)/);
});
