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
  assert.deepEqual(meBody.parent, { students: 1, home: true, counselor: false });

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

// ── Counselors ──────────────────────────────────────────────────────────────
const COUNSELOR = { sub: 'test-counselor-dddd', email: 'counselor@forge.invalid', name: 'Casey Counselor' };
const { followerSummary } = require('../lib/follower-summary.ts');

test('a counselor invite starts at full, reads as a counselor invite, and the roster shows a summary', async () => {
  const student = await cookieFor({ ...STUDENT, sub: 'test-student-coun' });
  const counselor = await cookieFor(COUNSELOR);
  await updateWorkspace(student.account.workspaceId, seed);
  const invited = await (await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'invite', email: COUNSELOR.email, role: 'counselor' })).json();
  assert.equal(invited.success, true);
  assert.equal(invited.data[0].role, 'counselor');
  assert.equal(invited.data[0].level, 'full', 'counselors start at full');
  const token = tokenOf(invited.url);
  const page = await accept.GET(new NextRequest(`https://forge.test/parent/accept?t=${token}`, { headers: { cookie: counselor.cookie } }));
  assert.match(await page.text(), /counselor/i);
  assert.equal((await acceptPost(counselor.cookie, token)).status, 200);
  const list = await (await call(parentList.GET, '/api/parent', counselor.cookie)).json();
  const s = list.data.students[0];
  assert.equal(s.role, 'counselor');
  assert.equal(s.summary.applications, 3);
  assert.equal(typeof s.summary.dueSoon, 'number');
  const meBody = await (await call(me.GET, '/api/me', counselor.cookie)).json();
  assert.equal(meBody.parent.counselor, true);
});

test('a counselor leaves notes the student sees; a parent cannot; access ends notes', async () => {
  const student = await cookieFor({ ...STUDENT, sub: 'test-student-notes' });
  const counselor = await cookieFor({ ...COUNSELOR, sub: 'test-counselor-notes', email: 'c2@forge.invalid' });
  const parent = await cookieFor({ ...PARENT, sub: 'test-parent-notes', email: 'p9@forge.invalid' });
  await updateWorkspace(student.account.workspaceId, seed);
  const c = await (await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'invite', email: 'c2@forge.invalid', role: 'counselor' })).json();
  const p = await (await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'invite', email: 'p9@forge.invalid', level: 'full' })).json();
  await acceptPost(counselor.cookie, tokenOf(c.url));
  await acceptPost(parent.cookie, tokenOf(p.url));
  const cid = (await (await call(parentList.GET, '/api/parent', counselor.cookie)).json()).data.students[0].id;
  const pid = (await (await call(parentList.GET, '/api/parent', parent.cookie)).json()).data.students[0].id;
  const post = (cookie, id, body, extra = {}) => call(parentOne.POST, `/api/parent/${id}`, cookie, body, 'POST', { ctx: { params: Promise.resolve({ id }) }, ...extra });
  const view = (cookie, id) => call(parentOne.GET, `/api/parent/${id}`, cookie, null, 'GET', { ctx: { params: Promise.resolve({ id }) } });

  assert.equal((await post(parent.cookie, pid, { action: 'note', body: 'Hi' })).status, 403, 'parents read only');
  assert.equal((await post(counselor.cookie, cid, { action: 'note', body: '' })).status, 400);
  assert.equal((await post(counselor.cookie, cid, { action: 'note', body: 'x' }, { origin: 'https://evil.xanom.co' })).status, 403, 'no cross-site writes');
  const saved = await (await post(counselor.cookie, cid, { action: 'note', body: 'Tighten the opening.', essayId: 'ca-ps-1', author: 'Spoofed Name' })).json();
  assert.equal(saved.success, true);
  assert.equal(saved.data.notes.length, 1);
  assert.equal(saved.data.notes[0].author, 'Casey Counselor', 'author comes from the account, not the body');
  assert.equal(saved.data.notes[0].essayId, 'ca-ps-1');

  const ws = await (await call(workspaceRoute.GET, '/api/workspace', student.cookie)).json();
  const note = (ws.data || ws).advisorNotes.find((n) => n.body === 'Tighten the opening.');
  assert.equal(note.via, 'counselor');
  assert.equal(note.essayId, 'ca-ps-1');
  assert.equal((await (await view(parent.cookie, pid)).json()).data.notes, undefined, 'parents do not see counselor notes');

  // Below full the counselor can't see essays, so a note can't point at one.
  const links = (await (await call(parentsRoute.GET, '/api/parents', student.cookie)).json()).data;
  const link = links.find((l) => l.role === 'counselor');
  await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'set-level', id: link.id, level: 'standard' });
  const plain = await (await post(counselor.cookie, cid, { action: 'note', body: 'General note', essayId: 'ca-ps-1' })).json();
  assert.equal(plain.data.notes.find((n) => n.body === 'General note').essayId, undefined);

  const removed = await (await post(counselor.cookie, cid, { action: 'delete-note', noteId: note.id })).json();
  assert.equal(removed.data.notes.some((n) => n.id === note.id), false, 'a counselor can delete their own note');

  await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'remove', id: link.id });
  assert.equal((await post(counselor.cookie, cid, { action: 'note', body: 'After removal' })).status, 404);
});

