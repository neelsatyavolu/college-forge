const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true } }).outputText, file);
const { isPublicPageUrl, firecrawlBase } = require('../lib/firecrawl.ts');
const { runWebFetch, runWebSearch } = require('../lib/web-search-tool.ts');

function withEnv(env, fn) {
  const keys = ['FIRECRAWL_API_URL', 'FIRECRAWL_API_KEY', 'EXA_API_KEY', 'WEB_SEARCH_API_KEY', 'TINYFISH_API_KEY'];
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  const realFetch = global.fetch;
  return Promise.resolve(fn()).finally(() => {
    global.fetch = realFetch;
    for (const k of keys) if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k];
  });
}

test('only public pages pass', () => {
  for (const ok of ['https://admissions.tufts.edu/apply', 'http://8.8.8.8/x']) assert.equal(isPublicPageUrl(ok), true, ok);
  for (const bad of ['http://localhost:3000', 'http://127.0.0.1/', 'http://10.0.0.5', 'http://192.168.1.1', 'http://169.254.169.254/latest', 'http://[::1]/', 'http://intranet/', 'http://box.internal/', 'file:///etc/passwd', 'https://user:pw@example.com/']) {
    assert.equal(isPublicPageUrl(bad), false, bad);
  }
});

test('base URL comes only from the environment', () => withEnv({ FIRECRAWL_API_URL: 'https://crawl.example.com/' }, () => {
  assert.equal(firecrawlBase(), 'https://crawl.example.com');
  process.env.FIRECRAWL_API_URL = 'ftp://x';
  assert.equal(firecrawlBase(), null);
}));

test('web_fetch reads through Firecrawl with the bearer key', () => withEnv({ FIRECRAWL_API_URL: 'https://crawl.example.com', FIRECRAWL_API_KEY: 'k' }, async () => {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push([url, init.headers.authorization, JSON.parse(init.body)]);
    return new Response(JSON.stringify({ success: true, data: { markdown: '# Class profile\nAdmit rate 9%', metadata: { title: 'Profile', sourceURL: 'https://tufts.edu/p' } } }));
  };
  const r = await runWebFetch('https://tufts.edu/p');
  assert.equal(r.ok, true);
  assert.match(r.content, /via Firecrawl[\s\S]*Admit rate 9%/);
  assert.deepEqual(calls[0].slice(0, 2), ['https://crawl.example.com/v2/scrape', 'Bearer k']);
  assert.equal(calls[0][2].url, 'https://tufts.edu/p');
  const blocked = await runWebFetch('http://169.254.169.254/latest');
  assert.equal(blocked.ok, false);
  assert.equal(calls.length, 1);
}));

test('web_search works with Firecrawl alone and deep-reads top pages', () => withEnv({ FIRECRAWL_API_URL: 'https://crawl.example.com' }, async () => {
  global.fetch = async (url, init) => {
    if (url.endsWith('/v2/search')) return new Response(JSON.stringify({ success: true, data: { web: [{ url: 'https://a.edu/cds', title: 'CDS', description: 'C1' }] } }));
    return new Response(JSON.stringify({ success: true, data: { markdown: 'Applicants 30,000', metadata: { title: 'CDS' } } }));
  };
  const r = await runWebSearch('A University common data set');
  assert.equal(r.ok, true);
  assert.match(r.content, /via Firecrawl/);
  assert.match(r.content, /Deep-read pages \(Firecrawl\)[\s\S]*Applicants 30,000/);
}));

test('web_fetch refuses private addresses before any provider sees them', () => withEnv({ TINYFISH_API_KEY: 'tf' }, async () => {
  let called = false;
  global.fetch = async () => { called = true; return new Response('{}'); };
  const r = await runWebFetch('http://10.0.0.5/admin');
  assert.equal(r.ok, false);
  assert.equal(called, false);
}));
