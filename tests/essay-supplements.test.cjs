const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { syncEssaySupplements, syncSuppStatus, placeholderSupplementsForCollege } = require('../lib/essay-supplements.ts');
const { scrapedSupplementsFor } = require('../lib/supplement-prompts.ts');

const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, '../lib/supplements/prompts.json'), 'utf8'));
const scrapedSlug = Object.keys(dataset.schools).find((slug) => dataset.schools[slug].prompts?.length);
const college = (slug, name = slug) => ({ slug, name, short: name });
const workspace = (colleges, supplements = {}, essayDrafts = {}) => ({ colleges, essays: { commonApp: [], supplements }, essayDrafts });

test('dataset entries are well-formed', () => {
  assert.match(dataset.cycle, /^\d{4}-\d{2}$/);
  for (const [slug, school] of Object.entries(dataset.schools)) {
    assert.ok(['official', 'collegevine', 'none'].includes(school.source), slug);
    for (const p of school.prompts || []) {
      assert.ok(p.label && (p.prompt || p.options.length), slug);
      assert.ok(p.limit === null || (Number.isInteger(p.limit) && p.limit > 0), slug);
      assert.ok(['words', 'characters'].includes(p.unit), slug);
    }
  }
});

test('new schools on file get scraped prompts with stable ids and real limits', () => {
  const c = college(scrapedSlug, dataset.schools[scrapedSlug].name);
  const out = syncEssaySupplements(workspace([c]));
  const essays = out.essays.supplements[scrapedSlug];
  assert.equal(essays.length, dataset.schools[scrapedSlug].prompts.length);
  assert.deepEqual(essays.map((e) => e.id), essays.map((_, i) => `${scrapedSlug}-supp-${i + 1}`));
  assert.ok(essays.every((e) => e.limit > 0 && !/not loaded yet/.test(e.prompt)));
});

test('schools not on file still get placeholders', () => {
  const out = syncEssaySupplements(workspace([college('not-a-real-school', 'Nowhere College')]));
  assert.match(out.essays.supplements['not-a-real-school'][0].prompt, /not loaded yet/);
});

test('existing placeholder groups are left alone so in-flight drafts keep their ids', () => {
  const c = college(scrapedSlug);
  const ws = workspace([c], { [scrapedSlug]: placeholderSupplementsForCollege(c) });
  assert.equal(syncEssaySupplements(ws), ws);
});

test('real prompts already in the workspace are never replaced', () => {
  const c = college(scrapedSlug);
  const custom = [{ id: 'mine', label: 'Mine', prompt: 'A prompt the copilot found.', limit: 300, unit: 'words' }];
  const ws = workspace([c], { [scrapedSlug]: custom });
  assert.equal(syncEssaySupplements(ws), ws);
});

test('no-limit and outdated prompts carry a guidance note', () => {
  const { knownNoSupplements } = require('../lib/supplement-prompts.ts');
  assert.equal(knownNoSupplements('not-a-real-school'), false);
  for (const [slug, school] of Object.entries(dataset.schools)) {
    const essays = scrapedSupplementsFor(college(slug)) || [];
    school.prompts?.forEach((p, i) => {
      if (p.limit === null) assert.match(essays[i].prompt, /No official length limit/);
      if (school.source === 'collegevine') assert.match(essays[i].prompt, /confirm on the school's site/);
    });
  }
});

test('supplement status follows the loaded prompts', () => {
  const prompt = (label) => ({ id: label, label, prompt: 'Tell us about it.', limit: 250, unit: 'words' });
  const colleges = [
    college('required', 'Required U'),
    { ...college('optional', 'Optional U'), supp: 'Supps required' },
    { ...college('placeholder', 'Placeholder U'), supp: 'Supps optional' },
    college('not-listed', 'Not Listed U'),
  ];
  const ws = workspace(colleges, {
    required: [prompt('Why us'), prompt('Community (optional)')],
    optional: [prompt('Anything else (optional)')],
    placeholder: placeholderSupplementsForCollege(college('placeholder')),
  });
  const out = syncSuppStatus(ws);
  assert.deepEqual(out.colleges.map((c) => c.supp), ['Supps required', 'Supps optional', 'Supps optional', undefined]);
  assert.equal(syncSuppStatus(out), out);
});
