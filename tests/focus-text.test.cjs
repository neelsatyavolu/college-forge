const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { focusText } = require('../lib/web-search-tool.ts');

const filler = (n) => 'General information about the college and its programs. '.repeat(n);
const page = `Common Data Set 2025-2026 header. ${filler(800)} C7 Relative importance: Interview Not Considered X. Level of applicant's interest Considered X. ${filler(800)} C9 SAT Evidence-Based Reading 25th percentile 720 75th percentile 770. ${filler(800)}`;

test('short pages and pages without a purpose are cut from the top as before', () => {
  assert.equal(focusText('short', 'anything', 100), 'short');
  assert.equal(focusText(page, undefined, 500), page.slice(0, 500));
});

test('a long page keeps its opening and the sections the purpose names', () => {
  const out = focusText(page, 'C7 interview level of applicant interest, C9 SAT 25th 75th percentile', 6000);
  assert.ok(out.length <= 6000 + 200);
  assert.ok(out.startsWith('Common Data Set 2025-2026 header.'));
  assert.match(out, /Interview Not Considered X/);
  assert.match(out, /SAT Evidence-Based Reading 25th percentile 720/);
  assert.match(out, /\[…\]/);
  assert.ok(out.indexOf('C7 Relative') < out.indexOf('C9 SAT'), 'page order kept');
});
