const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http2 = require('node:http2');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  return resolve.call(this, request.startsWith('@/') ? path.join(__dirname, '..', request.slice(2)) + '.ts' : request, ...args);
};

process.env.SESSION_SECRET = 'ios-test-session-secret-0123456789abcdef';
process.env.PORTAL_LOGINS_KEY = Buffer.alloc(32, 9).toString('base64');
process.env.FORGE_SERVICE_KEY = 'svc-test-key';
process.env.RESEND_API_KEY = 're_test';
process.env.FORGE_ORIGIN = 'https://forge.test';

const { NextRequest } = require('next/server');
const { proxy } = require('../proxy.ts');
const session = require('../lib/session.ts');
const oauth = require('../lib/oauth.ts');
const service = require('../lib/tracker-service.ts');
const { runChecks } = require('../lib/portal-check.ts');
const devices = require('../lib/notify/devices.ts');
const apns = require('../lib/notify/apns.ts');
const route = require('../app/api/devices/route.ts');

const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);
const REDIRECT = 'collegeforge://oauth/callback';

async function isolated(run) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-ios-'));
  const prev = process.env.CF_DATA_DIR, blob = process.env.BLOB_READ_WRITE_TOKEN, realFetch = globalThis.fetch, realConnect = http2.connect;
  process.env.CF_DATA_DIR = dir;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try { await run(dir); } finally {
    globalThis.fetch = realFetch;
    http2.connect = realConnect;
    for (const k of ['APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_PRIVATE_KEY', 'APNS_BUNDLE_ID']) delete process.env[k];
    apns.resetTokenCache();
    if (prev === undefined) delete process.env.CF_DATA_DIR; else process.env.CF_DATA_DIR = prev;
    if (blob !== undefined) process.env.BLOB_READ_WRITE_TOKEN = blob;
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

async function account(sub = 'xa_IOSTEST') {
  return session.signInAccount({ sub, email: `${sub.toLowerCase()}@example.com`, name: 'Test Student' }, null);
}

async function accessToken(acct, redirect = REDIRECT) {
  const client = await oauth.registerClient({ client_name: 'Forge for iPhone', redirect_uris: [redirect] });
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const code = await oauth.issueCode(client, redirect, challenge, acct.sub, acct.workspaceId);
  const t = await oauth.exchange(new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect }));
  return t.access_token;
}

/** An app sign-in for the account, as the proxy hands it to the devices route. */
async function appGrant(acct) {
  const t = await accessToken(acct);
  const auth = await oauth.verifyAccess(`Bearer ${t}`);
  return { sub: auth.sub, grantId: auth.grantId };
}

/** The Cookie header Next will hand the route after the proxy rewrote the request. */
function forwardedCookie(res) {
  return res.headers.get('x-middleware-request-cookie');
}

// ── proxy ────────────────────────────────────────────────────────────────

test('proxy turns an app bearer token into a signed session cookie', () => isolated(async () => {
  const acct = await account();
  const token = await accessToken(acct);
  const res = await proxy(new NextRequest('https://forge.xanom.co/api/workspace', {
    headers: { 'x-forge-app': 'ios', authorization: `Bearer ${token}`, cookie: 'cf_workspace=someoneelse123; forge_session=forged; theme=dark' },
  }));
  assert.equal(res.status, 200);
  const cookie = forwardedCookie(res);
  assert.ok(cookie, 'request cookie overridden');
  assert.ok(!cookie.includes('cf_workspace'), 'anonymous workspace cookie dropped');
  assert.ok(!cookie.includes('forge_session=forged'), 'old session replaced');
  assert.ok(cookie.includes('theme=dark'), 'unrelated cookies kept');
  const value = cookie.match(/forge_session=([^;]+)/)[1];
  const s = session.readSession(value);
  assert.equal(s.sub, acct.sub);
  assert.equal(s.workspaceId, acct.workspaceId);
  assert.equal(res.headers.get('x-middleware-request-authorization'), null, 'bearer token not forwarded');
  const auth = await oauth.verifyAccess(`Bearer ${token}`);
  assert.equal(auth.app, true);
  assert.equal(res.headers.get('x-middleware-request-x-forge-app-grant'), auth.grantId, 'grant id passed to the route');
}));

