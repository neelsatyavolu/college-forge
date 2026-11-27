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
process.env.CF_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-coaches-'));
delete process.env.BLOB_READ_WRITE_TOKEN;
process.env.SESSION_SECRET = 'synthetic-session-secret-for-coach-tests-0123456';
process.env.DEV_EMAIL = '1';
const { NextRequest } = require('next/server');
const { signInAccount, signSession, SESSION_COOKIE } = require('../lib/session.ts');
const { updateWorkspace, getWorkspace } = require('../lib/store.ts');
const { writeDoc, readDoc } = require('../lib/doc-store.ts');
const { essaysView } = require('../lib/parent-view.ts');
const { MAX_COACHES, INVITE_TTL_MS, readInvite } = require('../lib/parents.ts');
const parentsRoute = require('../app/api/parents/route.ts');
const parentList = require('../app/api/parent/route.ts');
const parentOne = require('../app/api/parent/[id]/route.ts');
const accept = require('../app/parent/accept/route.ts');
const share = require('../app/api/share/[token]/route.ts');
const workspaceRoute = require('../app/api/workspace/route.ts');
const me = require('../app/api/me/route.ts');

// Synthetic people only.
let n = 0;
const person = (kind) => { n += 1; return { sub: `test-${kind}-${n}`, email: `${kind}${n}@forge.invalid`, name: `${kind[0].toUpperCase()}${kind.slice(1)} Person${n}` }; };

async function cookieFor(user) {
  const account = await signInAccount(user, null);
  return { account, user, cookie: `${SESSION_COOKIE}=${signSession({ sub: account.sub, workspaceId: account.workspaceId, email: account.email, name: account.name })}` };
}
const call = (handler, url, cookie, body, extra = {}) =>
  handler(new NextRequest(`https://forge.test${url}`, { method: body ? 'POST' : 'GET', headers: { cookie, 'content-type': 'application/json', ...(extra.headers || {}) }, body: body ? JSON.stringify(body) : undefined }), ...(extra.ctx ? [extra.ctx] : []));
const ctx = (id) => ({ params: Promise.resolve({ id }) });
const acceptPost = (cookie, token) => accept.POST(new NextRequest('https://forge.test/parent/accept', { method: 'POST', headers: { cookie, origin: 'https://forge.test', 'content-type': 'application/x-www-form-urlencoded' }, body: `t=${encodeURIComponent(token)}` }));
const tokenOf = (url) => new URL(url).searchParams.get('t');

function seed(ws) {
  const essayId = ws.essays.commonApp[0].id;
  return {
    ...ws,
    applicant: { ...ws.applicant, name: 'Sam Student', cycle: '2026-27', gpaUnweighted: '3.9', sat: '1500' },
    profile: { ...ws.profile, activities: [{ rank: 1, name: 'Robotics', type: 'Club' }] },
    colleges: [{ slug: 'test-u', name: 'Test University', short: 'Test U', tier: 'target', admit: '30%' }],
    essays: { ...ws.essays, supplements: { 'test-u': [{ id: 'tu-why', label: 'Why Test U', prompt: 'Why us?', limit: 250, unit: 'words' }] } },
    essayDrafts: { [essayId]: 'Synthetic personal statement draft', 'tu-why': 'Synthetic why-us draft', orphan: 'not an essay' },
    essayStatus: { [essayId]: 'draft' },
    essaySuggestions: { [essayId]: { text: 'copilot private suggestion', createdAt: 1 } },
    essayAiChecks: { [essayId]: { checkedAt: 1, verdict: 'human', ai: 0.01, mixed: 0.02, human: 0.97, words: 300 } },
    scholarships: [{ id: 's1', name: 'Secret Award', status: 'researching' }],
    advisorNotes: [
      { id: 'n-progress', body: 'progress link note', author: 'Advisor', createdAt: 1, via: 'progress' },
      { id: 'n-full', body: 'full link note', author: 'Advisor', createdAt: 2, essayId, via: 'full' },
    ],
    tracker: { ...ws.tracker, apps: [{ id: 'a1', name: 'Test University', status: 'admitted', round: 'RD', followUps: [], decision: { state: 'revealed', result: 'admitted' }, login: { username: 'secret-user', hasPassword: true } }] },
  };
}

async function setup() {
  const student = await cookieFor(person('student'));
  const coach = await cookieFor(person('coach'));
  await updateWorkspace(student.account.workspaceId, seed);
  const invited = await (await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'invite', role: 'coach', email: coach.user.email, level: 'full' })).json();
  return { student, coach, invited, token: tokenOf(invited.url) };
}

