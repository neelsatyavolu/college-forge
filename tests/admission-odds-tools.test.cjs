const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { emptyWorkspace, getWorkspace, updateWorkspace, publicShareView } = require('../lib/store.ts');
const { makeHubTools } = require('../lib/hub-tools.ts');

async function withStore(run) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-odds-'));
  const oldDir = process.env.CF_DATA_DIR, oldToken = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.CF_DATA_DIR = dir; delete process.env.BLOB_READ_WRITE_TOKEN;
  try { await run('odds-test-workspace'); } finally {
    if (oldDir === undefined) delete process.env.CF_DATA_DIR; else process.env.CF_DATA_DIR = oldDir;
    if (oldToken !== undefined) process.env.BLOB_READ_WRITE_TOKEN = oldToken;
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

test('read, estimate and share: the tools save held estimates and keep the read private', () => withStore(async (id) => {
  const ws = emptyWorkspace();
  ws.applicant.sat = '1500';
  ws.colleges = [{ slug: 'tufts', name: 'Tufts University', short: 'Tufts', admit: '10%', satRange: '1450-1550' }];
  ws.essayDrafts = { [ws.essays.commonApp[0].id]: 'A synthetic essay about building radios.' };
  await updateWorkspace(id, () => ws);
  const { executeTool } = makeHubTools(id);

  assert.match(await executeTool('read_application', '{}'), /A synthetic essay about building radios\./);
  assert.equal(await executeTool('set_application_read', JSON.stringify({ summary: 'Strong STEM applicant.', strengths: ['Rigor'], concerns: ['Few awards'] })), 'Saved the application read.');

  const saved = await executeTool('set_admission_odds', JSON.stringify({ key: 'tufts', percent: 45, low: 20, high: 60, summary: 'Above-average fit.', factors: [{ label: 'Rigor', effect: 'up', detail: 'Hardest schedule.' }], sources: ['https://tufts.edu/cds'] }));
  assert.match(saved, /Saved Tufts: 30% \(20–60%\)\. Held to 30%/);
  assert.match(await executeTool('set_admission_odds', JSON.stringify({ key: 'nope', percent: 10, summary: 'x' })), /No school with key/);

  const after = await getWorkspace(id);
  assert.equal(after.admissionOdds.tufts.percent, 30);
  assert.equal(after.applicationRead.summary, 'Strong STEM applicant.');
  assert.equal('applicationRead' in publicShareView(after), false);
  assert.equal('admissionOdds' in publicShareView(after), false);
}));
