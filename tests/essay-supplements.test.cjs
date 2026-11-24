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

test('official prompts with no stated cycle carry a confirm note and structured fields', () => {
  const [slug] = Object.entries(dataset.schools).find(([, s]) => s.source === 'official' && !s.cycle && s.prompts?.length) || [];
  if (!slug) return;
  const essays = scrapedSupplementsFor(college(slug));
  assert.ok(essays.every((e) => /Cycle not stated on the school page; confirm on the school's site/.test(e.prompt)));
  assert.ok(essays.every((e) => typeof e.required === 'boolean' && e.source === 'official' && e.cycle === null));
});

test('schools are found by Scorecard id or name when the slug differs', () => {
  const [slug, school] = Object.entries(dataset.schools).find(([, s]) => s.scorecardId && s.prompts?.length) || [];
  if (!slug) return;
  const byId = scrapedSupplementsFor({ slug: 'some-other-slug', name: 'X', short: 'X', scorecardId: school.scorecardId });
  const byName = scrapedSupplementsFor({ slug: 'some-other-slug', name: school.name, short: 'X' });
  assert.equal(byId.length, school.prompts.length);
  assert.equal(byName.length, school.prompts.length);
  assert.ok(byId.every((e) => e.id.startsWith('some-other-slug-supp-')));
});

test('audience and choose-one prompts are exposed as fields', () => {
  for (const [slug, school] of Object.entries(dataset.schools)) {
    const essays = scrapedSupplementsFor(college(slug)) || [];
    school.prompts?.forEach((p, i) => {
      if (p.audience) assert.equal(essays[i].audience, p.audience);
      if (p.options.length) assert.deepEqual([essays[i].options, essays[i].choose], [p.options, 1]);
      if (!p.required && !p.audience) assert.match(essays[i].label, /\(optional\)$/);
    });
  }
});

// ── Writing dashboard: status, suggestions and the essay tools ─────────────
const os = require('node:os');
const Module = require('node:module');
const resolveFile = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  return resolveFile.call(this, request.startsWith('@/') ? path.join(__dirname, '..', request.slice(2)) + '.ts' : request, ...args);
};
const { checkWorkspacePatch, applyWorkspacePatch } = require('../lib/workspace-patch.ts');
const { UC_PERSONAL_INSIGHT_QUESTIONS } = require('../lib/essay-supplements.ts');
const { COMMON_APP_PERSONAL_PROMPTS } = require('../lib/common-app-prompts.ts');
const essayTools = require('../lib/essay-tools.ts');
const store = require('../lib/store.ts');

async function isolated(run) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-essays-'));
  const prev = process.env.CF_DATA_DIR, blob = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.CF_DATA_DIR = dir;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try { await run(); } finally {
    if (prev === undefined) delete process.env.CF_DATA_DIR; else process.env.CF_DATA_DIR = prev;
    if (blob !== undefined) process.env.BLOB_READ_WRITE_TOKEN = blob;
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

test('UC PIQs are a choose-4 set and Common App prompts a choose-1 set', () => {
  assert.ok(UC_PERSONAL_INSIGHT_QUESTIONS.every((e) => e.chooseGroup === 'uc' && e.choose === 4));
  const personal = COMMON_APP_PERSONAL_PROMPTS.filter((e) => /^ca-ps-/.test(e.id));
  assert.ok(personal.length >= 6 && personal.every((e) => e.chooseGroup === 'common' && e.choose === 1));
  const extra = COMMON_APP_PERSONAL_PROMPTS.find((e) => e.id === 'ca-additional-info');
  assert.deepEqual([extra.chooseGroup, extra.required], [undefined, false]);
});

test('essayStatus patches accept draft, final and null and reject anything else', () => {
  assert.equal(checkWorkspacePatch({ essayStatus: { 'ca-ps-1': 'final', 'uc-piq-2': 'draft', x: null } }).ok, true);
  for (const bad of [{ 'ca-ps-1': 'done' }, { 'ca-ps-1': 1 }, ['final'], 'final', { 'bad id!': 'final' }]) {
    const r = checkWorkspacePatch({ essayStatus: bad });
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
  // The Essays tab can only dismiss suggestions, never write one.
  assert.equal(checkWorkspacePatch({ essaySuggestions: { 'ca-ps-1': null } }).ok, true);
  assert.equal(checkWorkspacePatch({ essaySuggestions: { 'ca-ps-1': { text: 'x', createdAt: 1 } } }).ok, false);
});

test('essayStatus patches merge, and null clears a mark', () => {
  const ws = store.emptyWorkspace();
  const marked = applyWorkspacePatch(ws, { essayStatus: { 'ca-ps-1': 'final', 'ca-ps-2': 'draft' } });
  assert.deepEqual(marked.essayStatus, { 'ca-ps-1': 'final', 'ca-ps-2': 'draft' });
  const cleared = applyWorkspacePatch(marked, { essayStatus: { 'ca-ps-2': null } });
  assert.deepEqual(cleared.essayStatus, { 'ca-ps-1': 'final' });
  assert.equal(ws.essayStatus, undefined, 'the original workspace is not changed');
});

test('suggestions are saved beside the draft and dismissed by patch', () => {
  const ws = { ...store.emptyWorkspace(), essayDrafts: { 'ca-ps-1': 'My own words.' } };
  assert.equal(essayTools.withSuggestion(ws, 'no-such-essay', 'Text').ok, false);
  assert.equal(essayTools.withSuggestion(ws, 'ca-ps-1', '   ').ok, false);
  const r = essayTools.withSuggestion(ws, 'ca-ps-1', ' A tighter version. ');
  assert.equal(r.ok, true);
  assert.equal(r.value.essayDrafts['ca-ps-1'], 'My own words.');
  const view = essayTools.essayView(r.value, 'ca-ps-1');
  assert.deepEqual([view.pending_suggestion, view.count, view.status, view.limit], ['A tighter version.', 3, 'draft', 650]);
  const dismissed = applyWorkspacePatch(r.value, { essaySuggestions: { 'ca-ps-1': null } });
  assert.deepEqual(dismissed.essaySuggestions, {});
});

test('the copilot reads one essay and suggests an edit through its scoped tools', () => isolated(async () => {
  const { makeHubTools } = require('../lib/hub-tools.ts');
  const id = 'essay-tools-hub';
  await store.updateWorkspace(id, (ws) => ({ ...ws, essayDrafts: { 'ca-ps-2': 'A synthetic draft about a setback.' } }));
  const { executeTool } = makeHubTools(id);
  const view = JSON.parse(await executeTool('get_essay', JSON.stringify({ id: 'ca-ps-2' })));
  assert.equal(view.draft, 'A synthetic draft about a setback.');
  assert.match(await executeTool('get_essay', JSON.stringify({ id: '' })), /requires/);
  assert.match(await executeTool('suggest_essay_edit', JSON.stringify({ id: 'nope', text: 'x' })), /No essay/);
  assert.match(await executeTool('suggest_essay_edit', JSON.stringify({ id: 'ca-ps-2', text: 'A shorter synthetic draft.' })), /Saved/);
  const ws = await store.getWorkspace(id);
  assert.equal(ws.essaySuggestions['ca-ps-2'].text, 'A shorter synthetic draft.');
  assert.equal(ws.essayDrafts['ca-ps-2'], 'A synthetic draft about a setback.');
}));

test('MCP agents can list, read and set essay prompts without touching drafts', () => isolated(async () => {
  const { callTool } = require('../lib/mcp-tools.ts');
  const id = 'essay-tools-mcp';
  await store.updateWorkspace(id, (ws) => ({ ...ws, essayDrafts: { 'ca-ps-1': 'Synthetic words here.' } }));
  const list = (await callTool(id, 'list_essays', {})).structuredContent.essays;
  assert.equal(list.find((e) => e.id === 'ca-ps-1').count, 3);
  assert.ok(list.every((e) => !('draft' in e)));
  const one = await callTool(id, 'get_essay', { id: 'ca-ps-1' });
  assert.equal(one.structuredContent.draft, 'Synthetic words here.');
  assert.equal((await callTool(id, 'get_essay', { id: 'missing' })).isError, true);
  const prompt = { id: 'sample-u-why', label: 'Why Sample U', prompt: 'Why Sample U?', limit: 200, unit: 'words', chooseGroup: '', choose: 0, options: [], audience: '' };
  const set = await callTool(id, 'set_essays', { supplements: { 'sample-u': [prompt] } });
  assert.equal(set.isError, undefined, JSON.stringify(set));
  const ws = await store.getWorkspace(id);
  assert.deepEqual(ws.essays.supplements['sample-u'], [{ id: 'sample-u-why', label: 'Why Sample U', prompt: 'Why Sample U?', limit: 200, unit: 'words' }]);
  assert.equal(ws.essayDrafts['ca-ps-1'], 'Synthetic words here.');
  assert.equal((await callTool(id, 'set_essays', { supplements: { 'sample-u': [{ ...prompt, limit: -1 }] } })).isError, true);
  assert.equal((await callTool(id, 'set_essays', {})).isError, true);
}));
