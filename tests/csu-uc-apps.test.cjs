const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { isCsuCampus } = require('../lib/seed-college-list.ts');
const T = require('../lib/interview-tools.ts');
const hub = require('../public/hub/essay-archetypes.js');

const CSU = ['California State University-Northridge', 'Cal State Northridge', 'CSU Long Beach', 'San Jose State University', 'San José State University', 'Cal Poly Pomona', 'California Polytechnic State University-San Luis Obispo', 'Cal Poly Humboldt', 'San Diego State University', 'Fresno State'];
const NOT = ['Colorado State University', 'Cleveland State University', 'Arizona State University', 'University of California, Los Angeles', 'Ohio State University', 'Portland State University', 'Florida State University'];

test('Cal State campuses are recognized; other "State" schools are not', () => {
  for (const name of CSU) { assert.equal(isCsuCampus({ name }), true, name); assert.equal(hub.isCsuCampus({ name }), true, `hub: ${name}`); }
  for (const name of NOT) { assert.equal(isCsuCampus({ name }), false, name); assert.equal(hub.isCsuCampus({ name }), false, `hub: ${name}`); }
});

test('all UC campuses are one application, and so are all Cal States', () => {
  const list = [
    { name: 'University of California, Berkeley' }, { name: 'University of California, Davis' },
    { name: 'Cal State Northridge' }, { name: 'San Diego State University' }, { name: 'Cal Poly Pomona' },
    { name: 'Rice University' },
  ];
  assert.equal(T.applicationCount(list), 3);
  assert.equal(hub.applicationCount(list), 3);
});

test('Cal State campuses on a draft list never need supplements; UC campuses always share them', () => {
  const [csu, uc] = T.parseSchools([{ name: 'San Jose State University', tier: 'likely', reason: 'x', supplements: 'yes' }, { name: 'University of California, Irvine', tier: 'target', reason: 'x', supplements: 'no' }]);
  assert.equal(csu.supplements, 'no');
  assert.equal(uc.supplements, 'yes');
});
