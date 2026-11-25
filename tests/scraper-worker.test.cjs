const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true } }).outputText, file);
const { isAllowedUrl, tokensMatch } = require('../workers/scraper/src/url.ts');

test('refuses local, private, metadata and non-http URLs', () => {
  for (const url of [
    'http://localhost/x',
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.1/',
    'http://192.168.1.4/',
    'http://[::1]/',
    'file:///etc/passwd',
    'https://user:pw@example.com/',
    'http://intranet/',
    'https://printer.local/',
    'not a url',
  ]) assert.equal(isAllowedUrl(url), false, url);
});

test('allows public school pages', () => {
  assert.equal(isAllowedUrl('https://admissions.yale.edu/apply'), true);
  assert.equal(isAllowedUrl('http://www.williams.edu/'), true);
});

test('token check needs an exact match', () => {
  assert.equal(tokensMatch('abc', 'abc'), true);
  assert.equal(tokensMatch('abc', 'abd'), false);
  assert.equal(tokensMatch('', ''), false);
  assert.equal(tokensMatch('abc', 'abcd'), false);
});

const { layoutPage } = require('../workers/scraper/src/layout.ts');
test('PDF layout keeps checkbox columns under their headers', () => {
  const items = [
    { str: 'Very Important', x: 300, y: 700 }, { str: 'Important', x: 380, y: 700 }, { str: 'Considered', x: 450, y: 700 },
    { str: 'Interview', x: 40, y: 680 }, { str: 'X', x: 455, y: 680.8 },
    { str: "Level of applicant's interest", x: 40, y: 660 }, { str: 'X', x: 385, y: 660 },
  ];
  const lines = layoutPage(items).split('\n');
  assert.equal(lines.length, 3);
  const col = (line, s) => line.indexOf(s);
  assert.ok(Math.abs(col(lines[1], 'X') - col(lines[0], 'Considered')) <= 2, 'interview X under Considered');
  const important = lines[0].indexOf('Important', col(lines[0], 'Very Important') + 'Very Important'.length);
  assert.ok(Math.abs(col(lines[2], 'X') - important) <= 2, 'interest X under Important');
});
