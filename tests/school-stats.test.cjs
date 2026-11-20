const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { pickRow, statsFromRow, lookupStats, SCORECARD_IDS } = require('../lib/school-stats.ts');

const row = (name, url, rate) => ({ id: 1, 'school.name': name, 'school.school_url': url, 'latest.admissions.admission_rate.overall': rate,
  'latest.admissions.sat_scores.25th_percentile.critical_reading': 700, 'latest.admissions.sat_scores.25th_percentile.math': 740,
  'latest.admissions.sat_scores.75th_percentile.critical_reading': 770, 'latest.admissions.sat_scores.75th_percentile.math': 800 });

test('the school is matched by website before name, and a near miss is not taken', () => {
  const rows = [row('Columbia College', 'colum.edu', 0.9), row('Columbia University in the City of New York', 'www.columbia.edu/', 0.039)];
  assert.equal(pickRow(rows, 'Columbia University', 'columbia.edu')['school.school_url'], 'www.columbia.edu/');
  assert.equal(pickRow(rows, 'Columbia University', ''), null);
  assert.equal(pickRow(rows, 'Columbia College', '')['school.name'], 'Columbia College');
  assert.equal(pickRow([row('Indiana University-Bloomington', 'bloomington.iu.edu', 0.78)], 'Indiana University Bloomington', 'iu.edu')['school.name'], 'Indiana University-Bloomington');
  assert.equal(pickRow([row('Washington University in St Louis', 'washu.edu', 0.12)], 'Washington University in St. Louis', 'wustl.edu')['school.name'], 'Washington University in St Louis');
});

test('rates and SAT bands read as the shortlist stores them', () => {
  assert.deepEqual(statsFromRow(row('X', 'x.edu', 0.0391), 't'), { admit: '3.9%', satRange: '1440–1570', scorecardId: 1, checkedAt: 't' });
});

test('schools Scorecard cannot find by name are looked up by their flagship id', async () => {
  assert.deepEqual(SCORECARD_IDS, { psu: 214777, rutgers: 186380, unc: 199120 });
  const oldKey = process.env.COLLEGE_SCORECARD_API_KEY, oldFetch = global.fetch;
  process.env.COLLEGE_SCORECARD_API_KEY = 'test-key';
  let asked;
  global.fetch = async (url) => { asked = new URL(url); return { ok: true, json: async () => ({ results: [{ ...row('Pennsylvania State University-Main Campus', 'https://psu.edu/', 0.6056), id: 214777 }] }) }; };
  try {
    const stats = await lookupStats({ id: 'a1', collegeId: 'psu', name: 'Penn State' }, 't');
    assert.equal(asked.searchParams.get('id'), '214777');
    assert.equal(asked.searchParams.get('school.name'), null);
    assert.equal(stats.admit, '60.6%');
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.COLLEGE_SCORECARD_API_KEY; else process.env.COLLEGE_SCORECARD_API_KEY = oldKey;
  }
});
