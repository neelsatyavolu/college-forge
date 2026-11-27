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
process.env.FORGE_SERVICE_KEY = 'svc-test-key';
process.env.RESEND_API_KEY = 're_test';
process.env.FORGE_ORIGIN = 'https://forge.test';

const { NextRequest } = require('next/server');
const session = require('../lib/session.ts');
const store = require('../lib/store.ts');
const tracker = require('../lib/tracker.ts');
const service = require('../lib/tracker-service.ts');
const logins = require('../lib/portal-logins.ts');
const setup = require('../lib/portal-setup.ts');
const schedule = require('../lib/check-schedule.ts');
const { runChecks } = require('../lib/portal-check.ts');
const appsRoute = require('../app/api/applications/route.ts');
const inboxRoute = require('../app/api/service/inbox/route.ts');
const inbox = require('../lib/inbox.ts');

/** Runs with a fresh data dir and a stubbed portal engine; `engine(body)` answers each check. */
async function isolated(run, engine = () => ({ status: 200, body: { snapshot: { statusText: 'Submitted', checklist: [], update: '' } } })) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-ops-'));
  const prev = process.env.CF_DATA_DIR, blob = process.env.BLOB_READ_WRITE_TOKEN, realFetch = globalThis.fetch;
  process.env.CF_DATA_DIR = dir;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  const calls = [];
  const sent = [];
  globalThis.fetch = async (url, init) => {
    if (String(url) === 'https://collegeapps.n3el.dev/api/service/check') {
      const body = JSON.parse(init.body);
      calls.push(body);
      const r = engine(body);
      return new Response(JSON.stringify(r.body), { status: r.status });
    }
    if (String(url) === 'https://api.resend.com/emails') { sent.push(JSON.parse(init.body)); return new Response('{}'); }
    throw new Error(`unexpected fetch ${url}`);
  };
  try { await run({ calls, sent }); } finally {
    globalThis.fetch = realFetch;
    if (prev === undefined) delete process.env.CF_DATA_DIR; else process.env.CF_DATA_DIR = prev;
    if (blob !== undefined) process.env.BLOB_READ_WRITE_TOKEN = blob;
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

const cookieFor = (workspaceId) => `forge_session=${session.signSession({ sub: `xa_${workspaceId}`, workspaceId, email: 'stu@example.com', name: 'S' })}`;
const post = (workspaceId, body, headers = {}) => appsRoute.POST(new NextRequest('http://localhost/api/applications', {
  method: 'POST', headers: { cookie: cookieFor(workspaceId), 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
}));
const setLastSlot = (ws, lastSlotAt) => store.updateWorkspace(ws, (w) => ({ ...w, tracker: { ...w.tracker, lastSlotAt } }));

// ── Check schedule ────────────────────────────────────────────────────────

test('the automatic sweep runs once per slot, and missed slots catch up once', () => isolated(async ({ calls }) => {
  const ws = 'ops-slot-1';
  const a = await service.addApp(ws, { name: 'Purdue University' });
  await service.setLogin(ws, a.id, { username: 'u', password: 'p' });
  await setLastSlot(ws, 0); // several slots missed
  assert.equal((await runChecks(ws, { onlyDue: true })).length, 1);
  assert.equal((await runChecks(ws, { onlyDue: true })).length, 0, 'the same slot does not run twice');
  assert.equal(calls.length, 1);
  const t = (await store.getWorkspace(ws)).tracker;
  assert.equal(t.lastSlotAt, schedule.latestSlot(schedule.normalizeSchedule(t.schedule), Date.now()));
}));

test('manual checks never read or move the schedule marker', () => isolated(async ({ calls }) => {
  const ws = 'ops-slot-2';
  const a = await service.addApp(ws, { name: 'Purdue University' });
  await service.setLogin(ws, a.id, { username: 'u', password: 'p' });
  await setLastSlot(ws, 5);
  await runChecks(ws, { appIds: [a.id] });
  assert.equal((await store.getWorkspace(ws)).tracker.lastSlotAt, 5);
  assert.equal((await runChecks(ws, { onlyDue: true })).length, 1, 'a manual check just before a slot does not stop the sweep');
  assert.equal(calls.length, 2);
}));

test('saving a schedule marks the current slot done and is shown in the view, not on progress links', () => isolated(async ({ calls }) => {
  const ws = 'ops-slot-3';
  const a = await service.addApp(ws, { name: 'Purdue University' });
  await service.setLogin(ws, a.id, { username: 'u', password: 'p' });
  const view = await service.setSchedule(ws, { everyHours: 8, startHour: 7, timeZone: 'America/New_York' });
  assert.deepEqual(view.schedule.times, ['07:00', '15:00', '23:00']);
  assert.equal(view.schedule.timeZone, 'America/New_York');
  assert.ok(view.schedule.nextAt > Date.now());
  assert.deepEqual(await runChecks(ws, { onlyDue: true }), []);
  assert.equal(calls.length, 0);
  const t = (await store.getWorkspace(ws)).tracker;
  assert.equal(service.shareTracker(t).schedule, undefined);
  assert.equal(JSON.stringify(store.publicShareView(await store.getWorkspace(ws)).tracker).includes('America/New_York'), false);
}));

test('the schedule action validates its input and needs a same-site session', () => isolated(async () => {
  const ws = 'ops-slot-4';
  assert.equal((await post(ws, { action: 'schedule', everyHours: 6, startHour: 7, timeZone: 'America/Chicago' })).status, 400);
  assert.equal((await post(ws, { action: 'schedule', everyHours: 8, startHour: 24, timeZone: 'America/Chicago' })).status, 400);
  assert.equal((await post(ws, { action: 'schedule', everyHours: 8, startHour: 7, timeZone: 'Nowhere/Land' })).status, 400);
  assert.equal((await post(ws, { action: 'schedule', everyHours: 8, startHour: 7, timeZone: 'America/Chicago' }, { origin: 'https://evil.example' })).status, 403);
  const unauth = await appsRoute.POST(new NextRequest('http://localhost/api/applications', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'schedule', everyHours: 8, startHour: 7, timeZone: 'America/Chicago' }) }));
  assert.equal(unauth.status, 401);
  const ok = await (await post(ws, { action: 'schedule', everyHours: 24, startHour: 6, timeZone: 'America/Chicago' })).json();
  assert.equal(ok.success, true);
  assert.deepEqual(ok.data.schedule.times, ['06:00']);
}));

