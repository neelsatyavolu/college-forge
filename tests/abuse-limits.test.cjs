const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.join(__dirname, '..', request.slice(2)) + '.ts' : request, ...args); };
process.env.CF_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-abuse-limits-'));
process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough-1234';
delete process.env.BLOB_READ_WRITE_TOKEN;

const { NextRequest } = require('next/server');
const store = require('../lib/store.ts');
const session = require('../lib/session.ts');
const { allow } = require('../lib/rate-limit.ts');
const chatRoute = require('../app/api/ai/chat/route.ts');
const searchRoute = require('../app/api/colleges/search/route.ts');
const recsRoute = require('../app/api/colleges/recommendations/route.ts');
const aidRoute = require('../app/api/aid/route.ts');

const HOUR = 60 * 60 * 1000;
const fill = async (bucket, n) => { for (let i = 0; i < n; i++) assert.equal(await allow(bucket, 1000, HOUR), true); };
const chat = (headers) => chatRoute.POST(new NextRequest('http://localhost/api/ai/chat', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
}));

test('AI chat is capped per address when signed out, before any model call', async () => {
  await fill('ai-chat:ip:203.0.113.9', 400);
  const res = await chat({ 'x-forwarded-for': '203.0.113.9' });
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /try again/i);
});

test('AI chat is capped per account when signed in, whatever the address', async () => {
  await fill('ai-chat:sub:xa_LIMITED', 200);
  const cookie = `forge_session=${session.signSession({ sub: 'xa_LIMITED', workspaceId: 'limited-ws-1', email: 'l@x.co', name: 'L' })}`;
  for (const ip of ['198.51.100.1', '198.51.100.2']) assert.equal((await chat({ cookie, 'x-forwarded-for': ip })).status, 429);
});

test('college search is capped per address before the Scorecard fetch', async () => {
  const prevKey = process.env.COLLEGE_SCORECARD_API_KEY, realFetch = globalThis.fetch;
  process.env.COLLEGE_SCORECARD_API_KEY = 'test-key';
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; return Response.json({ results: [] }); };
  try {
    await fill('college-search:203.0.113.20', 600);
    const res = await searchRoute.GET(new NextRequest('http://localhost/api/colleges/search?q=rice', { headers: { 'x-forwarded-for': '203.0.113.20' } }));
    assert.equal(res.status, 429);
    assert.equal(fetched, 0);
    const other = await searchRoute.GET(new NextRequest('http://localhost/api/colleges/search?q=rice', { headers: { 'x-forwarded-for': '203.0.113.21' } }));
    assert.equal(other.status, 200);
  } finally {
    globalThis.fetch = realFetch;
    if (prevKey === undefined) delete process.env.COLLEGE_SCORECARD_API_KEY; else process.env.COLLEGE_SCORECARD_API_KEY = prevKey;
  }
});

test('a failed college search returns a fixed message and logs only the error name', async () => {
  const prevKey = process.env.COLLEGE_SCORECARD_API_KEY, realFetch = globalThis.fetch, realError = console.error;
  process.env.COLLEGE_SCORECARD_API_KEY = 'test-key';
  const logged = [];
  console.error = (...args) => logged.push(args.map(String).join(' '));
  globalThis.fetch = async () => new Response('UPSTREAM-SECRET-DETAIL api_key=test-key', { status: 500 });
  try {
    const res = await searchRoute.GET(new NextRequest('http://localhost/api/colleges/search?q=rice', { headers: { 'x-forwarded-for': '203.0.113.30' } }));
    assert.equal(res.status, 502);
    const body = await res.text();
    assert.doesNotMatch(body, /UPSTREAM-SECRET|Scorecard 500|test-key/);
    assert.match(JSON.parse(body).error, /try again/i);
    assert.doesNotMatch(logged.join('\n'), /UPSTREAM-SECRET|test-key/);
  } finally {
    console.error = realError;
    globalThis.fetch = realFetch;
    if (prevKey === undefined) delete process.env.COLLEGE_SCORECARD_API_KEY; else process.env.COLLEGE_SCORECARD_API_KEY = prevKey;
  }
});

test('anonymous reads of aid, recommendations and college browse never create a workspace', async () => {
  const id = 'anon-read-only-1';
  const req = (url) => new NextRequest(url, { headers: { cookie: `cf_workspace=${id}` } });
  const responses = [
    await aidRoute.GET(req('http://localhost/api/aid')),
    await recsRoute.GET(req('http://localhost/api/colleges/recommendations')),
    await searchRoute.GET(req('http://localhost/api/colleges/search?browse=1')),
  ];
  for (const r of responses) assert.equal(r.status, 200);
  assert.equal((await responses[0].json()).success, true);
  assert.equal(await store.peekWorkspace(id), null);
});
