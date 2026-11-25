const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.join(__dirname, '..', request.slice(2)) + '.ts' : request, ...args); };
process.env.CF_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-test-login-'));
delete process.env.BLOB_READ_WRITE_TOKEN;
process.env.SESSION_SECRET = 'synthetic-session-secret-for-the-test-login-0123';
const { NextRequest } = require('next/server');
const { GET } = require('../app/api/test-login/route.ts');
const { proxy } = require('../proxy.ts');
const { readSession, signSession, SESSION_COOKIE } = require('../lib/session.ts');
const { getWorkspace, updateWorkspace } = require('../lib/store.ts');

const KEY = 'k'.repeat(40);
const req = (q, ip) => new NextRequest(`https://forge.test/api/test-login${q}`, { headers: { 'x-forwarded-for': ip } });
const cookieOf = (res) => /forge_session=([^;]+)/.exec(res.headers.get('set-cookie') || '')?.[1];

test('test login is off without a key, and a wrong key looks the same', async () => {
  delete process.env.FORGE_TEST_LOGIN_KEY;
  assert.equal((await GET(req(`?key=${KEY}`, '1.1.1.1'))).status, 404);
  process.env.FORGE_TEST_LOGIN_KEY = KEY;
  assert.equal((await GET(req('?key=nope', '1.1.1.2'))).status, 404);
  assert.equal((await GET(req('', '1.1.1.3'))).status, 404);
});

test('the right key signs in the fixed test student, and reset empties its workspace', async () => {
  process.env.FORGE_TEST_LOGIN_KEY = KEY;
  const res = await GET(req(`?key=${KEY}`, '2.2.2.2'));
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /\/hub\/index\.html$/);
  const session = readSession(cookieOf(res));
  assert.equal(session.sub, 'forge-test-student');
  await updateWorkspace(session.workspaceId, (w) => ({ ...w, applicant: { ...w.applicant, name: 'Someone' } }));
  const again = readSession(cookieOf(await GET(req(`?key=${KEY}&reset=1`, '2.2.2.2'))));
  assert.equal(again.workspaceId, session.workspaceId, 'same test workspace every time');
  assert.equal((await getWorkspace(session.workspaceId)).applicant.name, '', 'reset gives a fresh workspace');
});

test('guessing is rate limited', async () => {
  process.env.FORGE_TEST_LOGIN_KEY = KEY;
  let last;
  for (let i = 0; i < 11; i++) last = await GET(req('?key=wrong', '3.3.3.3'));
  assert.equal(last.status, 429);
});

test('signed-in visitors to / go straight to the workspace; ?home still shows the landing page', async () => {
  const cookie = `${SESSION_COOKIE}=${signSession({ sub: 'x-user', workspaceId: 'ws-12345678', email: 'a@b.c', name: 'A' })}`;
  const home = (url, headers = {}) => proxy(new NextRequest(url, { headers: { host: 'forge.xanom.co', ...headers } }));
  const signedIn = await home('https://forge.xanom.co/', { cookie });
  assert.equal(signedIn.status, 307);
  assert.match(signedIn.headers.get('location'), /\/hub\/index\.html$/);
  assert.notEqual((await home('https://forge.xanom.co/')).status, 307, 'signed out sees the landing page');
  assert.notEqual((await home('https://forge.xanom.co/?home', { cookie })).status, 307);
  assert.notEqual((await home('https://forge.xanom.co/', { cookie: `${SESSION_COOKIE}=forged.value` })).status, 307, 'a forged cookie is ignored');
});
