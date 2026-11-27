const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const N = require('../lib/nursing-admission.ts');

test('nursing students are recognized from their intended major', () => {
  for (const m of ['Nursing', 'nursing (BSN)', 'Pre-nursing', 'RN']) assert.equal(N.wantsNursing(m), true, m);
  for (const m of ['Computer Science', 'Business', '']) assert.equal(N.wantsNursing(m), false, m);
});

test('every researched entry is sourced to an official page and labelled for the student', () => {
  const data = require('../public/data/nursing-admission.json').colleges;
  assert.ok(Object.keys(data).length >= 40);
  for (const [slug, v] of Object.entries(data)) {
    assert.ok(['direct', 'competitive', 'both', 'none', null].includes(v.entry), slug);
    if (v.entry) assert.match(new URL(v.sourceUrl).hostname, /\.edu$/, slug);
  }
  assert.match(N.nursingLabel(N.nursingAdmission('purdue-university-main-campus')), /^Direct admit to nursing as a first-year/);
  assert.match(N.nursingLabel(N.nursingAdmission('university-of-florida')), /^Pre-nursing first/);
  assert.equal(N.nursingAdmission('no-such-college'), null);
});
