const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const Module = require('node:module');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (!request.startsWith('@/')) return resolve.call(this, request, ...args);
  const file = path.join(__dirname, '..', request.slice(2));
  return resolve.call(this, /\.(js|json)$/.test(file) ? file : file + '.ts', ...args);
};
const { NAV, PAGE_LINKS } = require('../public/hub/nav.js');
const { HUB_TABS, HUB_PAGES, hubGuide } = require('../lib/hub-guide.ts');
const { emptyWorkspace, updateWorkspace } = require('../lib/store.ts');
const { makeHubTools } = require('../lib/hub-tools.ts');
const { buildHubSystemPrompt } = require('../lib/hub-context.ts');

async function withStore(run) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-guide-'));
  const oldDir = process.env.CF_DATA_DIR, oldToken = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.CF_DATA_DIR = dir; delete process.env.BLOB_READ_WRITE_TOKEN;
  try { await run('guide-test-workspace'); } finally {
    if (oldDir === undefined) delete process.env.CF_DATA_DIR; else process.env.CF_DATA_DIR = oldDir;
    if (oldToken !== undefined) process.env.BLOB_READ_WRITE_TOKEN = oldToken;
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

test('every hub tab and page has a copilot guide entry with its sidebar label', () => {
  for (const n of NAV) {
    assert.ok(HUB_TABS[n.id], `nav tab "${n.id}" (${n.label}) has no entry in lib/hub-guide.ts`);
    assert.equal(HUB_TABS[n.id].label, n.label, `guide label for "${n.id}" should match the sidebar`);
  }
  for (const p of PAGE_LINKS) assert.ok(HUB_PAGES[p.href], `page ${p.href} has no entry in lib/hub-guide.ts`);
  for (const id of Object.keys(HUB_TABS)) assert.ok(NAV.some((n) => n.id === id), `guide entry "${id}" is not a tab any more`);
});

test('every tool the guide names is one the copilot has', () => {
  const { tools } = makeHubTools('guide-names');
  const names = new Set(tools.map((t) => t.name));
  for (const t of [...Object.values(HUB_TABS), ...Object.values(HUB_PAGES)]) {
    for (const tool of t.tools) assert.ok(names.has(tool.split(' ')[0]), `${t.label} names unknown tool ${tool}`);
  }
});

test('the copilot prompt carries the tab guide', () => {
  const prompt = buildHubSystemPrompt(emptyWorkspace());
  assert.ok(prompt.includes(hubGuide()));
  assert.match(prompt, /\*\*Ranked list\*\*/);
});

test('get_ranked_list and get_official_rankings answer from the same data as the tabs', () => withStore(async (id) => {
  const ws = emptyWorkspace();
  await updateWorkspace(id, () => ws);
  const { executeTool } = makeHubTools(id);
  assert.match(await executeTool('get_ranked_list', '{}'), /empty/);
  await executeTool('add_application', JSON.stringify({ school: 'Northwestern University' }));
  await executeTool('add_application', JSON.stringify({ school: 'Northeastern University' }));
  const list = JSON.parse(await executeTool('get_ranked_list', '{}'));
  assert.deepEqual(list.rows.map((r) => r.name), ['Northwestern University', 'Northeastern University']);
  assert.match(list.how, /not an admission-chance order/);
  const off = JSON.parse(await executeTool('get_official_rankings', JSON.stringify({ schools: ['Northwestern University', 'Nowhere College'] })));
  assert.ok(off.schools[0].ranks.usn > 0);
  assert.equal(Object.keys(off.schools[1].ranks).length, 0);
  const top = JSON.parse(await executeTool('get_official_rankings', JSON.stringify({ list: 'usn', top: 3 })));
  assert.equal(top.top.length, 3);
  assert.equal(top.top[0].rank, 1);
}));
