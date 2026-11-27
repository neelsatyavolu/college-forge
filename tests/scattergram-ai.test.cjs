// The AI features see the student's imported Maia scattergrams: the copilot and onboarding prompts,
// the get_scattergrams tool (MCP and copilot), and the chance-estimate plan.
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
const store = require('../lib/store.ts');
const summary = require('../lib/scattergram-summary.ts');
const { buildHubSystemPrompt } = require('../lib/hub-context.ts');
const { buildInterviewPrompt } = require('../lib/interview-prompt.ts');
const { oddsPlan } = require('../lib/odds-plan.ts');
const mcp = require('../lib/mcp-tools.ts');
const { bridgeToolSpecs } = require('../lib/copilot-bridge-tools.ts');
const { toolAllowed } = require('../lib/tool-policy.ts');

const WS = 'scatter-ai-workspace';
const tufts = { slug: 'tufts-university', name: 'Tufts University', short: 'Tufts', admit: '10%' };
const doc = {
  version: 1, importedAt: Date.UTC(2026, 10, 20), classOfYears: '4', student: { gpa: 3.9, wgpa: 4.3, sat: 1500 },
  colleges: {
    'tufts-university': { slug: 'tufts-university', name: 'Tufts University', rank: 37, maiaTitle: null, fetchedAt: 1, n: 4, counts: { Accepted: 2, Denied: 1, Waitlisted: 1 }, averages: { gpa: 3.9, sat: 1500 }, points: [
      { sat: 1520, gpa: 3.95, result: 'Accepted', round: 'Early Decision' },
      { sat: 1480, gpa: 3.85, result: 'Denied', round: 'Regular Decision' },
      { sat: 1550, gpa: 4.0, result: 'Accepted', round: 'Regular Decision' },
      { sat: 1300, gpa: 3.5, result: 'Waitlisted', round: 'Regular Decision' },
    ] },
    'rice-university': { slug: 'rice-university', name: 'Rice University', rank: 18, maiaTitle: null, fetchedAt: 1, n: 0, counts: {}, averages: { gpa: null, sat: null }, points: [] },
  },
};

function workspace() {
  const w = store.emptyWorkspace();
  return { ...w, colleges: [tufts, { slug: 'bates-college', name: 'Bates College', short: 'Bates' }] };
}

test('a school summary counts results, early rounds and applicants near the student', () => {
  const s = summary.summarizeCollege(doc.colleges['tufts-university'], { gpa: 3.9, sat: 1500, from: 'maia' });
  assert.equal(s.admit_rate_percent, 50);
  assert.deepEqual(s.early, { ed: { applicants: 1, accepted: 1 } });
  assert.deepEqual(s.accepted_median, { gpa: 3.98, sat: 1535 });
  assert.deepEqual(s.near_student, { applicants: 2, accepted: 1, denied: 1, waitlisted: 0, deferred: 0 });
});

test('the student point falls back to the Forge profile when Maia has none', () => {
  const w = workspace();
  w.applicant = { ...w.applicant, gpaUnweighted: '3.80/4.0', sat: '1,450' };
  assert.deepEqual(summary.studentPoint({ ...doc, student: null }, w), { gpa: 3.8, sat: 1450, from: 'profile' });
});

test('the copilot and onboarding prompts carry the digest; without one the copilot learns the feature exists', () => {
  const w = workspace();
  const digest = summary.scattergramDigest(doc, w);
  assert.match(digest, /Tufts University: 4 applicants, 2 accepted \(50%\)/);
  assert.match(digest, /\(not on list\) Rice University: no past applicants/);
  assert.match(digest, /List schools not imported yet: Bates/);
  const hub = buildHubSystemPrompt(w, digest);
  assert.match(hub, /high school scattergrams/);
  assert.match(hub, /get_scattergrams/);
  assert.ok(hub.includes(digest));
  assert.match(buildHubSystemPrompt(w), /Scattergrams: none imported[\s\S]*Scattergrams tab/);
  assert.ok(buildInterviewPrompt(w, digest).includes(digest));
  assert.equal(summary.scattergramDigest(null, w), '');
});

test('chance estimates see each school\'s local results', () => {
  const step = oddsPlan(workspace(), doc).schools[0].prompt;
  assert.match(step, /Tufts University \[[^\]]+\][^\n]*Your high school's past applicants \(Maia scattergram\): 4 applicants/);
  assert.match(step, /weigh how applicants near this student's GPA and SAT fared/);
  assert.doesNotMatch(oddsPlan(workspace()).schools[0].prompt, /Maia scattergram\)/);
});

test('get_scattergrams is an MCP tool the copilot also gets, read-only and allowed in onboarding', async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-scatter-ai-'));
  const prev = process.env.CF_DATA_DIR, blob = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.CF_DATA_DIR = dir; delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    assert.ok(bridgeToolSpecs(new Set()).some((t) => t.name === 'get_scattergrams'), 'bridged into the copilot');
    assert.ok(mcp.toolList().find((t) => t.name === 'get_scattergrams').annotations.readOnlyHint);
    assert.equal(toolAllowed('onboarding', 'get_scattergrams'), true);
    await store.updateWorkspace(WS, () => workspace());
    const none = await mcp.callTool(WS, 'get_scattergrams', {});
    assert.equal(none.structuredContent.imported, false);
    await store.writeScattergramText(WS, JSON.stringify(doc));
    const all = (await mcp.callTool(WS, 'get_scattergrams', {})).structuredContent;
    assert.equal(all.schools.length, 2);
    assert.equal(all.schools.find((s) => s.slug === 'tufts-university').on_list, true);
    assert.deepEqual(all.list_schools_not_imported, ['Bates College']);
    const one = (await mcp.callTool(WS, 'get_scattergrams', { school: 'tufts' })).structuredContent;
    assert.equal(one.found, true);
    assert.equal(one.points.length, 4);
    const miss = (await mcp.callTool(WS, 'get_scattergrams', { school: 'Nowhere State' })).structuredContent;
    assert.equal(miss.found, false);
  } finally {
    if (prev === undefined) delete process.env.CF_DATA_DIR; else process.env.CF_DATA_DIR = prev;
    if (blob !== undefined) process.env.BLOB_READ_WRITE_TOKEN = blob;
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});
