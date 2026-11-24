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
const { splitStoryNotes } = require('../lib/story-notes.ts');
const workspace = require('../app/api/workspace/route.ts');
const me = require('../app/api/me/route.ts');
const { signSession } = require('../lib/session.ts');

const WS_ID = 'onboarding-test-workspace';
function req(body, method = 'POST', extraCookie = '') {
  return new NextRequest('http://localhost/api/workspace', { method, headers: { cookie: `cf_workspace=${WS_ID}${extraCookie}`, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body) });
}
async function isolated(run) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-onboarding-'));
  const prev = process.env.CF_DATA_DIR, blob = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.CF_DATA_DIR = dir; delete process.env.BLOB_READ_WRITE_TOKEN;
  try { await store.getWorkspace(WS_ID); await run(dir); } finally {
    if (prev === undefined) delete process.env.CF_DATA_DIR; else process.env.CF_DATA_DIR = prev;
    if (blob === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = blob;
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

test('story lines split into activities and honors at the first dash', () => {
  const { activities, honors } = splitStoryNotes({
    activities: '• Debate captain — 8 hrs/wk, 3 yrs — led team to state semis\n\n- Robotics lead programmer - built a vision stack\n3. Part-time job\nSelf-taught guitar',
    awards: '• National Merit Semifinalist (2026)\nRegional science fair — 1st, engineering',
  });
  assert.deepEqual(activities.map((a) => [a.rank, a.name, a.desc]), [
    [1, 'Debate captain', '8 hrs/wk, 3 yrs — led team to state semis'],
    [2, 'Robotics lead programmer', 'built a vision stack'],
    [3, 'Part-time job', undefined],
    [4, 'Self-taught guitar', undefined],
  ]);
  assert.deepEqual(honors.map((h) => h.title), ['National Merit Semifinalist (2026)', 'Regional science fair — 1st, engineering']);
});

test('story splitting keeps the Common App caps and description limit', () => {
  const lines = Array.from({ length: 14 }, (_, i) => `Club ${i + 1} — ${'x'.repeat(300)}`).join('\n');
  const { activities, honors } = splitStoryNotes({ activities: lines, awards: Array.from({ length: 9 }, (_, i) => `Award ${i}`).join('\n') });
  assert.equal(activities.length, 10);
  assert.equal(honors.length, 5);
  assert.ok(activities.every((a) => a.desc.length <= 150));
});

const onboardingBody = {
  action: 'complete-onboarding',
  applicant: { name: 'Sample Student', gpaUnweighted: '3.6' },
  profile: { hs: 'Sample High', intended: 'Biology', gradYear: '2027' },
  storyNotes: { activities: 'Debate captain — 8 hrs/wk\nLibrary volunteer', awards: 'AP Scholar', other: '' },
  listPrefs: { ambition: 'balanced' },
};

test('complete-onboarding turns story text into activities and stores list gaps', () => isolated(async () => {
  const res = await workspace.POST(req(onboardingBody));
  assert.equal(res.status, 200);
  const ws = (await res.json()).data;
  assert.deepEqual(ws.profile.activities.map((a) => a.name), ['Debate captain', 'Library volunteer']);
  assert.equal(ws.profile.activities[0].desc, '8 hrs/wk');
  assert.deepEqual(ws.profile.honors.map((h) => h.title), ['AP Scholar']);
  assert.ok(Array.isArray(ws.onboarding.listGaps));
}));

test('complete-onboarding leaves saved activities alone', () => isolated(async () => {
  await store.updateWorkspace(WS_ID, (ws) => ({ ...ws, profile: { ...ws.profile, activities: [{ rank: 1, name: 'Existing', type: '' }] } }));
  const ws = (await (await workspace.POST(req(onboardingBody))).json()).data;
  assert.deepEqual(ws.profile.activities.map((a) => a.name), ['Existing']);
}));

test('/api/me says when a signed-in workspace still needs onboarding', () => isolated(async () => {
  const prev = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'test-secret-that-is-long-enough-1234567890';
  try {
    const cookie = `; forge_session=${signSession({ sub: 'synthetic-sub', workspaceId: WS_ID, email: 'student@example.com', name: 'Sample' })}`;
    const before = await (await me.GET(req(null, 'GET', cookie))).json();
    assert.equal(before.signedIn, true);
    assert.equal(before.needsOnboarding, true);
    await workspace.POST(req(onboardingBody));
    const after = await (await me.GET(req(null, 'GET', cookie))).json();
    assert.equal(after.needsOnboarding, false);
    const signedOut = await (await me.GET(req(null, 'GET'))).json();
    assert.equal(signedOut.needsOnboarding, false);
  } finally {
    if (prev === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = prev;
  }
}));

test('the wizard list-mix counts use the recommender shares', () => {
  const parse = (file, name) => {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const m = src.match(new RegExp(`const ${name} = (\\{[^}]+\\})`));
    assert.ok(m, `${name} not found in ${file}`);
    return JSON.parse(m[1].replace(/(\w+):/g, '"$1":'));
  };
  assert.deepEqual(parse('public/hub/Onboarding.jsx', 'LIST_SHARES'), parse('lib/college-recommendations.ts', 'SHARES'));
});
