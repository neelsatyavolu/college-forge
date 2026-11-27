const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request.startsWith('@/')) {
    const base = path.join(__dirname, '..', request.slice(2));
    return resolve.call(this, fs.existsSync(base + '.ts') ? base + '.ts' : base, ...args);
  }
  return resolve.call(this, request, ...args);
};

const { NextRequest } = require('next/server');
const store = require('../lib/store.ts');
const { newApp, editApp } = require('../lib/tracker.ts');
const { viewApp, shareTracker } = require('../lib/tracker-service.ts');
const board = require('../app/api/decisions/board/route.ts');
const plan = require('../app/api/ai/decision-plan/route.ts');

const WS = 'decision-board-ws';
const get = (pathname, cookie = `cf_workspace=${WS}`) => new NextRequest('http://localhost' + pathname, { headers: cookie ? { cookie } : {} });

async function isolated(run) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-board-'));
  const prev = process.env.CF_DATA_DIR, blob = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.CF_DATA_DIR = dir;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try { await run(dir); } finally {
    if (prev === undefined) delete process.env.CF_DATA_DIR; else process.env.CF_DATA_DIR = prev;
    if (blob !== undefined) process.env.BLOB_READ_WRITE_TOKEN = blob;
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

test("main's aid offer reaches the student's view only; null clears it", () => {
  const app = newApp({ name: 'Cornell University' }, 1);
  const set = editApp(app, { aidOffer: { costOfAttendance: '$85,000', grants: 60000 } }, 5);
  assert.deepEqual(set.aidOffer, { costOfAttendance: 85000, grants: 60000, updatedAt: 5 });
  assert.equal(viewApp(set).aidOffer.costOfAttendance, 85000);
  assert.ok(shareTracker({ apps: [set], autocheck: true, emails: true, flags: [] }).apps.every((a) => !('aidOffer' in a)), 'progress links never carry it');
  assert.equal('aidOffer' in editApp(set, { aidOffer: null }), false);
  assert.deepEqual(editApp(set, { notes: 'hi' }).aidOffer, set.aidOffer, 'other edits keep it');
});

test('board routes refuse without a workspace and never set a cookie', () => isolated(async () => {
  for (const [route, p] of [[board, '/api/decisions/board'], [plan, '/api/ai/decision-plan']]) {
    const res = await route.GET(get(p, ''));
    assert.equal(res.status, 400);
    assert.equal(res.headers.get('set-cookie'), null);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const stranger = await route.GET(get(p, 'cf_workspace=never-stored-ws'));
    assert.equal(stranger.status, 400, 'a cookie with nothing stored creates nothing');
  }
  assert.equal(await store.peekWorkspace('never-stored-ws'), null);
}));

test('the board and plan read the visitor workspace', () => isolated(async () => {
  await store.updateWorkspace(WS, (ws) => ({ ...ws, tracker: { ...ws.tracker, apps: [{ ...newApp({ name: 'Cornell University' }, 1), id: 'c', status: 'admitted' }, { ...newApp({ name: 'Rice University' }, 1), id: 'r', status: 'submitted' }] } }));
  const res = await board.GET(get('/api/decisions/board'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.schools.map((s) => s.id), ['c']);
  assert.equal(body.picks, null);
  const p = await (await plan.GET(get('/api/ai/decision-plan'))).json();
  assert.match(p.step.prompt, /exactly 1,/);
  assert.equal(p.fingerprint, body.fingerprint);
  await store.updateWorkspace(WS, (ws) => ({ ...ws, tracker: { ...ws.tracker, apps: ws.tracker.apps.map((a) => ({ ...a, status: 'waitlisted' })) } }));
  assert.equal((await plan.GET(get('/api/ai/decision-plan'))).status, 400);
}));