// ── Master login ──────────────────────────────────────────────────────────

test('master documents are sealed per workspace and own logins beat the master', () => isolated(async () => {
  await logins.saveMaster('ops-m-1', { username: 'm', password: 'Master-Pass-1' });
  const raw = fs.readFileSync(path.join(process.env.CF_DATA_DIR, 'logins-master/ops-m-1.json'), 'utf8');
  assert.doesNotMatch(raw, /Master-Pass-1/);
  fs.mkdirSync(path.join(process.env.CF_DATA_DIR, 'logins-master'), { recursive: true });
  fs.writeFileSync(path.join(process.env.CF_DATA_DIR, 'logins-master/ops-m-2.json'), raw);
  await assert.rejects(logins.readMaster('ops-m-2'), 'a master moved to another workspace does not open');
  const master = { username: 'm', password: 'x', appIds: { a1: { host: 'h.edu' }, a2: { host: 'h.edu', failedAt: 1 } } };
  assert.equal(logins.resolveLogin('a1', 'h.edu', { a1: { username: 'own', password: 'o' } }, master).source, 'own');
  assert.equal(logins.resolveLogin('a1', 'h.edu', {}, master).source, 'master');
  assert.equal(logins.resolveLogin('a1', 'other.edu', {}, master), null, 'a moved host does not get the master');
  assert.equal(logins.resolveLogin('a2', 'h.edu', {}, master), null, 'a failed school is skipped');
  assert.equal(logins.resolveLogin('a2', 'h.edu', {}, master, { allowFailed: true }).source, 'master');
  await logins.deleteAllLogins('ops-m-1');
  assert.equal(await logins.readMaster('ops-m-1'), null);
}));

