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
const tracker = require('../lib/tracker.ts');
const session = require('../lib/session.ts');
const service = require('../lib/tracker-service.ts');
const oauth = require('../lib/oauth.ts');
const store = require('../lib/store.ts');
const mcpRoute = require('../app/mcp/route.ts');
const appsRoute = require('../app/api/applications/route.ts');

async function isolated(run) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-apps-'));
  const prev = process.env.CF_DATA_DIR, blob = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.CF_DATA_DIR = dir;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try { await run(dir); } finally {
    if (prev === undefined) delete process.env.CF_DATA_DIR; else process.env.CF_DATA_DIR = prev;
    if (blob !== undefined) process.env.BLOB_READ_WRITE_TOKEN = blob;
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

const app = (over = {}) => ({ ...tracker.newApp({ name: 'Purdue University' }, 1000), ...over });
const result = (over = {}) => ({ checkedAt: 2000, ok: true, error: '', statusText: '', checklist: [], update: '', ...over });

// ── Tracker rules ──────────────────────────────────────────────────────────

test('catalog matching finds schools by name, alias and id', () => {
  assert.equal(tracker.matchCatalog('Purdue University')?.id, 'purdue');
  assert.equal(tracker.matchCatalog('purdue')?.id, 'purdue');
  assert.equal(tracker.matchCatalog('Not A Real College Anywhere'), undefined);
  const a = tracker.newApp({ name: 'Purdue University' });
  assert.equal(a.collegeId, 'purdue');
  assert.match(a.portalUrl, /^https:\/\//);
});

test('portal checks move status forward but never set a decision', () => {
  const missing = result({ checklist: [{ item: 'Transcript', status: 'Awaiting', date: '', done: false, optional: false }] });
  assert.equal(tracker.suggestedStatus(app({ status: 'planning' }), missing), 'submitted');
  const allIn = result({ checklist: [{ item: 'Transcript', status: 'Received', date: '', done: true, optional: false }] });
  assert.equal(tracker.suggestedStatus(app({ status: 'submitted' }), allIn), 'complete');
  assert.equal(tracker.suggestedStatus(app({ status: 'admitted' }), allIn), 'admitted');
  assert.equal(tracker.suggestedStatus(app({ status: 'submitted' }), result({ ok: false, error: 'x' })), 'submitted');
});

test('a failed check keeps the last decision date and round', () => {
  const first = tracker.withResult(app(), result({ decisionDate: '2027-03-15', round: 'RD' }));
  const failed = tracker.withResult(first, result({ checkedAt: 3000, ok: false, error: 'down' }));
  assert.equal(failed.portal.decisionDate, '2027-03-15');
  assert.equal(failed.portal.round, 'RD');
  assert.equal(failed.lastChecked, 2000);
});

test('a posted decision stays hidden until revealed', () => {
  const posted = tracker.withResult(app({ status: 'complete' }), result({ statusText: 'Admitted', update: 'View your decision' }));
  assert.equal(tracker.decisionOf(posted).state, 'hidden');
  assert.equal(tracker.shownPortal(posted).statusText, '');
  assert.equal(tracker.shownPortal(posted).update, tracker.DECISION_RECEIVED);
  const seen = tracker.revealDecision(posted);
  assert.deepEqual(tracker.decisionOf(seen), { state: 'revealed', portalText: 'Admitted' });
  assert.equal(tracker.shownPortal(seen).statusText, 'Admitted');
  assert.equal(tracker.decisionOf(app({ status: 'denied' })).state, 'recorded');
});

test('edits are validated', () => {
  assert.throws(() => tracker.editApp(app(), { status: 'accepted' }), /Unknown status/);
  assert.throws(() => tracker.editApp(app(), { deadline: 'Jan 1' }), /yyyy-mm-dd/);
  assert.throws(() => tracker.editApp(app(), { portalUrl: 'javascript:alert(1)' }), /https/);
  const e = tracker.editApp(app(), { status: 'submitted', round: 'EA', deadline: '2026-11-01' }, 5000);
  assert.equal(e.status, 'submitted');
  assert.equal(e.round, 'EA');
  assert.equal(e.updatedAt, 5000);
});

test('next date prefers the deadline while working, then the decision date (estimated when unknown)', () => {
  const working = app({ deadline: '2026-11-15', round: 'EA' });
  assert.deepEqual(tracker.nextDate(working, '2026-11-01'), { date: '2026-11-15', kind: 'Deadline', estimated: false });
  const waiting = app({ status: 'submitted', round: 'EA' });
  const next = tracker.nextDate(waiting, '2026-11-20');
  assert.equal(next?.kind, 'Decision');
  assert.equal(tracker.nextDate(app({ status: 'admitted' }), '2026-11-20'), null);
});

test('old shortlist statuses migrate into the tracker once', () => {
  const t = tracker.migrateOldStatuses(tracker.emptyTracker(), [{ slug: 'purdue', name: 'Purdue University' }, { slug: 'x', name: 'X College' }], { purdue: { status: 'accepted' }, x: { status: 'researching' } });
  assert.equal(t.apps.length, 1);
  assert.equal(t.apps[0].status, 'admitted');
  assert.equal(t.apps[0].slug, 'purdue');
});

// ── Sessions ──────────────────────────────────────────────────────────────

test('session cookies are signed and expire', () => {
  const v = session.signSession({ sub: 'xa_TEST', workspaceId: 'ws-12345678', email: 'a@b.co', name: 'A' });
  assert.equal(session.readSession(v)?.workspaceId, 'ws-12345678');
  const [body, sig] = v.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), workspaceId: 'someone-else' })).toString('base64url');
  assert.equal(session.readSession(`${forged}.${sig}`), null);
  assert.equal(session.readSession(v, Date.now() + 200 * 86400_000), null);
  const h = session.signHandoff('ws-abcdefgh');
  assert.equal(session.readHandoff(h), 'ws-abcdefgh');
  assert.equal(session.readHandoff(h, Date.now() + 10 * 60_000), null);
});

