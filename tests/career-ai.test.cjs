const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2021, esModuleInterop:true, resolveJsonModule:true}}).outputText, file);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request.startsWith('@/')) {
    const base = path.join(__dirname, '..', request.slice(2));
    return resolve.call(this, fs.existsSync(base + '.ts') ? base + '.ts' : base, ...args);
  }
  return resolve.call(this, request, ...args);
};
process.env.SESSION_SECRET = 'test-'.repeat(8); // made up, only signs test cookies
const { NextRequest } = require('next/server');
const { parseCareerAi } = require('../lib/career-ai.ts');
const { signSession } = require('../lib/session.ts');
const store = require('../lib/store.ts');
const me = require('../app/api/rankings/me/route.ts');
const ai = require('../app/api/rankings/me/ai/route.ts');

// Synthetic list: made-up reasons, schools from the public ranking.
const LIST = { about: 'A test list.', made: 'Jan 1, 2027', list: [
  { school: 'Purdue', rank: '1', why: 'Test reason one.' },
  { school: 'UC Davis', rank: 'T-2', why: 'Test reason two.' },
  { school: 'Tufts', rank: 'T-2', why: '' },
] };
const WS = 'career-ai-test-workspace';
const session = () => `forge_session=${signSession({ sub: 'test-sub', workspaceId: WS, email: 'test@example.com', name: 'Test' })}`;
const req = (method, { body, cookie = session(), origin } = {}) => new NextRequest('http://localhost/api/rankings/me/ai', {
  method, body, headers: { host: 'localhost', ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
});

async function isolated(run) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-career-ai-'));
  const prev = process.env.CF_DATA_DIR, blob = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.CF_DATA_DIR = dir; delete process.env.BLOB_READ_WRITE_TOKEN;
  try { await store.getWorkspace(WS); await run(dir); }
  finally {
    if (prev === undefined) delete process.env.CF_DATA_DIR; else process.env.CF_DATA_DIR = prev;
    if (blob !== undefined) process.env.BLOB_READ_WRITE_TOKEN = blob;
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

test('a judged list must have the expected shape', () => {
  assert.equal(parseCareerAi(JSON.stringify(LIST)).list.length, 3);
  assert.equal(parseCareerAi('not json'), null);
  assert.equal(parseCareerAi(JSON.stringify({ list: [] })), null);
  assert.equal(parseCareerAi(JSON.stringify({ list: [{ school: 'Purdue', rank: 'first' }] })), null);
  assert.equal(parseCareerAi(JSON.stringify({ list: [{ school: 'Purdue', rank: '1', why: 'x'.repeat(1501) }] })), null);
  // Extra fields are dropped, not stored.
  const parsed = parseCareerAi(JSON.stringify({ ...LIST, secret: 'x', list: [{ ...LIST.list[0], extra: 1 }] }));
  assert.equal('secret' in parsed, false);
  assert.equal('extra' in parsed.list[0], false);
});

test('only the signed-in account can save, read and remove its list', () => isolated(async () => {
  assert.equal((await ai.PUT(req('PUT', { body: JSON.stringify(LIST), cookie: 'cf_workspace=' + WS }))).status, 401);
  assert.equal((await ai.PUT(req('PUT', { body: JSON.stringify(LIST), origin: 'https://evil.example' }))).status, 403);
  assert.equal((await ai.PUT(req('PUT', { body: '{"list":[]}' }))).status, 400);
  assert.equal((await ai.PUT(req('PUT', { body: JSON.stringify(LIST), origin: 'http://localhost' }))).status, 200);

  const mine = await (await me.GET(new NextRequest('http://localhost/api/rankings/me', { headers: { cookie: session() } }))).json();
  assert.equal(mine.account, true);
  assert.deepEqual(mine.ai.list.map(x => x.school), ['Purdue', 'UC Davis', 'Tufts']);

  // The same workspace opened without the account cookie never sees the list.
  const anon = await (await me.GET(new NextRequest('http://localhost/api/rankings/me', { headers: { cookie: 'cf_workspace=' + WS } }))).json();
  assert.equal(anon.ai ?? null, null);

  // It is kept out of the workspace document, so shares and exports can't carry it.
  const doc = await store.getWorkspace(WS);
  assert.equal(JSON.stringify(doc).includes('Test reason one'), false);

  assert.equal((await ai.DELETE(req('DELETE'))).status, 200);
  const after = await (await me.GET(new NextRequest('http://localhost/api/rankings/me', { headers: { cookie: session() } }))).json();
  assert.equal(after.ai, null);
}));

test('a workspace reset removes the judged list', () => isolated(async () => {
  await ai.PUT(req('PUT', { body: JSON.stringify(LIST) }));
  assert.ok(await store.readCareerAiText(WS));
  await store.resetWorkspace(WS);
  assert.equal(await store.readCareerAiText(WS), null);
}));