test('the master is checked with its own credentials, stops after a sign-in failure, and never shows in responses', () => isolated(async ({ calls }) => {
  const { ws } = await withAddress('xa_OPSM3', 'stu@example.com');
  const purdue = await service.addApp(ws, { name: 'Purdue University' });
  const own = await service.addApp(ws, { name: 'University of Michigan' });
  await service.setLogin(ws, own.id, { username: 'own', password: 'Own-Pass-1' });
  const custom = await service.addApp(ws, { name: 'Tiny Slate College', portalUrl: 'https://apply.tiny.edu/apply/status' });
  assert.equal((await post(ws, { action: 'master-login', username: 'x'.repeat(255), password: 'p' })).status, 400);
  assert.equal((await post(ws, { action: 'master-login', username: 'm', password: '' })).status, 400);
  const set = await (await post(ws, { action: 'master-login', username: '', password: 'Master-Pass-1' })).json();
  assert.equal(set.master.username, 'stu@example.com', 'the username defaults to the account email');
  const all = await (await post(ws, { action: 'apply-master-all' })).json();
  assert.equal(all.applied, 1, 'only catalog schools without a login');
  const apps = all.data.apps;
  assert.equal(apps.find((a) => a.id === purdue.id).login.source, 'master');
  assert.equal(apps.find((a) => a.id === custom.id).login, null);
  assert.equal(apps.find((a) => a.id === own.id).login.source, undefined);

  // The sweep uses the master for Purdue and the own login for Michigan.
  await setLastSlot(ws, 0);
  await runChecks(ws, { onlyDue: true });
  assert.deepEqual(calls.map((c) => c.password).sort(), ['Master-Pass-1', 'Own-Pass-1']);

  const responses = [JSON.stringify(set), JSON.stringify(all), await (await appsRoute.GET(new NextRequest('http://localhost/api/applications', { headers: { cookie: cookieFor(ws) } }))).text()];
  for (const t of responses) assert.doesNotMatch(t, /Master-Pass-1/);
  assert.doesNotMatch(JSON.stringify(await store.getWorkspace(ws)), /Master-Pass-1/);
  assert.doesNotMatch(JSON.stringify(service.shareTracker((await store.getWorkspace(ws)).tracker)), /Master-Pass-1/);
}));

test('a master sign-in failure is not retried automatically, but a manual check still tries', () => isolated(async ({ calls }) => {
  const ws = 'ops-m-4';
  const purdue = await service.addApp(ws, { name: 'Purdue University' });
  await service.setMasterLogin(ws, { username: 'm', password: 'Master-Pass-1' });
  await service.useMasterFor(ws, purdue.id, true);
  await setLastSlot(ws, 0);
  await runChecks(ws, { onlyDue: true });
  assert.ok((await logins.readMaster(ws)).appIds[purdue.id].failedAt);
  await setLastSlot(ws, 0);
  assert.deepEqual(await runChecks(ws, { onlyDue: true }), []);
  assert.equal(calls.length, 1);
  await runChecks(ws, { appIds: [purdue.id] });
  assert.equal(calls.length, 2);
}, () => ({ status: 422, body: { error: 'Wrong password', code: 'signin' } })));

test('own logins, forgetting and portal moves all clear the master opt-in', () => isolated(async () => {
  const ws = 'ops-m-5';
  const custom = await service.addApp(ws, { name: 'Tiny Slate College', portalUrl: 'https://apply.tiny.edu/apply/status' });
  assert.equal((await post(ws, { action: 'use-master', id: custom.id, on: true })).status, 400, 'no master yet');
  await service.setMasterLogin(ws, { username: 'm', password: 'Master-Pass-1' });
  const bare = await service.addApp(ws, { name: 'Unknown Place', portalUrl: '' });
  assert.equal((await post(ws, { action: 'use-master', id: bare.id, on: true })).status, 400, 'no portal link');
  await service.useMasterFor(ws, custom.id, true);
  assert.equal((await logins.readMaster(ws)).appIds[custom.id].host, 'apply.tiny.edu');
  await service.setLogin(ws, custom.id, { username: 'own', password: 'o' });
  assert.equal((await logins.readMaster(ws)).appIds[custom.id], undefined, 'an own login overrides the master');
  await service.useMasterFor(ws, custom.id, true);
  assert.equal((await logins.readLogins(ws))[custom.id], undefined, 'turning the master on replaces the own login');
  await service.setLogin(ws, custom.id, null);
  assert.equal((await logins.readMaster(ws)).appIds[custom.id], undefined, 'forget-login clears both');
  await service.useMasterFor(ws, custom.id, true);
  const moved = await service.updateApp(ws, custom.id, { portalUrl: 'https://evil.example/apply/status' });
  assert.equal(moved.login, null);
  assert.equal((await logins.readMaster(ws)).appIds[custom.id], undefined, 'a host change drops the opt-in');
  await service.useMasterFor(ws, custom.id, true);
  await service.removeApp(ws, custom.id);
  assert.deepEqual((await logins.readMaster(ws)).appIds, {}, 'removing the school clears its entry');
  const off = await service.setMasterLogin(ws, null);
  assert.equal(off.on, false);
}));

// ── Forwarded set-up emails ───────────────────────────────────────────────