test('first sign-in adopts the anonymous workspace; another account cannot take it', () => isolated(async () => {
  const a = await session.signInAccount({ sub: 'xa_ONE', email: 'one@x.co', name: 'One' }, 'anon-workspace-1');
  assert.equal(a.workspaceId, 'anon-workspace-1');
  const again = await session.signInAccount({ sub: 'xa_ONE', email: 'one@x.co', name: 'One' }, 'other-anon-ws');
  assert.equal(again.workspaceId, 'anon-workspace-1');
  const b = await session.signInAccount({ sub: 'xa_TWO', email: 'two@x.co', name: 'Two' }, 'anon-workspace-1');
  assert.notEqual(b.workspaceId, 'anon-workspace-1');
}));

// ── Tracker service and logins ────────────────────────────────────────────

test('logins are encrypted at rest and never come back in views', () => isolated(async (dir) => {
  const ws = 'svc-workspace-1';
  const added = await service.addApp(ws, { name: 'Purdue University', status: 'submitted' });
  await service.setLogin(ws, added.id, { username: 'student@example.com', password: 'hunter2-secret' });
  const raw = fs.readFileSync(path.join(dir, 'logins', `${ws}.json`), 'utf8');
  assert.doesNotMatch(raw, /hunter2|student@example/);
  const listed = await service.listApps(ws);
  assert.doesNotMatch(JSON.stringify(listed), /hunter2/);
  assert.deepEqual(listed.apps[0].login, { username: 'student@example.com', hasPassword: true });
  assert.ok(fs.existsSync(path.join(dir, 'autocheck', `${ws}.json`)));
  const logins = await require('../lib/portal-logins.ts').readLogins(ws);
  assert.equal(logins[added.id].password, 'hunter2-secret');
  await service.setAutocheck(ws, false);
  assert.ok(!fs.existsSync(path.join(dir, 'autocheck', `${ws}.json`)));
  await service.removeApp(ws, 'Purdue');
  assert.deepEqual(await require('../lib/portal-logins.ts').readLogins(ws), {});
}));

test('adding the same school twice links instead of duplicating', () => isolated(async () => {
  const ws = 'svc-workspace-2';
  await service.addApp(ws, { name: 'Purdue University' });
  await service.addApp(ws, { name: 'purdue university', slug: 'purdue-u' });
  const t = await service.listApps(ws);
  assert.equal(t.apps.length, 1);
  assert.equal(t.apps[0].slug, 'purdue-u');
  await assert.rejects(service.updateApp(ws, 'Nowhere State', { status: 'admitted' }), /No application matches/);
}));

test('share view hides unrevealed decisions and logins', () => isolated(async () => {
  const ws = 'svc-workspace-3';
  const added = await service.addApp(ws, { name: 'Purdue University' });
  await service.setLogin(ws, added.id, { username: 'u', password: 'p' });
  await store.updateWorkspace(ws, (w) => ({ ...w, tracker: tracker.replaceApp(w.tracker, tracker.withResult(w.tracker.apps[0], result({ statusText: 'Admitted', update: 'Decision posted' }))) }));
  const shared = store.publicShareView(await store.getWorkspace(ws));
  const text = JSON.stringify(shared.tracker);
  assert.doesNotMatch(text, /Admitted|"login"|decisionSeen/);
}));

