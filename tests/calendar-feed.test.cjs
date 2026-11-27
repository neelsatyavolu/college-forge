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
const { NextRequest } = require('next/server');
const store = require('../lib/store.ts');
const { exportCalendar } = require('../lib/export.ts');
const feedRoute = require('../app/api/calendar/[token]/route.ts');
const linkRoute = require('../app/api/workspace/calendar/route.ts');
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'calendar-test-session-secret-0123456789';
const session = require('../lib/session.ts');

const WS = 'calendar-feed-test-ws';
const link = (action) => new NextRequest('http://localhost/api/workspace/calendar', action
  ? { method: 'POST', headers: { cookie: `cf_workspace=${WS}`, 'content-type': 'application/json' }, body: JSON.stringify({ action }) }
  : { headers: { cookie: `cf_workspace=${WS}` } });
const fetchFeed = (token) => feedRoute.GET(new NextRequest(`http://localhost/api/calendar/${token}`), { params: Promise.resolve({ token }) });
const tokenOf = (url) => url.split('/').pop();

async function isolated(run) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-calendar-'));
  const prev = process.env.CF_DATA_DIR, blob = process.env.BLOB_READ_WRITE_TOKEN, origin = process.env.FORGE_ORIGIN;
  process.env.CF_DATA_DIR = dir; delete process.env.BLOB_READ_WRITE_TOKEN; delete process.env.FORGE_ORIGIN;
  try { await store.getWorkspace(WS); await run(dir); } finally {
    if (prev === undefined) delete process.env.CF_DATA_DIR; else process.env.CF_DATA_DIR = prev;
    if (blob !== undefined) process.env.BLOB_READ_WRITE_TOKEN = blob;
    if (origin !== undefined) process.env.FORGE_ORIGIN = origin;
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

const app = (over) => ({ id: over.name, name: over.name, portalName: '', portalUrl: '', platform: '', status: 'in_progress', round: 'RD', deadline: '', decisionDate: '', notes: '', lastChecked: null, createdAt: 1, updatedAt: 1, ...over });

test('create gives https and webcal links that serve the calendar, never the workspace id', () => isolated(async () => {
  assert.equal((await (await linkRoute.GET(link())).json()).data, null);
  const created = await (await linkRoute.POST(link('create'))).json();
  assert.equal(created.success, true);
  assert.match(created.data.https, /^http:\/\/localhost\/api\/calendar\/[A-Za-z0-9_-]{24}$/);
  assert.equal(created.data.webcal, created.data.https.replace('http://', 'webcal://'));
  assert.ok(!created.data.https.includes(WS));
  const res = await fetchFeed(tokenOf(created.data.https));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/calendar/);
  assert.equal(res.headers.get('cache-control'), 'private, max-age=900');
  assert.match(await res.text(), /^BEGIN:VCALENDAR\r\n/);
  assert.deepEqual((await (await linkRoute.GET(link())).json()).data, created.data);
}));

test('rotating the link ends the old one; revoking ends the new one', () => isolated(async () => {
  const first = tokenOf((await (await linkRoute.POST(link('create'))).json()).data.https);
  const second = tokenOf((await (await linkRoute.POST(link('create'))).json()).data.https);
  assert.notEqual(first, second);
  assert.equal((await fetchFeed(first)).status, 404);
  assert.equal((await fetchFeed(second)).status, 200);
  const revoked = await (await linkRoute.POST(link('revoke'))).json();
  assert.equal(revoked.data, null);
  assert.equal((await fetchFeed(second)).status, 404);
}));

test('a workspace reset ends the feed even though its index file remains', () => isolated(async () => {
  const token = tokenOf((await (await linkRoute.POST(link('create'))).json()).data.https);
  await store.resetWorkspace(WS);
  assert.equal((await fetchFeed(token)).status, 404);
}));

test('bad and unknown tokens get the same bare 404', () => isolated(async () => {
  for (const token of ['short', '../../workspaces/x', 'A'.repeat(24), WS, 'A'.repeat(23) + '!']) {
    const res = await fetchFeed(token);
    assert.equal(res.status, 404);
    assert.equal(await res.text(), 'Not found');
  }
}));

