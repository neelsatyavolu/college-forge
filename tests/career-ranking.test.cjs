const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2021, esModuleInterop:true, resolveJsonModule:true}}).outputText, file);
const { createRanker, matchSchoolId, majorKeysOf, DEFAULT_WEIGHTS } = require('../lib/career-ranking.ts');
const { expandAlias } = require('../lib/college-aliases.ts');
const data = require('../public/data/career-ranking.json');

const ranker = createRanker(data);
const settings = (track = 'path') => ({ track, col: true, va: false, stretch: false, w: { ...DEFAULT_WEIGHTS } });
const everyone = { targets: ranker.targets, direct: {} };
const byName = name => data.schools.find(s => s.name === name);

test('the public data holds school facts only', () => {
  const text = JSON.stringify(data);
  for (const field of ['"admitted"', '"why"', '"applied"', '"ap"', '"home"', '"ai"']) assert.ok(!text.includes(field), field);
  assert.ok(data.schools.length >= 40);
  for (const s of data.schools) assert.equal(typeof s.switch.lv, 'object');
});

test('My path ranks every school once, with ties sharing a rank', () => {
  const rows = ranker.rank(settings(), everyone);
  assert.equal(rows.length, data.schools.length);
  assert.equal(new Set(rows.map(r => r.s.id)).size, rows.length);
  assert.equal(rows[0].score, 100);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].raw >= rows[i].raw);
  for (const r of rows.filter(r => r.rk.startsWith('T-'))) assert.ok(rows.filter(x => x.rk === r.rk).length > 1, r.rk);
});

test('the admitted view ranks only those schools, on the full list\'s scale', () => {
  const only = new Set([byName('Purdue').id, byName('UC Davis').id, byName('Tufts').id]);
  const all = new Map(ranker.rank(settings(), everyone).map(r => [r.s.id, r.score]));
  const rows = ranker.rank(settings(), everyone, only);
  assert.deepEqual(new Set(rows.map(r => r.s.id)), only);
  for (const r of rows) assert.equal(r.score, all.get(r.s.id));
  assert.equal(rows[0].rk, '1');
});

test('a major applied to directly counts even where switching in is closed', () => {
  const s = data.schools.find(x => x.tracks.cs && !(x.switch.lv.cs > 0 && x.switch.lv.cs <= 2.5));
  assert.ok(s, 'needs a school where computer science is hard to switch into');
  const row = st => ranker.rank(settings(), st).find(r => r.s.id === s.id);
  assert.equal(row({ targets: ['cs'], direct: {} }).mx.home, true);   // without applying directly, computer science is out of reach here
  const direct = row({ targets: ['cs'], direct: { [s.id]: ['cs'] } });
  assert.equal(direct.mx.parts[0].k, 'cs');
  assert.equal(direct.mx.direct, true);
});

test('each major tab ranks only schools that offer it', () => {
  for (const k of ranker.targets) {
    const rows = ranker.rank(settings(k), everyone);
    assert.ok(rows.length > 0, k);
    for (const r of rows) assert.ok(ranker.has(r.s, k), `${r.s.name} ${k}`);
  }
});

test('school names from applications match the ranked school', () => {
  const name = n => { const id = matchSchoolId(n, data.schools, expandAlias(n)); return id && data.schools.find(s => s.id === id).name; };
  assert.equal(name('Penn State University'), 'Penn State');
  assert.equal(name('University at Buffalo'), 'Buffalo');
  assert.equal(name('Arizona State University'), 'Arizona State');
  assert.equal(name('University of California, Davis'), 'UC Davis');
  assert.equal(name('Washington University in St. Louis'), 'WashU');
  assert.equal(name('University of Washington'), 'Washington');
  assert.equal(name('Harvard University'), 'Harvard University');
  // Boston College never matches Boston University.
  assert.equal(name('Boston College'), 'Boston College');
  assert.equal(name('Gotham University'), null);
  assert.equal(name('Penn State'), 'Penn State');
});

test('free-text majors map to the ranking\'s majors', () => {
  assert.deepEqual(majorKeysOf('Computer Science and Economics'), ['econ', 'cs']);
  assert.deepEqual(majorKeysOf('Data Science'), ['stats']);
  assert.deepEqual(majorKeysOf('Media Studies'), ['comm']);
  assert.deepEqual(majorKeysOf('Nursing'), ['nursing']);
  assert.deepEqual(majorKeysOf('Underwater Basket Weaving'), []);
});

test('reading a workspace for the rankings page never creates one', async () => {
  const os = require('node:os'), path = require('node:path');
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-career-'));
  const priorDir = process.env.CF_DATA_DIR, priorBlob = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.CF_DATA_DIR = directory; delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const { peekWorkspace } = require('../lib/store.ts');
    assert.equal(await peekWorkspace('missing-workspace-1'), null);
    const files = (await fs.promises.readdir(directory, { recursive: true })).filter(f => f.endsWith('.json'));
    assert.deepEqual(files, []);
  } finally {
    if (priorDir === undefined) delete process.env.CF_DATA_DIR; else process.env.CF_DATA_DIR = priorDir;
    if (priorBlob === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = priorBlob;
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test('any major works: schools that do not offer it rank last on My path', () => {
  const r = createRanker(data);
  const st = { track: 'path', va: false, col: true, stretch: false, w: { ...DEFAULT_WEIGHTS } };
  for (const k of r.majors.map((m) => m.key)) {
    const rows = r.rank(st, { targets: [k], direct: {} });
    assert.equal(rows.length, data.schools.length);
    assert.ok(rows.every((x) => Number.isFinite(x.score)), k);
    const firstNone = rows.findIndex((x) => x.mx.none);
    if (firstNone >= 0) assert.ok(rows.slice(firstNone).every((x) => x.mx.none), k);
  }
  const nursing = r.rank(st, { targets: ['nursing'], direct: {} });
  assert.ok(!nursing[0].mx.none);
  assert.equal(nursing[0].mx.parts[0].k, 'nursing');
});
