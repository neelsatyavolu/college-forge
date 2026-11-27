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
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'security-audit-a-session-secret-0123456789';
const { NextRequest } = require('next/server');
const store = require('../lib/store.ts');
const shares = require('../lib/share-store.ts');
const session = require('../lib/session.ts');
const { writeDoc } = require('../lib/doc-store.ts');
const { applyWorkspacePatch } = require('../lib/workspace-patch.ts');
const { safeReturn } = require('../lib/xanom.ts');
const workspace = require('../app/api/workspace/route.ts');
const colleges = require('../app/api/workspace/colleges/route.ts');
const upload = require('../app/api/upload/route.ts');
const researchPlan = require('../app/api/ai/research-plan/route.ts');
const shareRoute = require('../app/api/share/[token]/route.ts');
const handoff = require('../app/api/handoff/route.ts');
const feedRoute = require('../app/api/calendar/[token]/route.ts');
const calendarLink = require('../app/api/workspace/calendar/route.ts');
const { proxy } = require('../proxy.ts');

const WS = 'security-audit-a-ws';
const FOREIGN = 'https://evil.example';

function req(pathname, { method = 'POST', body, headers = {}, ws = WS } = {}) {
  return new NextRequest('http://localhost' + pathname, {
    method,
    headers: { cookie: `cf_workspace=${ws}`, 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}
const shareGet = (token) => shareRoute.GET(new NextRequest('http://localhost/api/share/' + token), { params: Promise.resolve({ token }) });
const sharePost = (token, body) => shareRoute.POST(req('/api/share/' + token, { body }), { params: Promise.resolve({ token }) });
const feedGet = (token) => feedRoute.GET(new NextRequest('http://localhost/api/calendar/' + token), { params: Promise.resolve({ token }) });

async function isolated(run) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-secaudit-'));
  const prev = process.env.CF_DATA_DIR, blob = process.env.BLOB_READ_WRITE_TOKEN, origin = process.env.FORGE_ORIGIN;
  process.env.CF_DATA_DIR = dir; delete process.env.BLOB_READ_WRITE_TOKEN; delete process.env.FORGE_ORIGIN;
  try { await store.getWorkspace(WS); await run(dir); } finally {
    if (prev === undefined) delete process.env.CF_DATA_DIR; else process.env.CF_DATA_DIR = prev;
    if (blob !== undefined) process.env.BLOB_READ_WRITE_TOKEN = blob;
    if (origin !== undefined) process.env.FORGE_ORIGIN = origin;
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

// 1. publicShareView is an allowlist.
test('a full share link leaves out onboarding answers, hidden drafts, suggestions, aid notes and coach notes', () => isolated(async () => {
  const before = await store.getWorkspace(WS);
  const [hiddenEssay, shownEssay] = before.essays.commonApp;
  await store.updateWorkspace(WS, (ws) => ({
    ...ws,
    applicant: { ...ws.applicant, name: 'Synthetic Student' },
    onboarding: {
      completed: true,
      interview: { phase: 'done', section: 'money', transcript: [{ role: 'user', content: 'INTERVIEW-MARKER-7731', at: 1 }], notes: {}, deep: [] },
      listPrefs: { incomeBracket: 'lt30', firstGen: 'yes', budget: '20' },
      storyNotes: { activities: 'STORY-MARKER', awards: '', other: '' },
    },
    essayHidden: { [hiddenEssay.id]: true },
    essayDrafts: { [hiddenEssay.id]: 'HIDDEN-DRAFT-MARKER', [shownEssay.id]: 'VISIBLE-DRAFT-TEXT' },
    essaySuggestions: { [shownEssay.id]: { text: 'SUGGESTION-MARKER' } },
    financialAid: { ...ws.financialAid, fafsaStatus: 'submitted', notes: 'AID-NOTE-MARKER' },
    advisorNotes: [
      { id: 'n1', body: 'COACH-NOTE-MARKER', author: 'Coach', createdAt: 1, via: 'coach', byLink: 'link-1' },
      { id: 'n2', body: 'COUNSELOR-NOTE-MARKER', author: 'Counselor', createdAt: 2, via: 'counselor', byLink: 'link-2' },
      { id: 'n3', body: 'FULL-LINK-NOTE', author: 'Advisor', createdAt: 3, via: 'full' },
    ],
  }));
  const raw = JSON.stringify(await store.getWorkspace(WS));
  for (const marker of ['INTERVIEW-MARKER-7731', 'incomeBracket', 'HIDDEN-DRAFT-MARKER', 'COACH-NOTE-MARKER']) assert.ok(raw.includes(marker), `fixture holds ${marker}`);

  const created = await (await workspace.POST(req('/api/workspace', { body: { action: 'create-share', scope: 'full', label: 'Advisor' } }))).json();
  const res = await shareGet(created.token);
  assert.equal(res.status, 200);
  const text = await res.text();
  for (const leak of ['INTERVIEW-MARKER-7731', 'incomeBracket', 'firstGen', 'listPrefs', 'STORY-MARKER', 'HIDDEN-DRAFT-MARKER', 'SUGGESTION-MARKER', 'AID-NOTE-MARKER', 'COACH-NOTE-MARKER', 'COUNSELOR-NOTE-MARKER', 'draftStorageKey', 'recoveryCode']) {
    assert.ok(!text.includes(leak), leak);
  }
  const data = JSON.parse(text).data;
  assert.equal(data.scope, 'full');
  assert.equal(data.applicant.name, 'Synthetic Student');
  assert.equal(data.essayDrafts[shownEssay.id], 'VISIBLE-DRAFT-TEXT');
  assert.ok(!data.essays.commonApp.some((e) => e.id === hiddenEssay.id));
  assert.deepEqual(data.advisorNotes.map((n) => n.body), ['FULL-LINK-NOTE']);
  assert.deepEqual(data.onboarding, { completed: true });
  assert.equal(data.financialAid.fafsaStatus, 'submitted');
}));

// 2. The old host no longer carries a workspace across.
test('the old host redirects to the same path with no handoff token', async () => {
  const res = await proxy(new NextRequest('http://forge.n3el.dev/hub/index.html?x=1', { headers: { host: 'forge.n3el.dev', cookie: `cf_workspace=${WS}` } }));
  assert.equal(res.status, 308);
  assert.equal(res.headers.get('location'), 'https://forge.xanom.co/hub/index.html?x=1');
});

test('/api/handoff never sets a workspace cookie, even for a handoff record left in storage', () => isolated(async () => {
  const t = 'a'.repeat(32);
  await writeDoc(`handoff/${require('node:crypto').createHash('sha256').update(t).digest('hex')}.json`, { ws: 'planted-workspace-1', exp: Date.now() + 60000 });
  const res = await handoff.GET(new NextRequest('http://localhost/api/handoff?t=' + t + '&next=%2Fhub%2Findex.html%23essays'));
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('set-cookie'), null);
  assert.equal(res.headers.get('location'), 'http://localhost/hub/index.html#essays');
}));

// 3. Adoption ends carried bearer links.
test('first sign-in revokes the anonymous share links, calendar feed and recovery code', () => isolated(async (dir) => {
  const anon = 'security-audit-anon-1';
  const created = await (await workspace.POST(req('/api/workspace', { ws: anon, body: { action: 'create-share', scope: 'full', label: 'Advisor' } }))).json();
  const feed = await (await calendarLink.POST(req('/api/workspace/calendar', { ws: anon, body: { action: 'create' } }))).json();
  const feedToken = feed.data.https.split('/').pop();
  await workspace.POST(req('/api/workspace', { ws: anon, body: { action: 'create-recovery' } }));
  assert.equal((await shareGet(created.token)).status, 200);
  assert.equal((await feedGet(feedToken)).status, 200);

  const account = await session.signInAccount({ sub: 'xa_SECA', email: 'a@example.com', name: 'A' }, anon);
  assert.equal((await shareGet(created.token)).status, 404);
  assert.equal((await feedGet(feedToken)).status, 404);
  const adopted = await store.getWorkspace(account.workspaceId);
  assert.ok(adopted.shares.every((s) => s.revokedAt));
  assert.ok((await shares.getShare(created.token)).revokedAt);
  assert.equal(adopted.calendarFeed, undefined);
  assert.equal(adopted.recoveryCode, undefined);
  assert.equal(fs.existsSync(path.join(dir, 'calendars', `${feedToken}.json`)), false);
}));

// 4. Recovery codes and owned workspaces.
test('claim-recovery answers an owned workspace like an unknown code, and create-recovery refuses a session', () => isolated(async () => {
  const code = (await (await workspace.POST(req('/api/workspace', { body: { action: 'create-recovery' } }))).json()).code;
  await writeDoc(`workspace-owner/${WS}.json`, { sub: 'xa_OWNER' });
  const claim = await workspace.POST(req('/api/workspace', { ws: 'some-other-browser-ws', body: { action: 'claim-recovery', code } }));
  const unknown = await workspace.POST(req('/api/workspace', { ws: 'some-other-browser-ws', body: { action: 'claim-recovery', code: 'ZZZZZZZZ' } }));
  assert.equal(claim.status, 404);
  assert.equal((await claim.json()).error, (await unknown.json()).error);
  assert.doesNotMatch(claim.headers.get('set-cookie') || '', new RegExp(WS));

  const cookie = `forge_session=${session.signSession({ sub: 'xa_SIGNED', workspaceId: 'signed-in-ws-1', email: 's@example.com', name: 'S' })}`;
  const refused = await workspace.POST(req('/api/workspace', { body: { action: 'create-recovery' }, headers: { cookie } }));
  assert.equal(refused.status, 403);
  assert.equal((await store.getWorkspace('signed-in-ws-1')).recoveryCode, undefined);
}));

// 5. Redirect targets.
test('return paths reject tab, newline, carriage-return and backslash tricks', () => isolated(async () => {
  const tricks = ['/\t/evil.example', '/\n/evil.example', '/\r/evil.example', '/\\evil.example', '/\t\\evil.example', '//evil.example', 'https://evil.example', '/..//evil.example', '/.//evil.example', '/a/..//evil.example', '/%2e%2e//evil.example'];
  for (const p of tricks) assert.equal(safeReturn(p), '/', JSON.stringify(p));
  assert.equal(safeReturn('/hub/index.html?x=1#essays'), '/hub/index.html?x=1#essays');
  for (const next of ['%2F%09%2Fevil.example', '%2F%0A%2Fevil.example', '%2F%0D%2Fevil.example', '%2F%5Cevil.example', '%2F%09%5Cevil.example', '%2F..%2F%2Fevil.example', '%2F.%2F%2Fevil.example']) {
    const res = await handoff.GET(new NextRequest('http://localhost/api/handoff?next=' + next));
    const location = new URL(res.headers.get('location'));
    assert.equal(location.origin, 'http://localhost', next);
    assert.equal(location.pathname, '/hub/index.html', next);
  }
}));

// 6. Share-link notes are bounded.
test('share-link notes are rate limited, essay ids validated and the list capped', () => isolated(async () => {
  const { token } = await (await workspace.POST(req('/api/workspace', { body: { action: 'create-share', scope: 'full', label: 'Advisor' } }))).json();
  assert.equal((await sharePost(token, { body: 'first', essayId: '../../etc<script>' })).status, 200);
  assert.equal((await store.getWorkspace(WS)).advisorNotes[0].essayId, undefined, 'invalid essay id dropped');
  assert.equal((await sharePost(token, { body: 'second', essayId: 'ca-ps-1' })).status, 200);
  assert.equal((await store.getWorkspace(WS)).advisorNotes[1].essayId, 'ca-ps-1');
  for (let i = 2; i < 60; i++) assert.equal((await sharePost(token, { body: `note ${i}` })).status, 200);
  assert.equal((await sharePost(token, { body: 'one too many' })).status, 429);
  assert.equal((await store.getWorkspace(WS)).advisorNotes.length, 60);

  const many = Array.from({ length: 500 }, (_, i) => ({ id: `n${i}`, body: `old ${i}`, author: 'A', createdAt: i, via: 'full' }));
  const next = applyWorkspacePatch({ ...store.emptyWorkspace(), advisorNotes: many }, { advisorNote: { body: 'newest', via: 'full' } });
  assert.equal(next.advisorNotes.length, 500);
  assert.equal(next.advisorNotes[0].body, 'old 1');
  assert.equal(next.advisorNotes.at(-1).body, 'newest');

  // Link spam never pushes out counselor or coach notes.
  const followerNotes = [{ id: 'c1', body: 'counselor', author: 'C', createdAt: 0, via: 'counselor' }, { id: 'k1', body: 'coach', author: 'K', createdAt: 0, via: 'coach' }];
  const spammed = applyWorkspacePatch({ ...store.emptyWorkspace(), advisorNotes: [...followerNotes, ...many] }, { advisorNote: { body: 'spam', via: 'progress' } });
  assert.deepEqual(spammed.advisorNotes.filter((n) => n.via === 'counselor' || n.via === 'coach').map((n) => n.id), ['c1', 'k1']);
  assert.equal(spammed.advisorNotes.filter((n) => n.via !== 'counselor' && n.via !== 'coach').length, 500);
}));

// 7. Cookie-authenticated writes check Origin.
test('a cross-site text/plain reset is refused and the workspace is kept', () => isolated(async () => {
  await store.updateWorkspace(WS, (ws) => ({ ...ws, applicant: { ...ws.applicant, name: 'Keep me' } }));
  const res = await workspace.POST(req('/api/workspace', { body: JSON.stringify({ action: 'reset' }), headers: { origin: FOREIGN, 'content-type': 'text/plain' } }));
  assert.equal(res.status, 403);
  assert.equal((await store.getWorkspace(WS)).applicant.name, 'Keep me');
}));

test('cookie writes refuse a foreign Origin and let same-origin and app (no Origin) requests through', () => isolated(async () => {
  const foreign = { origin: FOREIGN };
  assert.equal((await workspace.PATCH(req('/api/workspace', { method: 'PATCH', body: { applicant: { name: 'x' } }, headers: foreign }))).status, 403);
  assert.equal((await workspace.POST(req('/api/workspace', { body: { action: 'claim-recovery', code: 'ABCDEFGH' }, headers: foreign }))).status, 403);
  assert.equal((await workspace.PATCH(req('/api/workspace', { method: 'PATCH', body: { applicant: { name: 'x' } }, headers: { 'content-type': 'text/plain' } }))).status, 403);
  assert.equal((await colleges.POST(req('/api/workspace/colleges', { body: { college: { name: 'Test College', slug: 'test-college' } }, headers: foreign }))).status, 403);
  assert.equal((await colleges.DELETE(req('/api/workspace/colleges?slug=test-college', { method: 'DELETE', headers: foreign }))).status, 403);
  assert.equal((await researchPlan.POST(req('/api/ai/research-plan', { body: { action: 'start' }, headers: foreign }))).status, 403);
  const form = new FormData();
  form.append('files', new Blob(['hello'], { type: 'text/plain' }), 'a.txt');
  const multipart = (headers) => new NextRequest('http://localhost/api/upload', { method: 'POST', headers: { cookie: `cf_workspace=${WS}`, ...headers }, body: form });
  assert.equal((await upload.POST(multipart({ origin: FOREIGN }))).status, 403);

  // The hub (same origin, JSON) and the iPhone app (no Origin) still work; the hub's DELETE sends no body.
  assert.equal((await workspace.PATCH(req('/api/workspace', { method: 'PATCH', body: { applicant: { name: 'Hub' } }, headers: { origin: 'http://localhost' } }))).status, 200);
  assert.equal((await workspace.PATCH(req('/api/workspace', { method: 'PATCH', body: { applicant: { name: 'App' } } }))).status, 200);
  assert.equal((await colleges.POST(req('/api/workspace/colleges', { body: { college: { name: 'Test College', slug: 'test-college' } }, headers: { origin: 'http://localhost' } }))).status, 200);
  const del = new NextRequest('http://localhost/api/workspace/colleges?slug=test-college', { method: 'DELETE', headers: { cookie: `cf_workspace=${WS}`, origin: 'http://localhost' } });
  assert.equal((await colleges.DELETE(del)).status, 200);
  assert.notEqual((await upload.POST(multipart({ origin: 'http://localhost' }))).status, 403);
}));

test('the copilot chat refuses a foreign Origin before doing any work', async () => {
  const chat = require('../app/api/ai/chat/route.ts');
  const res = await chat.POST(req('/api/ai/chat', { body: { messages: [{ role: 'user', content: 'hi' }] }, headers: { origin: FOREIGN } }));
  assert.equal(res.status, 403);
});