// ── College Apps import ─────────────────────────────────────────────────────

test('imports a College Apps vault: derives the same keys, decrypts, maps schools and logins', () => isolated(async () => {
  const email = 'student@example.com', password = 'correct horse';
  const salt = crypto.createHash('sha256').update('collegeapps.n3el.dev/v1/' + email).digest();
  const master = crypto.pbkdf2Sync(password, salt, 600000, 32, 'sha256');
  const authKey = Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), 'collegeapps auth', 32)).toString('hex');
  const encKey = Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), 'collegeapps vault', 32));
  const vault = { version: 1, apps: [
    { id: 'a1', collegeId: 'purdue', name: 'Purdue University', portalName: 'Slate', portalUrl: 'https://admissions.purdue.edu/apply/status', platform: 'slate', status: 'complete', round: 'EA', deadline: '2026-11-01', decisionDate: '', notes: 'n', checklist: [{ id: 'c', text: 'Send scores', done: false }], lastChecked: null, logins: [{ id: 'l', label: 'x', url: 'https://admissions.purdue.edu', username: 'stu', password: 'pw' }], createdAt: 1, updatedAt: 1 },
    { id: 'a2', collegeId: null, name: 'Gone College', deleted: true, logins: [], checklist: [] },
  ] };
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(vault)), c.final(), c.getAuthTag()]);
  const ciphertext = `v1.${iv.toString('base64')}.${ct.toString('base64')}`;
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, init = {}) => {
    calls.push(String(url));
    if (String(url).endsWith('/api/auth/login')) {
      const body = JSON.parse(init.body);
      if (body.authKey !== authKey) return new Response('{}', { status: 401 });
      return new Response('{"user":{}}', { status: 200, headers: { 'set-cookie': 'ca_session=tok123; Path=/; HttpOnly' } });
    }
    if (String(url).endsWith('/api/vault')) {
      assert.equal(init.headers.cookie, 'ca_session=tok123');
      return Response.json({ ciphertext, version: 3 });
    }
    return new Response('{}', { status: 200 });
  };
  try {
    await assert.rejects(service.importFromCollegeApps('imp-ws', email, 'wrong password'), /don't match/);
    const r = await service.importFromCollegeApps('imp-ws', email, password);
    assert.equal(r.added, 1);
    const a = r.tracker.apps[0];
    assert.equal(a.status, 'complete');
    assert.equal(a.round, 'EA');
    assert.match(a.notes, /\[ \] Send scores/);
    assert.deepEqual(a.login, { username: 'stu', hasPassword: true });
    assert.ok(calls.some((u) => u.endsWith('/api/auth/logout')));
    const again = await service.importFromCollegeApps('imp-ws', email, password);
    assert.equal(again.added, 0);
  } finally {
    global.fetch = realFetch;
  }
}));

// ── OAuth and MCP ───────────────────────────────────────────────────────────

const pkce = () => {
  const verifier = crypto.randomBytes(40).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};

async function connect(ws, sub = 'xa_MCP') {
  const client = await oauth.registerClient({ client_name: 'Grok', redirect_uris: ['https://grok.com/oauth/callback'] });
  const { verifier, challenge } = pkce();
  const q = new URLSearchParams({ client_id: client.client_id, redirect_uri: 'https://grok.com/oauth/callback', response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 's1' });
  const ar = await oauth.checkAuthorize(q);
  const code = await oauth.issueCode(ar.client, ar.redirect_uri, ar.code_challenge, sub, ws);
  const tokens = await oauth.exchange(new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: ar.redirect_uri, code_verifier: verifier, client_id: client.client_id }));
  return { client, tokens, sub };
}

test('registration rejects unsafe redirect URIs', async () => {
  await assert.rejects(oauth.registerClient({ redirect_uris: ['javascript:alert(1)'] }), /redirect_uris/);
  await assert.rejects(oauth.registerClient({ redirect_uris: ['http://evil.example/cb'] }), /redirect_uris/);
  assert.ok(oauth.validRedirectUri('http://127.0.0.1:3333/cb'));
  assert.ok(oauth.validRedirectUri('cursor://anysphere.cursor-mcp/oauth/callback'));
});

