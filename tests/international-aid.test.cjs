const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const A = require('../lib/international-aid.ts');

const H6 = `H6        Indicate your institution’s policy regarding institutional scholarship and grant aid for undergraduate degree-seeking nonresidents:
    x     Institutional need-based scholarship or grant aid is available
    x     Institutional non-need-based scholarship or grant aid is available
          Institutional scholarship or grant aid is not available
          If institutional financial aid is available for undergraduate degree-seeking nonresidents, provide the number
                                                                                                                 510
          of undergraduate degree-seeking nonresidents who were awarded need-based or non-need-based aid:
          Average dollar amount of institutional financial aid awarded to undergraduate degree-seeking nonresidents:             $40,057
H7 Check off all financial aid forms`;

test('Common Data Set H6 parses into checkboxes, count and average', async () => {
  const { parseH6 } = await import('../scripts/research/intl-aid.mjs');
  assert.deepEqual(parseH6(H6), { needBased: true, meritBased: true, none: false, awarded: 510, average: 40057, total: null });
  assert.equal(parseH6('no such section'), null);
});

test('the label states the count and average, and colleges aiding none are flagged', () => {
  const aid = { needBased: true, meritBased: true, none: false, awarded: 510, average: 40057, cdsYear: '2025-26', source: 'x' };
  assert.equal(A.internationalAidLabel(aid), '510 international students got aid averaging $40,057 (CDS 2025-26)');
  assert.equal(A.aidsNoInternationals({ ...aid, awarded: 0 }), true);
  assert.equal(A.aidsNoInternationals(aid), false);
  assert.equal(A.internationalAidLabel(null), null);
});

test('the scraped data covers well-known colleges with sane values', () => {
  const data = require('../public/data/international-aid.json').colleges;
  assert.ok(Object.keys(data).length >= 50);
  for (const [slug, v] of Object.entries(data)) {
    if (v.average != null) assert.ok(v.average >= 0 && v.average < 130000, `${slug} average ${v.average}`);
    if (v.awarded != null) assert.ok(v.awarded >= 0 && v.awarded < 20000, `${slug} awarded ${v.awarded}`);
  }
});