test('the essays-only view is an allow-list: essays, drafts and school names, nothing else', async () => {
  const s = await cookieFor(person('student'));
  const ws = seed(await getWorkspace(s.account.workspaceId));
  const v = essaysView(ws);
  assert.equal(v.level, 'essays');
  assert.deepEqual(v.student, { name: 'Sam', cycle: '2026-27' });
  assert.deepEqual(v.schools, [{ slug: 'test-u', name: 'Test U' }]);
  assert.equal(v.essayDrafts['tu-why'], 'Synthetic why-us draft');
  assert.equal(v.essayDrafts.orphan, undefined, 'drafts only for essays that exist');
  const text = JSON.stringify(v);
  for (const hidden of ['secret-user', 'Secret Award', 'Robotics', '3.9', '1500', 'copilot private suggestion', 'progress link note', 'full link note', '30%', 'admitted', 'verdict']) {
    assert.ok(!text.includes(hidden), `leaves out ${hidden}`);
  }
  assert.equal(v.progress, undefined);
  assert.equal(v.colleges, undefined);
});

test('coach invite → accept with the invited email → essays-only dashboard, comment on essays only', async () => {
  const { student, coach, invited, token } = await setup();
  assert.equal(invited.success, true);
  const link = invited.data.find((l) => l.role === 'coach');
  assert.equal(link.level, 'essays', 'a coach never gets a chosen level');
  assert.ok(!('inviteHash' in link));

  // A forwarded link does nothing for another account; the student can't accept their own invite.
  assert.equal((await acceptPost((await cookieFor(person('other'))).cookie, token)).status, 400);
  assert.equal((await acceptPost(student.cookie, token)).status, 400);
  const page = await accept.GET(new NextRequest(`https://forge.test/parent/accept?t=${token}`, { headers: { cookie: coach.cookie } }));
  assert.match(await page.text(), /essay writing coach/);
  const ok = await acceptPost(coach.cookie, token);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /writing coach/);
  assert.equal((await acceptPost(coach.cookie, token)).status, 404, 'an invite works once');

  const meBody = await (await call(me.GET, '/api/me', coach.cookie)).json();
  assert.equal(meBody.parent.coach, true);
  const list = (await (await call(parentList.GET, '/api/parent', coach.cookie)).json()).data.students;
  assert.equal(list.length, 1);
  assert.equal(list[0].role, 'coach');
  assert.equal(list[0].name, 'Sam', 'first name only');
  assert.equal(list[0].applications, undefined, 'no application count');

  const id = list[0].id;
  const view = (await (await call(parentOne.GET, `/api/parent/${id}`, coach.cookie, null, { ctx: ctx(id) })).json()).data;
  assert.equal(view.level, 'essays');
  assert.equal(view.role, 'coach');
  assert.equal(view.progress, undefined);
  assert.deepEqual(view.notes, []);
  assert.ok(!JSON.stringify(view).includes('secret-user'));

  // The student can't widen a coach's access.
  const setLevel = await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'set-level', id: link.id, level: 'full' });
  assert.equal(setLevel.status, 400);

  const essayId = view.essays.commonApp[0].id;
  const post = (body, headers) => call(parentOne.POST, `/api/parent/${id}`, coach.cookie, body, { ctx: ctx(id), headers });
  assert.equal((await post({ action: 'note', essayId: 'nope', body: 'x' })).status, 404, 'unknown essay');
  assert.equal((await post({ action: 'note', body: 'x' })).status, 400, 'an essay is required');
  assert.equal((await post({ action: 'note', essayId, body: 'x'.repeat(4001) })).status, 400, 'too long');
  assert.equal((await post({ action: 'note', essayId, body: 'hi' }, { origin: 'https://evil.xanom.co' })).status, 403, 'cross-site');
  const added = await (await post({ action: 'note', essayId, body: 'Tighten the opening.', author: 'Forged Name', via: 'progress' })).json();
  assert.equal(added.success, true);
  assert.equal(added.data.notes.length, 1);
  const saved = (await getWorkspace(student.account.workspaceId)).advisorNotes.find((x) => x.body === 'Tighten the opening.');
  assert.equal(saved.via, 'coach');
  assert.equal(saved.author, coach.user.name, 'author from the session, not the body');
  assert.equal(saved.essayId, essayId);
  assert.equal(saved.byLink, id);

  // Coach notes never show on a progress share link.
  const shared = await (await call(workspaceRoute.POST, '/api/workspace', student.cookie, { action: 'create-share', label: 'Parents', scope: 'progress' }, { headers: { origin: 'https://forge.test' } })).json();
  assert.ok(shared.token, 'progress link created');
  const shareRes = await share.GET(new NextRequest(`https://forge.test/api/share/${shared.token}`), { params: Promise.resolve({ token: shared.token }) });
  assert.equal(shareRes.status, 200);
  assert.ok(!(await shareRes.text()).includes('Tighten the opening.'), 'progress links leave out coach notes');

  // A coach can delete only their own note.
  assert.equal((await (await post({ action: 'delete-note', noteId: 'n-full' })).json()).success, true);
  assert.ok((await getWorkspace(student.account.workspaceId)).advisorNotes.some((x) => x.id === 'n-full'), 'not theirs to delete');
  await post({ action: 'delete-note', noteId: saved.id });
  assert.ok(!(await getWorkspace(student.account.workspaceId)).advisorNotes.some((x) => x.id === saved.id));

  // Removed: no access even with the reverse index entry put back.
  await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'remove', id: link.id });
  await writeDoc(`parent-of/${coach.account.sub}.json`, { students: [{ linkId: id, workspaceId: student.account.workspaceId }] });
  assert.equal((await call(parentOne.GET, `/api/parent/${id}`, coach.cookie, null, { ctx: ctx(id) })).status, 404);
  assert.equal((await post({ action: 'note', essayId, body: 'still here?' })).status, 404);
});