test('OAuth: PKCE, single-use codes, refresh rotation and disconnect', () => isolated(async () => {
  const client = await oauth.registerClient({ client_name: 'Grok', redirect_uris: ['https://grok.com/cb'] });
  const { verifier, challenge } = pkce();
  const code = await oauth.issueCode(client, 'https://grok.com/cb', challenge, 'xa_OA', 'ws-oauth-1');
  await assert.rejects(oauth.exchange(new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: 'https://grok.com/cb', code_verifier: 'x'.repeat(43) })), /PKCE|invalid/);
  const code2 = await oauth.issueCode(client, 'https://grok.com/cb', challenge, 'xa_OA', 'ws-oauth-1');
  const tokens = await oauth.exchange(new URLSearchParams({ grant_type: 'authorization_code', code: code2, redirect_uri: 'https://grok.com/cb', code_verifier: verifier }));
  await assert.rejects(oauth.exchange(new URLSearchParams({ grant_type: 'authorization_code', code: code2, redirect_uri: 'https://grok.com/cb', code_verifier: verifier })), /invalid or expired/);
  assert.equal((await oauth.verifyAccess(`Bearer ${tokens.access_token}`)).workspaceId, 'ws-oauth-1');
  const refreshed = await oauth.exchange(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }));
  await assert.rejects(oauth.exchange(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token })), /invalid or expired/);
  const grants = await oauth.listGrants('xa_OA');
  assert.equal(grants.length, 2);
  for (const g of grants) await oauth.revokeGrant('xa_OA', g.grantId);
  assert.equal(await oauth.verifyAccess(`Bearer ${refreshed.access_token}`), null);
}));

const rpc = (token, body) => new Request('http://localhost/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

test('MCP: unauthenticated requests point to the OAuth metadata', async () => {
  const res = await mcpRoute.POST(rpc(null, { jsonrpc: '2.0', id: 1, method: 'tools/list' }));
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate'), /resource_metadata="http:\/\/localhost\/\.well-known\/oauth-protected-resource\/mcp"/);
});

test('MCP: initialize, list tools, add and update an application, record a decision', () => isolated(async () => {
  const { tokens } = await connect('mcp-ws-1');
  const t = tokens.access_token;
  const init = await (await mcpRoute.POST(rpc(t, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'grok', version: '1' } } }))).json();
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal((await mcpRoute.POST(rpc(t, { jsonrpc: '2.0', method: 'notifications/initialized' }))).status, 202);
  const list = await (await mcpRoute.POST(rpc(t, { jsonrpc: '2.0', id: 2, method: 'tools/list' }))).json();
  const names = list.result.tools.map((x) => x.name);
  for (const n of ['list_applications', 'add_application', 'update_application', 'record_decision', 'reveal_decision', 'upcoming_dates', 'check_portals']) assert.ok(names.includes(n), n);
  assert.equal(list.result.tools.find((x) => x.name === 'update_application').inputSchema.type, 'object');
  const call = async (name, args) => (await (await mcpRoute.POST(rpc(t, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } }))).json()).result;
  const added = await call('add_application', { school: 'Purdue University', round: 'EA', deadline: '2026-11-01' });
  assert.equal(added.isError, undefined);
  assert.equal(added.structuredContent.round, 'EA');
  const bad = await call('update_application', { school: 'Purdue', status: 'accepted' });
  assert.equal(bad.isError, true);
  const decided = await call('record_decision', { school: 'Purdue', decision: 'admitted', note: 'Honors college too' });
  assert.equal(decided.structuredContent.status, 'admitted');
  assert.match(decided.structuredContent.notes, /Honors college/);
  const listed = await call('list_applications', {});
  assert.equal(listed.structuredContent.count, 1);
  const missing = await call('get_application', { school: 'Nowhere' });
  assert.equal(missing.isError, true);
}));

// ── Applications API ─────────────────────────────────────────────────────────

test('applications API requires a session and never returns passwords', () => isolated(async () => {
  const signedOut = await appsRoute.GET(new NextRequest('http://localhost/api/applications'));
  assert.equal(signedOut.status, 401);
  const cookie = `forge_session=${session.signSession({ sub: 'xa_API', workspaceId: 'api-ws-1', email: 'a@b.co', name: 'A' })}`;
  const post = (body, origin) => appsRoute.POST(new NextRequest('http://localhost/api/applications', { method: 'POST', headers: { cookie, 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) }));
  assert.equal((await post({ action: 'add', name: 'Purdue University' }, 'https://evil.example')).status, 403);
  const added = await (await post({ action: 'add', name: 'Purdue University', status: 'submitted' })).json();
  assert.equal(added.success, true);
  const withLogin = await (await post({ action: 'login', id: added.app.id, username: 'stu', password: 'topsecret' })).json();
  assert.doesNotMatch(JSON.stringify(withLogin), /topsecret/);
  const invalid = await post({ action: 'update', id: added.app.id, edit: { status: 'accepted' } });
  assert.equal(invalid.status, 400);
}));