async function withAddress(sub = 'xa_OPSIN', email = 'stu@example.com') {
  const account = await session.signInAccount({ sub, email, name: 'Stu' }, null);
  const status = await inbox.setInbox(account.workspaceId, { on: true });
  return { ws: account.workspaceId, sub, token: status.address.split('@')[0] };
}
const arrival = (over = {}) => ({
  receivedAt: 1000, collegeId: 'purdue', name: 'Purdue University', portalUrl: 'https://purdue.edu/apply/status',
  username: 'stu@example.com', password: 'made-by-forge', state: 'verified', pin: '', link: '', reason: '', ...over,
});
const service_call = (body) => inboxRoute.POST(new NextRequest('https://forge.test/api/service/inbox', {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer svc-test-key' }, body: JSON.stringify(body),
}));
const sessionPost = (sub, workspaceId, body, headers = {}) => appsRoute.POST(new NextRequest('http://localhost/api/applications', {
  method: 'POST', headers: { cookie: `forge_session=${session.signSession({ sub, workspaceId, email: 'stu@example.com', name: 'S' })}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
}));

test('lookup offers the master password only when it is on for new portals', () => isolated(async () => {
  const { ws, token } = await withAddress();
  assert.equal((await (await service_call({ op: 'lookup', token })).json()).usePassword, undefined);
  await service.setMasterLogin(ws, { username: 'stu@example.com', password: 'Master-Pass-1' });
  assert.equal((await (await service_call({ op: 'lookup', token })).json()).usePassword, undefined, 'off by default');
  await inbox.setInbox(ws, { on: true, useMasterForNew: true });
  assert.equal((await (await service_call({ op: 'lookup', token, collegeId: 'purdue', link: 'https://apply.purdue.edu/activate' })).json()).usePassword, 'Master-Pass-1');
  assert.equal((await inbox.inboxStatus(ws)).useMasterForNew, true);
}));

test('an arrival set with the master password uses the master, with no per-school copy', () => isolated(async () => {
  const { ws, token } = await withAddress();
  await service.setMasterLogin(ws, { username: 'stu@example.com', password: 'Master-Pass-1' });
  const id = crypto.randomUUID();
  await service_call({ op: 'arrival', token, arrivalId: id, final: false, arrival: arrival({ password: 'Master-Pass-1' }) });
  await service_call({ op: 'arrival', token, arrivalId: id, final: true, arrival: arrival({ password: 'Master-Pass-1' }) });
  const app = (await store.getWorkspace(ws)).tracker.apps.find((a) => a.collegeId === 'purdue');
  assert.equal(app.login.source, 'master');
  assert.equal((await logins.readLogins(ws))[app.id], undefined);
  assert.ok((await logins.readMaster(ws)).appIds[app.id]);
}));

test('a todo arrival keeps sealed set-up details for the signed-in student only, until a login is saved', () => isolated(async ({ sent }) => {
  const { ws, sub, token } = await withAddress();
  await service_call({ op: 'arrival', token, arrivalId: crypto.randomUUID(), final: true, arrival: arrival({ state: 'todo', pin: '483920', link: 'https://purdue.edu/activate?x=1', reason: 'PIN expired' }) });
  const app = (await store.getWorkspace(ws)).tracker.apps.find((a) => a.collegeId === 'purdue');
  assert.equal(app.setupWaiting, true);
  assert.doesNotMatch(JSON.stringify(await store.getWorkspace(ws)), /483920/);
  assert.doesNotMatch(JSON.stringify(sent), /483920|made-by-forge/);
  assert.match(sent[0].text, /Finish setup/);
  const raw = fs.readFileSync(path.join(process.env.CF_DATA_DIR, `setup/${ws}/${app.id}.json`), 'utf8');
  assert.doesNotMatch(raw, /483920/);

  assert.equal((await sessionPost(sub, ws, { action: 'setup-details', id: app.id }, { origin: 'https://evil.example' })).status, 403);
  const unauth = await appsRoute.POST(new NextRequest('http://localhost/api/applications', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'setup-details', id: app.id }) }));
  assert.equal(unauth.status, 401);
  const got = await (await sessionPost(sub, ws, { action: 'setup-details', id: app.id })).json();
  assert.equal(got.setup.pin, '483920');
  assert.equal(got.setup.password, 'made-by-forge');

  const status = await inbox.inboxStatus(ws);
  assert.equal(status.recent.length, 1);
  assert.equal(status.recent[0].state, 'todo');
  assert.doesNotMatch(JSON.stringify(status), /483920|made-by-forge|activate/);

  await service.setLogin(ws, app.id, { username: 'stu', password: 'Chosen-1' });
  assert.equal(await setup.readSetup(ws, app.id), null);
  assert.equal((await sessionPost(sub, ws, { action: 'setup-details', id: app.id })).status, 400);
}));

test('a failed forward leaves a school on the master login alone, and replays change nothing', () => isolated(async () => {
  const { ws, token } = await withAddress();
  await service.setMasterLogin(ws, { username: 'stu@example.com', password: 'Master-Pass-1' });
  const purdue = await service.addApp(ws, { name: 'Purdue University' });
  await service.useMasterFor(ws, purdue.id, true);
  const id = crypto.randomUUID();
  await service_call({ op: 'arrival', token, arrivalId: id, final: false, arrival: arrival() });
  await service_call({ op: 'arrival', token, arrivalId: id, final: true, arrival: arrival({ state: 'todo', pin: '777', reason: 'PIN expired' }) });
  assert.ok((await logins.readMaster(ws)).appIds[purdue.id], 'the master binding survives');
  assert.equal((await logins.readLogins(ws))[purdue.id], undefined);
  // A replayed final callback doesn't wipe the set-up details.
  await service_call({ op: 'arrival', token, arrivalId: id, final: true, arrival: arrival({ state: 'set' }) });
  assert.equal((await setup.readSetup(ws, purdue.id)).pin, '777');
}));

test('set-up details never hold the master password', () => isolated(async () => {
  const { ws, token } = await withAddress();
  await service.setMasterLogin(ws, { username: 'stu@example.com', password: 'Master-Pass-1' });
  await service_call({ op: 'arrival', token, arrivalId: crypto.randomUUID(), final: true, arrival: arrival({ state: 'todo', pin: '1', password: 'Master-Pass-1' }) });
  const app = (await store.getWorkspace(ws)).tracker.apps.find((a) => a.collegeId === 'purdue');
  assert.equal((await setup.readSetup(ws, app.id)).password, '');
}));

test('set-up details expire after 30 days and go when a check signs in', () => isolated(async () => {
  const ws = 'ops-setup-2';
  const a = await service.addApp(ws, { name: 'Purdue University' });
  await setup.saveSetup(ws, a.id, { username: 'u', password: 'p', pin: '1', link: '', state: 'set', reason: '', receivedAt: Date.now() });
  assert.ok(await setup.readSetup(ws, a.id));
  assert.equal(await setup.readSetup(ws, a.id, Date.now() + setup.SETUP_TTL_MS + 1), null);
  await service.markSetupWaiting(ws, a.id);
  await service.setLogin(ws, a.id, { username: 'u', password: 'p' });
  await setup.saveSetup(ws, a.id, { username: 'u', password: 'p', pin: '1', link: '', state: 'set', reason: '', receivedAt: Date.now() });
  await service.markSetupWaiting(ws, a.id);
  await runChecks(ws, { appIds: [a.id] });
  assert.equal(await setup.readSetup(ws, a.id), null);
  assert.equal((await store.getWorkspace(ws)).tracker.apps[0].setupWaiting, undefined);
}));

test('the recent arrivals list is capped at 20', () => isolated(async () => {
  const { ws, token } = await withAddress();
  for (let i = 0; i < 22; i++) {
    await service_call({ op: 'arrival', token, arrivalId: crypto.randomUUID(), final: true, arrival: arrival({ name: `School ${i}`, collegeId: null, portalUrl: '', state: 'todo', reason: 'Not in catalog' }) });
  }
  const recent = (await inbox.inboxStatus(ws)).recent;
  assert.equal(recent.length, inbox.MAX_RECENT);
  assert.equal(recent[0].name, 'School 21');
}));

test('a stored tracker keeps a valid schedule and drops a bad one', () => {
  const t = tracker.normalizeTracker({ apps: [], schedule: { everyHours: 8, startHour: 3, timeZone: 'Europe/Paris' }, lastSlotAt: 99 });
  assert.deepEqual(t.schedule, { everyHours: 8, startHour: 3, timeZone: 'Europe/Paris' });
  assert.equal(t.lastSlotAt, 99);
  const bad = tracker.normalizeTracker({ apps: [], schedule: { everyHours: 3 }, lastSlotAt: 'x' });
  assert.equal(bad.schedule.everyHours, 12);
  assert.equal(bad.lastSlotAt, undefined);
});