test('parents cannot comment, and a parent cannot be re-invited as a coach', async () => {
  const student = await cookieFor(person('student'));
  const parent = await cookieFor(person('parent'));
  await updateWorkspace(student.account.workspaceId, seed);
  const inv = await (await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'invite', email: parent.user.email, level: 'full' })).json();
  assert.equal((await acceptPost(parent.cookie, tokenOf(inv.url))).status, 200);
  const id = (await (await call(parentList.GET, '/api/parent', parent.cookie)).json()).data.students[0].id;
  const essayId = (await getWorkspace(student.account.workspaceId)).essays.commonApp[0].id;
  assert.equal((await call(parentOne.POST, `/api/parent/${id}`, parent.cookie, { action: 'note', essayId, body: 'hi' }, { ctx: ctx(id) })).status, 403);
  assert.equal((await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'invite', role: 'Coach', email: 'typo@forge.invalid' })).status, 400, 'an unknown role is refused, not made a parent');
  // A student's own patch can't pose as a coach.
  const patched = await workspaceRoute.PATCH(new NextRequest('https://forge.test/api/workspace', { method: 'PATCH', headers: { cookie: student.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ advisorNote: { body: 'forged', essayId, via: 'coach', byLink: id } }) }));
  assert.equal(patched.status, 200);
  const forged = (await getWorkspace(student.account.workspaceId)).advisorNotes.find((x) => x.body === 'forged');
  assert.equal(forged.via, undefined);
  assert.equal(forged.byLink, undefined);
  const again = await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'invite', role: 'coach', email: parent.user.email });
  assert.equal(again.status, 400);
  assert.match((await again.json()).error, /Remove it first to change its role/);
});

test('coach invites cap at MAX_COACHES, expire after 14 days, and reset removes coaches', async () => {
  const student = await cookieFor(person('student'));
  for (let i = 0; i < MAX_COACHES; i++) {
    assert.equal((await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'invite', role: 'coach', email: `cap${i}@forge.invalid` })).status, 200);
  }
  const over = await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'invite', role: 'coach', email: 'cap-over@forge.invalid' });
  assert.equal(over.status, 400);
  assert.match((await over.json()).error, /up to 3 writing coaches/);
  assert.equal((await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'invite', email: 'still-a-parent@forge.invalid' })).status, 200, 'parents have their own cap');

  const { token } = await setup();
  assert.ok(await readInvite(token));
  assert.equal(await readInvite(token, Date.now() + INVITE_TTL_MS + 1000), null, 'expired after 14 days');

  const ws = student.account.workspaceId;
  const reset = await call(workspaceRoute.POST, '/api/workspace', student.cookie, { action: 'reset' }, { headers: { origin: 'https://forge.test' } });
  assert.equal(reset.status, 200);
  assert.equal(await readDoc(`parents/${ws}.json`), null);
});