test('proxy refuses assistant and CLI tokens: only the app grant is a session', () => isolated(async () => {
  const acct = await account();
  for (const redirect of ['https://claude.ai/api/mcp/auth_callback', 'http://127.0.0.1:8765/callback', 'collegeforge://oauth/other']) {
    const token = await accessToken(acct, redirect);
    assert.equal((await oauth.verifyAccess(`Bearer ${token}`)).app, false, redirect);
    const res = await proxy(new NextRequest('https://forge.xanom.co/api/workspace', { method: 'POST', headers: { 'x-forge-app': 'ios', authorization: `Bearer ${token}` } }));
    assert.equal(res.status, 403, redirect);
    assert.equal(forwardedCookie(res), null);
  }
}));

test('the app flag survives refresh-token rotation', () => isolated(async () => {
  const acct = await account();
  const client = await oauth.registerClient({ client_name: 'Forge for iPhone', redirect_uris: [REDIRECT] });
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const code = await oauth.issueCode(client, REDIRECT, challenge, acct.sub, acct.workspaceId);
  const first = await oauth.exchange(new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT }));
  const next = await oauth.exchange(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: first.refresh_token }));
  assert.equal((await oauth.verifyAccess(`Bearer ${next.access_token}`)).app, true);
}));

test('a client-sent grant header never reaches a route', () => isolated(async () => {
  const res = await proxy(new NextRequest('https://forge.xanom.co/api/devices', { method: 'POST', headers: { 'x-forge-app-grant': 'forgedgrant1' } }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-middleware-request-x-forge-app-grant'), null);
  assert.match(res.headers.get('x-middleware-override-headers') ?? '', /^(?!.*x-forge-app-grant)/);
}));

test('proxy rejects a bad or missing app token with 401 JSON', () => isolated(async () => {
  for (const auth of [undefined, 'Bearer nope', `Bearer ${'x'.repeat(43)}`]) {
    const headers = { 'x-forge-app': 'ios', ...(auth ? { authorization: auth } : {}) };
    const res = await proxy(new NextRequest('https://forge.xanom.co/api/me', { headers }));
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { success: false, error: 'Please sign in again.' });
  }
}));

test('proxy rejects a token whose grant was disconnected', () => isolated(async () => {
  const acct = await account();
  const token = await accessToken(acct);
  for (const g of await oauth.listGrants(acct.sub)) await oauth.revokeGrant(acct.sub, g.grantId);
  const res = await proxy(new NextRequest('https://forge.xanom.co/api/me', { headers: { 'x-forge-app': 'ios', authorization: `Bearer ${token}` } }));
  assert.equal(res.status, 401);
}));

test('proxy leaves web requests and bearer-auth routes alone', () => isolated(async () => {
  const headers = { 'x-forge-app': 'ios', authorization: 'Bearer nope' };
  for (const p of ['/mcp', '/oauth/token', '/api/cron/portal-checks', '/api/cli/logins', '/api/xanom/summary', '/api/service/inbox', '/hub/index.html']) {
    const res = await proxy(new NextRequest(`https://forge.xanom.co${p}`, { headers }));
    assert.equal(res.status, 200, p);
    assert.equal(forwardedCookie(res), null, p);
  }
  const web = await proxy(new NextRequest('https://forge.xanom.co/api/workspace', { headers: { authorization: 'Bearer nope' } }));
  assert.equal(web.status, 200);
  assert.equal(forwardedCookie(web), null);
}));

test('proxy still redirects the old host first', () => isolated(async () => {
  const res = await proxy(new NextRequest('https://forge.n3el.dev/api/me', { headers: { host: 'forge.n3el.dev', 'x-forge-app': 'ios' } }));
  assert.equal(res.status, 308);
  assert.equal(res.headers.get('location'), 'https://forge.xanom.co/api/me');
}));

// ── /api/devices ─────────────────────────────────────────────────────────

function deviceReq(method, body, acct, extra = {}) {
  const headers = { 'content-type': 'application/json', 'x-forge-app-grant': 'testgrant01', ...extra };
  if (acct) headers.cookie = `forge_session=${session.signSession({ sub: acct.sub, workspaceId: acct.workspaceId, email: acct.email, name: acct.name })}`;
  return new NextRequest('https://forge.xanom.co/api/devices', { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

test('devices route needs a signed-in account', () => isolated(async () => {
  for (const m of ['GET', 'POST', 'PATCH', 'DELETE']) {
    const res = await route[m](deviceReq(m, m === 'GET' ? undefined : { token: TOKEN_A, environment: 'sandbox' }));
    assert.equal(res.status, 401, m);
    assert.equal((await res.json()).success, false);
  }
}));

test('devices route validates input', () => isolated(async () => {
  const acct = await account();
  const bad = [null, {}, { token: 'abc', environment: 'sandbox' }, { token: 'z'.repeat(64), environment: 'sandbox' }, { token: TOKEN_A, environment: 'dev' }, { token: 'a'.repeat(201), environment: 'production' }];
  for (const body of bad) assert.equal((await route.POST(deviceReq('POST', body, acct))).status, 400, JSON.stringify(body));
  assert.equal((await route.PATCH(deviceReq('PATCH', { pushEnabled: 'yes' }, acct))).status, 400);
  assert.equal((await route.DELETE(deviceReq('DELETE', {}, acct))).status, 400);
}));

test('devices route only registers through the app, from Forge, as JSON', () => isolated(async () => {
  const acct = await account();
  const body = { token: TOKEN_A, environment: 'sandbox' };
  const web = deviceReq('POST', body, acct);
  web.headers.delete('x-forge-app-grant');
  assert.equal((await route.POST(web)).status, 403, 'web session cannot register');
  for (const m of ['POST', 'PATCH', 'DELETE']) {
    const b = m === 'PATCH' ? { pushEnabled: false } : body;
    assert.equal((await route[m](deviceReq(m, b, acct, { origin: 'https://evil.xanom.co' }))).status, 403, `${m} cross-origin`);
    assert.equal((await route[m](deviceReq(m, b, acct, { 'content-type': 'text/plain' }))).status, 403, `${m} text/plain`);
  }
  assert.equal((await route.POST(deviceReq('POST', body, acct, { origin: 'https://forge.xanom.co' }))).status, 200);
  const stored = (await devices.readDevices(acct.workspaceId)).devices[0];
  assert.equal(stored.grantId, 'testgrant01');
  assert.equal(stored.sub, acct.sub);
}));

test('devices route registers, dedupes, toggles and removes', () => isolated(async () => {
  const acct = await account();
  let body = await (await route.POST(deviceReq('POST', { token: TOKEN_A.toUpperCase(), environment: 'sandbox' }, acct))).json();
  assert.deepEqual(body, { success: true, data: { pushEnabled: true, count: 1 }, error: null });
  await route.POST(deviceReq('POST', { token: TOKEN_A, environment: 'production' }, acct));
  const stored = await devices.readDevices(acct.workspaceId);
  assert.equal(stored.devices.length, 1);
  assert.equal(stored.devices[0].environment, 'production');
  assert.ok(stored.devices[0].createdAt && stored.devices[0].lastSeen);
  body = await (await route.PATCH(deviceReq('PATCH', { pushEnabled: false }, acct))).json();
  assert.deepEqual(body.data, { pushEnabled: false, count: 1 });
  assert.deepEqual((await (await route.GET(deviceReq('GET', undefined, acct))).json()).data, { pushEnabled: false, count: 1 });
  body = await (await route.DELETE(deviceReq('DELETE', { token: TOKEN_A }, acct))).json();
  assert.equal(body.data.count, 0);
}));

test('devices keep at most ten and a token moves between accounts', () => isolated(async () => {
  const one = await account('xa_ONE');
  const two = await account('xa_TWO');
  const g = { sub: one.sub, grantId: 'grant0001' };
  for (let i = 0; i < 12; i++) await devices.registerDevice(one.workspaceId, i.toString(16).padStart(64, 'c'), 'sandbox', g, 1000 + i);
  assert.equal((await devices.readDevices(one.workspaceId)).devices.length, 10);
  await devices.registerDevice(two.workspaceId, 'b'.padStart(64, 'c'), 'sandbox', { sub: two.sub, grantId: 'grant0002' });
  assert.ok(!(await devices.readDevices(one.workspaceId)).devices.some((d) => d.token === 'b'.padStart(64, 'c')));
  assert.equal((await devices.readDevices(two.workspaceId)).devices.length, 1);
}));

// ── APNs ─────────────────────────────────────────────────────────────────

function apnsEnv() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  process.env.APNS_KEY_ID = 'KEYID12345';
  process.env.APNS_TEAM_ID = 'TEAM123456';
  process.env.APNS_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, '\\n');
  return publicKey;
}

/** Replaces http2.connect. `reply(token)` gives [status, reason] for each push. */
function fakeApns(reply = () => [200, '']) {
  const sent = [];
  http2.connect = (host) => {
    const sessionObj = new EventEmitter();
    sessionObj.close = () => undefined;
    sessionObj.request = (headers) => {
      const stream = new EventEmitter();
      stream.setTimeout = () => undefined;
      stream.setEncoding = () => undefined;
      stream.close = () => undefined;
      stream.end = (payload) => {
        const token = headers[':path'].split('/').pop();
        sent.push({ host, headers, token, payload: JSON.parse(payload) });
        const answer = reply(token, host);
        if (!answer) return;
        const [status, reason] = answer;
        setImmediate(() => {
          stream.emit('response', { ':status': status });
          if (reason) stream.emit('data', JSON.stringify({ reason }));
          stream.emit('close');
        });
      };
      return stream;
    };
    return sessionObj;
  };
  return sent;
}

test('provider JWT is ES256, verifiable and cached', () => isolated(async () => {
  const pub = apnsEnv();
  const cfg = apns.apnsConfig();
  assert.equal(cfg.bundleId, 'co.xanom.forge');
  assert.ok(cfg.privateKey.includes('\n'), '\\n-escaped key is unescaped');
  const jwt = apns.providerToken(cfg, 1_000_000);
  const [h, p, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'ES256', kid: 'KEYID12345' });
  assert.deepEqual(JSON.parse(Buffer.from(p, 'base64url')), { iss: 'TEAM123456', iat: 1000 });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
  assert.equal(apns.providerToken(cfg, 1_000_000 + 49 * 60_000), jwt);
  assert.notEqual(apns.providerToken(cfg, 1_000_000 + 51 * 60_000), jwt);
}));

test('payload carries the app id for the tap', () => {
  const payload = JSON.parse(apns.buildPayload({ appId: 'app_1', title: 'Purdue University', body: 'New update in your portal.' }));
  assert.deepEqual(payload, { aps: { alert: { title: 'Purdue University', body: 'New update in your portal.' }, sound: 'default', 'thread-id': 'app_1', 'content-available': 1 }, type: 'portal_update', appId: 'app_1' });
});

test('no APNs settings means no push and no error', () => isolated(async () => {
  const acct = await account();
  await devices.registerDevice(acct.workspaceId, TOKEN_A, 'sandbox', await appGrant(acct));
  const sent = fakeApns();
  const delivered = await apns.pushToWorkspace(acct.workspaceId, [{ appId: 'x', title: 'T', body: 'B' }]);
  assert.equal(delivered.size, 0);
  assert.equal(sent.length, 0);
}));

test('pushes go to the right host and dead tokens are removed', () => isolated(async () => {
  apnsEnv();
  const acct = await account();
  const g = await appGrant(acct);
  await devices.registerDevice(acct.workspaceId, TOKEN_A, 'sandbox', g);
  await devices.registerDevice(acct.workspaceId, TOKEN_B, 'production', g);
  const sent = fakeApns((t) => (t === TOKEN_B ? [410, 'Unregistered'] : [200, '']));
  const delivered = await apns.pushToWorkspace(acct.workspaceId, [{ appId: 'app_1', title: 'Purdue University', body: 'B' }]);
  assert.deepEqual([...delivered], ['app_1']);
  assert.equal(sent.find((s) => s.token === TOKEN_A).host, 'https://api.sandbox.push.apple.com');
  assert.equal(sent.find((s) => s.token === TOKEN_B).host, 'https://api.push.apple.com');
  const h = sent[0].headers;
  assert.equal(h['apns-topic'], 'co.xanom.forge');
  assert.equal(h['apns-push-type'], 'alert');
  assert.match(h.authorization, /^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  assert.deepEqual((await devices.readDevices(acct.workspaceId)).devices.map((d) => d.token), [TOKEN_A]);
}));

test('push switch off sends nothing', () => isolated(async () => {
  apnsEnv();
  const acct = await account();
  await devices.registerDevice(acct.workspaceId, TOKEN_A, 'sandbox', await appGrant(acct));
  await devices.setPushEnabled(acct.workspaceId, false);
  const sent = fakeApns();
  assert.equal((await apns.pushToWorkspace(acct.workspaceId, [{ appId: 'x', title: 'T', body: 'B' }])).size, 0);
  assert.equal(sent.length, 0);
}));

test('a disconnected app grant stops pushes and drops the device', () => isolated(async () => {
  apnsEnv();
  const acct = await account();
  const g = await appGrant(acct);
  await devices.registerDevice(acct.workspaceId, TOKEN_A, 'sandbox', g);
  await devices.registerDevice(acct.workspaceId, TOKEN_B, 'sandbox', { sub: acct.sub, grantId: 'missinggrant' });
  await oauth.revokeGrant(acct.sub, g.grantId);
  const sent = fakeApns();
  assert.equal((await apns.pushToWorkspace(acct.workspaceId, [{ appId: 'x', title: 'T', body: 'B' }])).size, 0);
  assert.equal(sent.length, 0);
  assert.equal((await devices.readDevices(acct.workspaceId)).devices.length, 0);
}));

test('a token sent to the wrong host is retried on the other and its environment fixed', () => isolated(async () => {
  apnsEnv();
  const acct = await account();
  const g = await appGrant(acct);
  await devices.registerDevice(acct.workspaceId, TOKEN_A, 'sandbox', g);
  await devices.registerDevice(acct.workspaceId, TOKEN_B, 'sandbox', g);
  const sent = fakeApns((t, host) => (host === 'https://api.push.apple.com' && t === TOKEN_A ? [200, ''] : [400, 'BadDeviceToken']));
  const delivered = await apns.pushToWorkspace(acct.workspaceId, [{ appId: 'app_1', title: 'T', body: 'B' }]);
  assert.deepEqual([...delivered], ['app_1']);
  assert.equal(sent.length, 4);
  const left = (await devices.readDevices(acct.workspaceId)).devices;
  assert.deepEqual(left.map((d) => [d.token, d.environment]), [[TOKEN_A, 'production']], 'B rejected by both hosts is dropped');
}));

test('a stalled APNs is cut off at the deadline without dropping devices', () => isolated(async () => {
  apnsEnv();
  const acct = await account();
  await devices.registerDevice(acct.workspaceId, TOKEN_A, 'sandbox', await appGrant(acct));
  fakeApns(() => null);
  const started = Date.now();
  const delivered = await apns.pushToWorkspace(acct.workspaceId, [{ appId: 'x', title: 'T', body: 'B' }], { deadlineMs: 50 });
  assert.ok(Date.now() - started < 2000);
  assert.equal(delivered.size, 0);
  assert.equal((await devices.readDevices(acct.workspaceId)).devices.length, 1);
}));

test('a session that failed to connect does not throw', () => isolated(async () => {
  apnsEnv();
  const acct = await account();
  await devices.registerDevice(acct.workspaceId, TOKEN_A, 'sandbox', await appGrant(acct));
  http2.connect = () => {
    const s = new EventEmitter();
    s.close = () => undefined;
    s.request = () => { throw new Error('ERR_HTTP2_INVALID_SESSION'); };
    return s;
  };
  assert.equal((await apns.pushToWorkspace(acct.workspaceId, [{ appId: 'x', title: 'T', body: 'B' }])).size, 0);
  assert.equal((await devices.readDevices(acct.workspaceId)).devices.length, 1);
}));

test('push titles lose control characters and are capped', () => {
  const p = JSON.parse(apns.buildPayload({ appId: 'a', title: `Evil\n\u0007${'x'.repeat(300)}`, body: 'B' }));
  assert.ok(!/[\u0000-\u001f]/.test(p.aps.alert.title));
  assert.ok(p.aps.alert.title.length <= 100);
});

// ── portal-check hook ───────────────────────────────────────────────────

function stubNetwork() {
  const portal = { snapshot: { statusText: 'Awaiting materials', update: '', checklist: [] } };
  const emails = [];
  const resend = { fail: false };
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u === 'https://collegeapps.n3el.dev/api/service/check') return new Response(JSON.stringify({ snapshot: portal.snapshot }), { status: 200 });
    if (u === 'https://api.resend.com/emails') {
      if (resend.fail) return new Response('{}', { status: 500 });
      emails.push(JSON.parse(init.body));
      return new Response('{}', { status: 200 });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  return { portal, emails, resend };
}

async function trackedWithPhone() {
  const acct = await account('xa_PUSH');
  const a = await service.addApp(acct.workspaceId, { name: 'Purdue University' });
  await service.setLogin(acct.workspaceId, a.id, { username: 'u', password: 'p' });
  await devices.registerDevice(acct.workspaceId, TOKEN_A, 'sandbox', await appGrant(acct));
  return { ws: acct.workspaceId, id: a.id };
}

test('a decision found by the sweep is pushed once without naming it', () => isolated(async () => {
  apnsEnv();
  const net = stubNetwork();
  const pushes = fakeApns();
  const { ws, id } = await trackedWithPhone();
  await runChecks(ws, { appIds: [id], notify: true });
  assert.equal(pushes.length, 0, 'baseline only');
  net.portal.snapshot = { statusText: 'Admitted', update: 'Reply to Offer of Admission', checklist: [] };
  await runChecks(ws, { appIds: [id], notify: true });
  assert.equal(pushes.length, 1);
  assert.equal(net.emails.length, 1);
  const p = pushes[0].payload;
  assert.equal(p.type, 'portal_update');
  assert.equal(p.appId, id);
  assert.equal(p.aps.alert.title, 'Purdue University');
  assert.doesNotMatch(JSON.stringify(p), /admit|offer|admission/i);
  await runChecks(ws, { appIds: [id], notify: true });
  assert.equal(pushes.length, 1, 'not pushed again');
}));

test('emails off still pushes; a manual check never pushes', () => isolated(async () => {
  apnsEnv();
  const net = stubNetwork();
  const pushes = fakeApns();
  const { ws, id } = await trackedWithPhone();
  await runChecks(ws, { appIds: [id], notify: true });
  await service.setEmails(ws, false);
  net.portal.snapshot = { statusText: 'Application complete', update: '', checklist: [] };
  await runChecks(ws, { appIds: [id], notify: true });
  assert.equal(net.emails.length, 0);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].payload.aps.alert.body, 'Your application status changed.');
  net.portal.snapshot = { statusText: 'Under review', update: '', checklist: [] };
  await runChecks(ws, { appIds: [id] });
  assert.equal(pushes.length, 1);
}));

test('a failed email retry does not push twice, and a failed push does not stop the email', () => isolated(async () => {
  apnsEnv();
  const net = stubNetwork();
  let apnsDown = false;
  const pushes = fakeApns(() => (apnsDown ? [500, 'InternalServerError'] : [200, '']));
  const { ws, id } = await trackedWithPhone();
  await runChecks(ws, { appIds: [id], notify: true });
  net.portal.snapshot = { statusText: '', update: 'View Update', checklist: [] };
  net.resend.fail = true;
  await runChecks(ws, { appIds: [id], notify: true });
  net.resend.fail = false;
  await runChecks(ws, { appIds: [id], notify: true });
  assert.equal(net.emails.length, 1, 'email retried');
  assert.equal(pushes.length, 1, 'push not repeated');

  apnsDown = true;
  net.portal.snapshot = { statusText: 'Application complete', update: 'View Update', checklist: [] };
  await runChecks(ws, { appIds: [id], notify: true });
  assert.equal(net.emails.length, 2, 'email still goes out');
}));
