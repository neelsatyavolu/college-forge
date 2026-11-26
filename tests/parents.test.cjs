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
process.env.CF_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-parents-'));
delete process.env.BLOB_READ_WRITE_TOKEN;
process.env.SESSION_SECRET = 'synthetic-session-secret-for-parent-tests-0123456';
process.env.DEV_EMAIL = '1';
const { NextRequest } = require('next/server');
const { signInAccount, signSession, SESSION_COOKIE } = require('../lib/session.ts');
const { updateWorkspace } = require('../lib/store.ts');
const { parentView } = require('../lib/parent-view.ts');
const parentsRoute = require('../app/api/parents/route.ts');
const parentList = require('../app/api/parent/route.ts');
const parentOne = require('../app/api/parent/[id]/route.ts');
const accept = require('../app/parent/accept/route.ts');
const workspaceRoute = require('../app/api/workspace/route.ts');
const me = require('../app/api/me/route.ts');

// Synthetic people only.
const STUDENT = { sub: 'test-student-aaaa', email: 'student@forge.invalid', name: 'Sam Student' };
const PARENT = { sub: 'test-parent-bbbb', email: 'parent@forge.invalid', name: 'Pat Parent' };
const OTHER = { sub: 'test-other-cccc', email: 'other@forge.invalid', name: 'Other Person' };

async function cookieFor(user) {
  const account = await signInAccount(user, null);
  return { account, cookie: `${SESSION_COOKIE}=${signSession({ sub: account.sub, workspaceId: account.workspaceId, email: account.email, name: account.name })}` };
}
const call = (handler, url, cookie, body, method = body ? 'POST' : 'GET', extra = {}) =>
  handler(new NextRequest(`https://forge.test${url}`, { method, headers: { cookie, 'content-type': 'application/json', ...extra }, body: body ? JSON.stringify(body) : undefined }), ...(extra.ctx ? [extra.ctx] : []));
const acceptPost = (cookie, token) => accept.POST(new NextRequest('https://forge.test/parent/accept', { method: 'POST', headers: { cookie, origin: 'https://forge.test', 'content-type': 'application/x-www-form-urlencoded' }, body: `t=${encodeURIComponent(token)}` }));
const tokenOf = (url) => new URL(url).searchParams.get('t');

function seed(ws) {
  return {
    ...ws,
    applicant: { ...ws.applicant, name: 'Sam Student', cycle: '2026-27', gpaUnweighted: '3.9', sat: '1500' },
    profile: { ...ws.profile, activities: [{ rank: 1, name: 'Robotics', type: 'Club' }] },
    essayDrafts: { personal: 'Synthetic draft text' },
    scholarships: [{ id: 's1', name: 'Test Award', status: 'researching', notes: 'private note' }],
    tracker: {
      ...ws.tracker,
      apps: [
        { id: 'a1', name: 'Test University', status: 'admitted', round: 'RD', followUps: [{ id: 'f1', text: 'Send scores' }], decision: { state: 'revealed', result: 'admitted' }, login: { username: 'secret-user', hasPassword: true } },
        // Decisions the student hasn't opened, as a portal check stores them.
        { id: 'a2', name: 'Hidden College', status: 'complete', round: 'RD', followUps: [], portal: { checkedAt: 1, ok: true, error: '', statusText: 'Admitted', update: '', checklist: [], outcome: 'Congratulations' } },
        { id: 'a3', name: 'State College', status: 'complete', round: 'RD', followUps: [], portal: { checkedAt: 1, ok: true, error: '', statusText: 'Not CSU Eligible', update: '', checklist: [] } },
      ],
    },
  };
}

test('levels: basic hides to-dos and the profile; full adds profile and essays; never logins or hidden decisions', () => {
  const { emptyWorkspace } = require('../lib/store.ts');
  const { normalizeTracker } = require('../lib/tracker.ts');
  const seeded = seed(emptyWorkspace());
  const ws = { ...seeded, tracker: normalizeTracker(seeded.tracker) };
  assert.equal(ws.tracker.apps.length, 3);
  const basic = parentView(ws, 'basic');
  assert.equal(basic.colleges, undefined);
  assert.equal(basic.profile, undefined);
  assert.equal(basic.essayDrafts, undefined);
  assert.ok(basic.progress.apps.every((a) => a.followUps.length === 0));
  const standard = parentView(ws, 'standard');
  assert.ok(Array.isArray(standard.colleges));
  assert.equal(standard.profile, undefined);
  assert.equal(standard.scholarships[0].notes, undefined, 'student notes stay private below full');
  const full = parentView(ws, 'full');
  assert.equal(full.essayDrafts.personal, 'Synthetic draft text');
  assert.equal(full.profile.activities[0].name, 'Robotics');
  for (const view of [basic, standard, full]) {
    const text = JSON.stringify(view);
    assert.ok(!text.includes('secret-user'), 'no portal logins');
    const unopened = JSON.stringify(view.progress.apps.filter((a) => a.id === 'a2' || a.id === 'a3'));
    assert.equal(view.progress.apps.filter((a) => a.decision.state === 'hidden').length, 2);
    assert.ok(!text.includes('Congratulations') && !unopened.includes('Admitted') && !text.includes('Not CSU Eligible'), 'no unopened decision');
    assert.ok(!text.includes('recoveryCode') && !text.includes('admissionOdds') && !text.includes('uploads'));
  }
});

