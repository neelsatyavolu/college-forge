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
process.env.CF_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-link-safety-'));
delete process.env.BLOB_READ_WRITE_TOKEN;

const { emptyWorkspace } = require('../lib/store.ts');
const { upsertCollegeInto, withWebLinks, isHttpUrl } = require('../lib/colleges.ts');
const { applyWorkspacePatch } = require('../lib/workspace-patch.ts');
const { mergeResearch } = require('../lib/interview-tools.ts');

const fact = (key, sourceUrl) => ({ key, value: 'Yes', sourceUrl, cycle: '2026-27', checkedAt: '2026-09-01', thirdParty: false });
const research = () => ({
  slug: 'rice', name: 'Rice University', checkedAt: '2026-09-01', complete: true,
  facts: [fact('demonstrated_interest', 'javascript:alert(document.cookie)'), fact('interview', 'https://admission.rice.edu/interviews')],
  deadlines: [{ plan: 'ED', date: '2026-11-01', sourceUrl: 'data:text/html,<script>alert(1)</script>', cycle: '2026-27' }],
  supplements: [],
});
const rice = (extra = {}) => ({ slug: 'rice', name: 'Rice University', short: 'Rice', ...extra });
const sources = (c) => [...c.research.facts, ...c.research.deadlines].map((f) => f.sourceUrl);

test('only http(s) addresses count as links', () => {
  for (const ok of ['https://rice.edu/a', 'http://rice.edu']) assert.equal(isHttpUrl(ok), true, ok);
  for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', ' https://rice.edu', '//rice.edu', '', null, 7]) assert.equal(isHttpUrl(bad), false, String(bad));
});

test('withWebLinks drops research items and site links that are not http(s)', () => {
  const c = withWebLinks(rice({ url: 'javascript:alert(1)', priceCalcUrl: 'https://rice.edu/npc', research: research() }));
  assert.equal(c.url, undefined);
  assert.equal(c.priceCalcUrl, 'https://rice.edu/npc');
  assert.deepEqual(sources(c), ['https://admission.rice.edu/interviews']);
});

test('upsert_college (upsertCollegeInto) never stores a javascript: source or url', () => {
  const ws = upsertCollegeInto(emptyWorkspace(), rice({ url: 'javascript:alert(1)', research: research() }));
  const saved = ws.colleges.find((c) => c.slug === 'rice');
  assert.equal(saved.url, undefined);
  assert.deepEqual(sources(saved), ['https://admission.rice.edu/interviews']);
  const again = upsertCollegeInto({ ...ws, colleges: ws.colleges.map((c) => ({ ...c, url: 'https://rice.edu' })) }, rice({ url: 'javascript:alert(2)' }));
  assert.equal(again.colleges.find((c) => c.slug === 'rice').url, 'https://rice.edu');
});

test('workspace patches (colleges and collegePatch) drop non-http(s) links', () => {
  const listed = applyWorkspacePatch(emptyWorkspace(), { colleges: [rice({ url: 'javascript:alert(1)', research: research() })] });
  const saved = listed.colleges.find((c) => c.slug === 'rice');
  assert.equal(saved.url, undefined);
  assert.deepEqual(sources(saved), ['https://admission.rice.edu/interviews']);
  const base = { ...emptyWorkspace(), colleges: [rice({ url: 'https://rice.edu' })] };
  const patched = applyWorkspacePatch(base, { collegePatch: { slug: 'rice', url: 'javascript:alert(1)', research: research() } });
  const row = patched.colleges.find((c) => c.slug === 'rice');
  assert.equal(row.url, 'https://rice.edu');
  assert.deepEqual(sources(row), ['https://admission.rice.edu/interviews']);
});

test('set_school_research keeps applying the same http(s) rule', () => {
  const ws = { ...emptyWorkspace(), colleges: [rice()] };
  const r = mergeResearch(ws, { college: 'rice', facts: [fact('interview', 'javascript:alert(1)'), fact('demonstrated_interest', 'https://rice.edu/visit')] });
  assert.equal(r.saved, 1);
  assert.equal(r.dropped, 1);
});

test('hub pages only link research sources that start with http(s)', () => {
  const hub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'hub', f), 'utf8');
  assert.match(hub('InterestLog.jsx'), /if \(!\/\^https\?:\\\/\\\/\/\.test\(fact\.sourceUrl/);
  assert.match(hub('AidBySchool.jsx'), /\/\^https\?:\\\/\\\/\/\.test\(row\.cssSource/);
  assert.match(hub('TestingPlan.jsx'), /\/\^https\?:\\\/\\\/\/\.test\(tp\.policy\.sourceUrl/);
});

test('bare Scorecard hosts become https links instead of being dropped', () => {
  const out = withWebLinks({ name: 'X', url: 'www.harvard.edu/', priceCalcUrl: 'javascript:alert(1)' });
  assert.equal(out.url, 'https://www.harvard.edu/');
  assert.equal(out.priceCalcUrl, undefined);
});
