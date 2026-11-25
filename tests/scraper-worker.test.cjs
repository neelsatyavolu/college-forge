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