test('roster summary: overdue, due soon and next deadline from what the level shows', () => {
  const view = {
    level: 'standard',
    progress: {
      flags: [{ id: 'g1', text: 'Missing transcript', scope: '' }],
      apps: [
        { id: 'a', name: 'Late U', stage: 'working', deadline: '2026-11-20', decision: { state: 'none' }, status: 'in_progress' },
        { id: 'b', name: 'Soon College', stage: 'working', deadline: '2026-12-01', decision: { state: 'none' }, status: 'planning' },
        { id: 'c', name: 'Far U', stage: 'working', deadline: '2027-01-15', decision: { state: 'none' }, status: 'planning' },
        { id: 'd', name: 'Done U', stage: 'admitted', deadline: '2026-11-01', submittedAt: '2026-10-30', decision: { state: 'revealed' }, status: 'admitted' },
      ],
    },
    criticalDates: [{ date: '2026-11-28', label: 'CSS Profile' }],
  };
  const s = followerSummary(view, '2026-11-26');
  assert.equal(s.applications, 4);
  assert.equal(s.submitted, 1);
  assert.equal(s.decisions, 1);
  assert.equal(s.overdue, 1);
  assert.equal(s.dueSoon, 2, 'Soon College and the CSS Profile date are within 14 days');
  assert.equal(s.flags, 1);
  assert.deepEqual(s.next, { date: '2026-11-28', title: 'CSS Profile' });
  assert.equal(s.upcoming.length, 2);
  assert.ok(s.attention > followerSummary({ ...view, progress: { flags: [], apps: [] }, criticalDates: [] }, '2026-11-26').attention);
});

test('review fixes: notes follow the reader level, client patches cannot forge counselor notes, levels are validated', async () => {
  const student = await cookieFor({ ...STUDENT, sub: 'test-student-fix' });
  const full = await cookieFor({ ...COUNSELOR, sub: 'test-counselor-full', email: 'cf@forge.invalid' });
  const basic = await cookieFor({ ...COUNSELOR, sub: 'test-counselor-basic', email: 'cb@forge.invalid', name: 'Bo Basic' });
  await updateWorkspace(student.account.workspaceId, seed);
  assert.equal((await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'invite', email: 'x@forge.invalid', role: 'counselor', level: 'Basic' })).status, 400, 'an unknown level is refused, not widened to full');
  assert.equal((await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'invite', email: 'x@forge.invalid', role: 'teacher' })).status, 400);
  const a = await (await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'invite', email: 'cf@forge.invalid', role: 'counselor' })).json();
  const b = await (await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'invite', email: 'cb@forge.invalid', role: 'counselor', level: 'basic' })).json();
  await acceptPost(full.cookie, tokenOf(a.url));
  await acceptPost(basic.cookie, tokenOf(b.url));
  const idOf = async (c) => (await (await call(parentList.GET, '/api/parent', c.cookie)).json()).data.students[0].id;
  const fid = await idOf(full), bid = await idOf(basic);
  const post = (c, id, body) => call(parentOne.POST, `/api/parent/${id}`, c.cookie, body, 'POST', { ctx: { params: Promise.resolve({ id }) } });
  await post(full, fid, { action: 'note', body: 'Quoting your draft: Synthetic draft text' });
  const mine = await (await post(basic, bid, { action: 'note', body: 'General reminder' })).json();
  assert.deepEqual(mine.data.notes.map((n) => n.body), ['General reminder'], 'a basic counselor does not see a full counselor\'s note');
  const fullView = await (await post(full, fid, { action: 'note', body: 'Second' })).json();
  assert.equal(fullView.data.notes.length, 3, 'a full counselor sees all counselor notes');

  // The student's own patch path can't make a note look like a counselor's.
  await call(workspaceRoute.POST, '/api/workspace', student.cookie, { action: 'patch', patch: { advisorNote: { body: 'Forged', author: 'Casey', via: 'counselor', byLink: fid } } });
  const ws = await (await call(workspaceRoute.GET, '/api/workspace', student.cookie)).json();
  const forged = (ws.data || ws).advisorNotes.find((n) => n.body === 'Forged');
  assert.ok(forged, 'the patch landed');
  assert.ok(forged.via !== 'counselor' && !forged.byLink, 'provenance comes only from server routes');
});

test('changing a pending invite to another role respects that role\'s cap', async () => {
  const student = await cookieFor({ ...STUDENT, sub: 'test-student-cap' });
  for (const n of [1, 2, 3]) {
    const r = await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'invite', email: `c${n}cap@forge.invalid`, role: 'counselor' });
    assert.equal(r.status, 200);
  }
  await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'invite', email: 'pcap@forge.invalid' });
  const r = await call(parentsRoute.POST, '/api/parents', student.cookie, { action: 'invite', email: 'pcap@forge.invalid', role: 'counselor' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /up to 3 counselors/);
});