test('link changes reject cross-site posts and unknown actions', () => isolated(async () => {
  const cross = new NextRequest('http://localhost/api/workspace/calendar', { method: 'POST', headers: { cookie: `cf_workspace=${WS}`, origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{"action":"create"}' });
  assert.equal((await linkRoute.POST(cross)).status, 403);
  assert.equal((await linkRoute.POST(link('delete-everything'))).status, 400);
}));

test('a progress or full share view never carries the feed token', () => isolated(async () => {
  await linkRoute.POST(link('create'));
  const ws = await store.getWorkspace(WS);
  assert.ok(ws.calendarFeed.token);
  assert.equal('calendarFeed' in store.publicShareView(ws), false);
}));

test('the calendar has open follow-ups and estimated decisions, not done follow-ups or finished schools', () => {
  const ws = { draftStorageKey: 'feed-content', profile: { gradYear: 2027 }, criticalDates: [], colleges: [], scholarships: [], recommendations: [],
    tracker: { apps: [
      app({ name: 'Open School', deadline: '2027-01-01', followUps: [
        { id: 'a', text: 'Send mid-year report', due: '2027-02-01', done: false, createdAt: 1 },
        { id: 'b', text: 'Already sent scores', due: '2027-01-10', done: true, createdAt: 1 },
        { id: 'c', text: 'No date yet', due: '', done: false, createdAt: 1 },
      ] }),
      app({ name: 'Estimate School', collegeId: 'berkeley', round: 'RD', status: 'submitted' }),
      app({ name: 'Gone School', status: 'withdrawn', deadline: '2027-01-05', decisionDate: '2027-03-01', followUps: [{ id: 'd', text: 'Withdrawn task', due: '2027-02-02', done: false, createdAt: 1 }] }),
      app({ name: 'Denied School', status: 'denied', decisionDate: '2027-03-15' }),
    ], autocheck: true, emails: true, flags: [] } };
  const text = exportCalendar(ws, '2026-11-01').text.replace(/\r\n /g, '');
  assert.match(text, /SUMMARY:Open School: Send mid-year report/);
  assert.doesNotMatch(text, /Already sent scores|No date yet|Withdrawn task|Gone School|Denied School/);
  assert.match(text, /DTSTART;VALUE=DATE:20270326\r\nDTEND;VALUE=DATE:20270327\r\nSUMMARY:Estimate School: decision \(estimated from last year\)/);
  const ids = text.match(/^UID:.*$/gm).sort();
  assert.deepEqual(exportCalendar(ws, '2026-11-01').text.match(/^UID:.*$/gm).sort(), ids);
  for (const line of exportCalendar(ws, '2026-11-01').text.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
});

test('signing in moves the feed with the workspace, so the subscribed link keeps working', () => isolated(async () => {
  const token = tokenOf((await (await linkRoute.POST(link('create'))).json()).data.https);
  const account = await session.signInAccount({ sub: 'xa_CAL', email: 'cal@example.com', name: 'Cal' }, WS);
  assert.notEqual(account.workspaceId, WS);
  assert.equal(await store.peekWorkspace(WS), null);
  assert.equal((await fetchFeed(token)).status, 200);
  assert.equal((await store.getWorkspace(account.workspaceId)).calendarFeed.token, token);
}));

test('the subscription leaves out scholarship notes that the download keeps', () => isolated(async () => {
  await store.updateWorkspace(WS, (ws) => ({ ...ws, scholarships: [{ id: 's', name: 'Rotary', deadline: '2027-02-01', status: 'planning', notes: 'Private essay idea' }] }));
  const token = tokenOf((await (await linkRoute.POST(link('create'))).json()).data.https);
  const feed = await (await fetchFeed(token)).text();
  assert.match(feed, /SUMMARY:Scholarship: Rotary/);
  assert.doesNotMatch(feed, /Private essay idea/);
  assert.match(exportCalendar(await store.getWorkspace(WS)).text, /Private essay idea/);
}));
