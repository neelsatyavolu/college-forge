const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  return resolve.call(this, request.startsWith('@/') ? path.join(__dirname, '..', request.slice(2)) + '.ts' : request, ...args);
};

process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough-1234';
process.env.PORTAL_LOGINS_KEY = crypto.randomBytes(32).toString('base64');

const { NextRequest } = require('next/server');
const oauth = require('../lib/oauth.ts');
const session = require('../lib/session.ts');
const service = require('../lib/tracker-service.ts');
const loginsRoute = require('../app/api/cli/logins/route.ts');
const authorizeRoute = require('../app/oauth/authorize/route.ts');

async function isolated(run) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-cli-'));
  const prev = process.env.CF_DATA_DIR, blob = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.CF_DATA_DIR = dir;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try { await run(); } finally {
    if (prev === undefined) delete process.env.CF_DATA_DIR; else process.env.CF_DATA_DIR = prev;
    if (blob !== undefined) process.env.BLOB_READ_WRITE_TOKEN = blob;
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

const pkce = () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};
const CB = 'http://127.0.0.1:45123/callback';

async function tokenFor(ws, { logins }) {
  const client = await oauth.registerClient({ client_name: 'collegeforge CLI', redirect_uris: [CB] });
  const { verifier, challenge } = pkce();
  const code = await oauth.issueCode(client, CB, challenge, 'xa_CLI', ws, { logins });
  const t = await oauth.exchange(new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: CB, code_verifier: verifier }));
  return t;
}

const get = (token, ids) => loginsRoute.GET(new NextRequest(`https://forge.test/api/cli/logins${ids ? `?ids=${ids}` : ''}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }));

async function seeded() {
  const ws = 'cli-ws-1';
  const a = await service.addApp(ws, { name: 'Purdue University' });
  const b = await service.addApp(ws, { name: 'University at Buffalo' });
  await service.setLogin(ws, a.id, { username: 'pu', password: 'purdue-pass' });
  await service.setLogin(ws, b.id, { username: 'ub', password: 'buffalo-pass' });
  return { ws, a, b };
}

test('logins endpoint 401 without token', () => isolated(async () => {
  const res = await get(null);
  assert.equal(res.status, 401);
}));

test('logins endpoint 403 for an applications-only grant', () => isolated(async () => {
  const { ws } = await seeded();
  const t = await tokenFor(ws, { logins: false });
  assert.equal(t.scope, 'applications');
  const res = await get(t.access_token);
  assert.equal(res.status, 403);
  assert.doesNotMatch(await res.text(), /purdue-pass|buffalo-pass/);
}));

test('logins endpoint returns only the asked ids for a logins grant', () => isolated(async () => {
  const { ws, a } = await seeded();
  const t = await tokenFor(ws, { logins: true });
  assert.equal(t.scope, 'applications logins');
  const res = await get(t.access_token, a.id);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.deepEqual(Object.keys(body.logins), [a.id]);
  assert.equal(body.logins[a.id].password, 'purdue-pass');
  assert.match(body.logins[a.id].portalUrl, /^https:\/\//);
}));

test('a refreshed token keeps the logins scope', () => isolated(async () => {
  const { ws } = await seeded();
  const t = await tokenFor(ws, { logins: true });
  const r = await oauth.exchange(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh_token }));
  assert.equal(r.scope, 'applications logins');
  assert.equal((await get(r.access_token)).status, 200);
}));

test('the logins scope is refused for a non-loopback redirect', () => isolated(async () => {
  const client = await oauth.registerClient({ client_name: 'Grok', redirect_uris: ['https://grok.com/cb'] });
  const { challenge } = pkce();
  const q = new URLSearchParams({ client_id: client.client_id, redirect_uri: 'https://grok.com/cb', response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', scope: 'applications logins' });
  await assert.rejects(oauth.checkAuthorize(q), /passwords/);
}));

test('consent page names password access only when logins is requested', () => isolated(async () => {
  const client = await oauth.registerClient({ client_name: 'collegeforge CLI', redirect_uris: [CB] });
  const { challenge } = pkce();
  const cookie = `forge_session=${session.signSession({ sub: 'xa_CLI', workspaceId: 'cli-ws-1', email: 'a@b.co', name: 'A' })}`;
  const page = async (scope) => {
    const q = new URLSearchParams({ client_id: client.client_id, redirect_uri: CB, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', ...(scope ? { scope } : {}) });
    return (await authorizeRoute.GET(new NextRequest(`https://forge.test/oauth/authorize?${q}`, { headers: { cookie } }))).text();
  };
  assert.match(await page('applications logins'), /saved portal usernames and passwords/);
  assert.doesNotMatch(await page(''), /saved portal usernames and passwords/);
}));