test('invite → accept → parent sees the student at the chosen level; changes and removal apply right away', async () => {
  const student = await cookieFor(STUDENT);
  const parent = await cookieFor(PARENT);
  await updateWorkspace(student.account.workspaceId, seed);

  assert.equal((await call(parentsRoute.POST, '/api/parents', '', { action: 'invite', email: 'x@forge.invalid' })).status, 401, 'signed-in students only');
  assert.equal((await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'invite', email: 'not an email' })).status, 400);
  const invited = await (await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'invite', email: 'Parent@Forge.invalid', level: 'basic' })).json();
  assert.equal(invited.success, true);
  assert.equal(invited.emailed, true);
  assert.equal(invited.data[0].status, 'invited');
  assert.equal(invited.data[0].email, 'parent@forge.invalid');
  assert.ok(!('inviteHash' in invited.data[0]), 'the invite hash stays on the server');
  const token = tokenOf(invited.url);
  assert.equal((await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'invite', email: 'x@forge.invalid' }, 'POST', { origin: 'https://evil.xanom.co' })).status, 403, 'a sibling site cannot invite');

  // A forwarded link does nothing for another account.
  const wrong = await acceptPost((await cookieFor(OTHER)).cookie, token);
  assert.equal(wrong.status, 400);
  assert.match(await wrong.text(), /sent to p/);

  // Opening the link never accepts it.
  const page = await accept.GET(new NextRequest(`https://forge.test/parent/accept?t=${token}`, { headers: { cookie: parent.cookie } }));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Sam invited you/);
  assert.equal((await (await call(parentList.GET, '/api/parent', parent.cookie)).json()).data.students.length, 0);

  // The student can't accept their own invite; a cross-site post is refused.
  assert.equal((await acceptPost(student.cookie, token)).status, 400);
  const cross = await accept.POST(new NextRequest('https://forge.test/parent/accept', { method: 'POST', headers: { cookie: parent.cookie, origin: 'https://evil.test' }, body: `t=${token}` }));
  assert.equal(cross.status, 403);

  assert.equal((await acceptPost(parent.cookie, token)).status, 200);
  assert.equal((await acceptPost((await cookieFor({ ...PARENT, sub: 'test-parent-second' })).cookie, token)).status, 404, 'an invite works once');

  const list = await (await call(parentList.GET, '/api/parent', parent.cookie)).json();
  assert.equal(list.data.students.length, 1);
  const id = list.data.students[0].id;
  const view = async (cookie) => call(parentOne.GET, `/api/parent/${id}`, cookie, null, 'GET', { ctx: { params: Promise.resolve({ id }) } });
  const basic = await (await view(parent.cookie)).json();
  assert.equal(basic.data.level, 'basic');
  assert.equal(basic.data.student.name, 'Sam Student');
  assert.equal(basic.data.profile, undefined);
  assert.equal((await view((await cookieFor(OTHER)).cookie)).status, 404, 'another account cannot open it');

  const meBody = await (await call(me.GET, '/api/me', parent.cookie)).json();
  assert.deepEqual(meBody.parent, { students: 1, home: true });

  const shown = await (await call(parentsRoute.GET, '/api/parents', student.cookie)).json();
  assert.equal(shown.data[0].status, 'active');
  assert.equal(shown.data[0].parentEmail, 'parent@forge.invalid');
  await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'set-level', id: shown.data[0].id, level: 'full' });
  const full = await (await view(parent.cookie)).json();
  assert.equal(full.data.profile.activities[0].name, 'Robotics');

  await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'remove', id: shown.data[0].id });
  assert.equal((await view(parent.cookie)).status, 404);
  assert.equal((await (await call(parentList.GET, '/api/parent', parent.cookie)).json()).data.students.length, 0);
});

test('a workspace reset ends parent access', async () => {
  const student = await cookieFor({ ...STUDENT, sub: 'test-student-reset' });
  const parent = await cookieFor({ ...PARENT, sub: 'test-parent-reset', email: 'p2@forge.invalid' });
  const invited = await (await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'invite', email: 'p2@forge.invalid', level: 'standard' })).json();
  await acceptPost(parent.cookie, tokenOf(invited.url));
  assert.equal((await (await call(parentList.GET, '/api/parent', parent.cookie)).json()).data.students.length, 1);
  await call(workspaceRoute.POST, '/api/workspace', student.cookie, { action: 'reset' });
  assert.equal((await (await call(parentList.GET, '/api/parent', parent.cookie)).json()).data.students.length, 0);
});

test('re-inviting the same address replaces the old link', async () => {
  const student = await cookieFor({ ...STUDENT, sub: 'test-student-resend' });
  const first = await (await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'invite', email: 'p3@forge.invalid' })).json();
  const second = await (await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'invite', email: 'p3@forge.invalid' })).json();
  assert.equal(second.data.length, 1);
  const parent = await cookieFor({ ...PARENT, sub: 'test-parent-resend', email: 'p3@forge.invalid' });
  assert.equal((await acceptPost(parent.cookie, tokenOf(first.url))).status, 404);
  assert.equal((await acceptPost(parent.cookie, tokenOf(second.url))).status, 200);
});
