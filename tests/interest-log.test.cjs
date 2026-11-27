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
const L = require('../lib/interest-log.ts');
const service = require('../lib/tracker-service.ts');
const session = require('../lib/session.ts');
const store = require('../lib/store.ts');
const { loadSchoolResearch } = require('../lib/school-research.ts');
const { exportCalendar } = require('../lib/export.ts');
const { callTool, toolList } = require('../lib/mcp-tools.ts');
const appsRoute = require('../app/api/applications/route.ts');

async function isolated(run) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-interest-'));
  const prev = process.env.CF_DATA_DIR, blob = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.CF_DATA_DIR = dir;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try { await run(dir); } finally {
    if (prev === undefined) delete process.env.CF_DATA_DIR; else process.env.CF_DATA_DIR = prev;
    if (blob !== undefined) process.env.BLOB_READ_WRITE_TOKEN = blob;
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

const TODAY = '2026-11-26';
const app = (over = {}) => ({ ...tracker.newApp({ name: 'Tulane University' }, 1000), ...over });
const research = (interest, interview) => ({
  facts: [
    ...(interest ? [{ key: 'demonstrated_interest', value: interest, sourceUrl: 'https://example.edu/cds' }] : []),
    ...(interview ? [{ key: 'interview', value: interview, sourceUrl: 'https://example.edu/interview' }] : []),
  ],
});

// ── Validation and immutability ─────────────────────────────────────────────

test('adding validates kind, date and time, and clips free text', () => {
  const a = app();
  assert.throws(() => L.addInterest(a, { kind: 'tour', date: TODAY }, TODAY), /Unknown kind/);
  assert.throws(() => L.addInterest(a, { kind: 'visit', date: '2026-02-30' }, TODAY), /real yyyy-mm-dd/);
  assert.throws(() => L.addInterest(a, { kind: 'visit', date: 'Nov 1' }, TODAY), /real yyyy-mm-dd/);
  assert.throws(() => L.addInterest(a, { kind: 'interview', date: TODAY, time: '25:00' }, TODAY), /HH:MM/);
  assert.throws(() => L.addInterest(a, { kind: 'visit' }, TODAY), /kind and the date/);
  const added = L.addInterest(a, { kind: 'visit', date: '2026-10-01', who: '  x'.repeat(200), notes: 'n'.repeat(5000), prep: 'p'.repeat(9000) }, TODAY);
  const e = added.interest[0];
  assert.equal(e.who.length, 120);
  assert.equal(e.notes.length, 1000);
  assert.equal(e.prep.length, 4000);
  assert.equal(e.done, true, 'a past visit counts as done');
  assert.equal('thankYouSent' in e, false, 'only interviews track thank-you notes');
});

test('helpers never mutate the application they are given', () => {
  const a = app();
  const frozen = JSON.stringify(a);
  const b = L.addInterest(a, { kind: 'interview', date: '2026-12-05', time: '15:30', who: 'Alum interviewer' }, TODAY, 2000);
  assert.equal(JSON.stringify(a), frozen);
  assert.notEqual(b, a);
  const snapshot = JSON.stringify(b);
  const id = b.interest[0].id;
  const c = L.setInterest(b, id, { done: true, thankYouSent: true }, 3000);
  assert.equal(JSON.stringify(b), snapshot);
  assert.equal(c.interest[0].thankYouSent, true);
  assert.equal(b.interest[0].thankYouSent, false);
  const d = L.setInterest(c, id, { remove: true });
  assert.equal(d.interest.length, 0);
  assert.equal(c.interest.length, 1);
  assert.throws(() => L.setInterest(c, 'nope', { done: true }), /No interest entry/);
});

test('an upcoming interview starts not done, and a school holds at most 50 entries', () => {
  const booked = L.addInterest(app(), { kind: 'interview', date: '2026-12-05' }, TODAY);
  assert.equal(booked.interest[0].done, false);
  assert.equal(booked.interest[0].thankYouSent, false);
  let full = app();
  for (let i = 0; i < L.MAX_INTEREST; i++) full = L.addInterest(full, { kind: 'email_opened', date: TODAY }, TODAY);
  assert.equal(full.interest.length, 50);
  assert.throws(() => L.addInterest(full, { kind: 'visit', date: TODAY }, TODAY), /Already 50/);
});

test('stored entries with a bad shape are ignored rather than trusted', () => {
  const a = app({ interest: [{ id: 'ok', kind: 'visit', date: '2026-10-01', done: true, createdAt: 1 }, { id: 'x', kind: 'hack', date: '2026-10-01' }, null, 'str'] });
  assert.deepEqual(L.interestOf(a).map((e) => e.id), ['ok']);
  assert.deepEqual(L.interestOf(app({ interest: 'nope' })), []);
});

// ── Policy parsing on real research strings ─────────────────────────────────

test('demonstrated-interest policy parses the sourced research files', () => {
  const di = (slug) => loadSchoolResearch(slug).facts.find((f) => f.key === 'demonstrated_interest').value;
  assert.equal(L.parseInterestPolicy(di('tulane-university-of-louisiana')), 'important');
  assert.equal(L.parseInterestPolicy(di('trinity-college')), 'important');
  assert.equal(L.parseInterestPolicy(di('union-college')), 'considered');
  assert.equal(L.parseInterestPolicy(di('yale-university')), 'not_considered');
  assert.equal(L.parseInterestPolicy(di('university-of-southern-california')), 'not_considered');
  assert.equal(L.parseInterestPolicy(di('california-institute-of-technology')), 'not_considered');
  assert.equal(L.parseInterestPolicy(di('washington-university-in-st-louis')), 'considered');
  // Another C7 row's rating in the same value doesn't leak in.
  assert.equal(L.parseInterestPolicy("Not considered (CDS 2025-26 C7 'Level of applicant's interest'; interview 'Considered')"), 'not_considered');
  assert.equal(L.parseInterestPolicy('Not rated: the CDS 2025-26 C7 row for level of applicant\'s interest is left blank'), 'unknown');
  assert.equal(L.parseInterestPolicy(''), 'unknown');
});

test('interview policy parses the sourced research files', () => {
  const iv = (slug) => loadSchoolResearch(slug).facts.find((f) => f.key === 'interview').value;
  assert.equal(L.parseInterviewPolicy(iv('yale-university')), 'by_invitation');
  assert.equal(L.parseInterviewPolicy(iv('georgetown-university')), 'by_invitation');
  assert.equal(L.parseInterviewPolicy(iv('union-college')), 'evaluative');
  assert.equal(L.parseInterviewPolicy(iv('trinity-college')), 'evaluative');
  assert.equal(L.parseInterviewPolicy(iv('university-of-southern-california')), 'not_offered');
  assert.equal(L.parseInterviewPolicy(iv('california-institute-of-technology')), 'not_offered');
  assert.equal(L.parseInterviewPolicy(iv('tulane-university-of-louisiana')), 'not_offered');
  assert.equal(L.parseInterviewPolicy('Optional informational alumni interview after applying; not evaluative'), 'informational');
  assert.equal(L.parseInterviewPolicy("Interview 'not considered' (CDS 2025-26 C7)"), 'not_offered');
  assert.equal(L.parseInterviewPolicy('Not required but strongly recommended; June-December of senior year'), 'evaluative');
  assert.equal(L.parseInterviewPolicy('No interviews offered; campus visits encouraged'), 'not_offered');
});

test('every research file parses to a known policy without throwing', () => {
  const dir = path.join(__dirname, '..', 'lib', 'school-research');
  let interest = 0, interview = 0;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json') && n !== 'manifest.json')) {
    const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const s = L.interestSignal(app(), r);
    if (s.counts !== 'unknown') interest++;
    if (s.interview !== 'unknown') interview++;
  }
  assert.ok(interest >= 140, `parsed interest for ${interest} schools`);
  assert.ok(interview >= 145, `parsed interviews for ${interview} schools`);
});

// ── Nudges ──────────────────────────────────────────────────────────────────

test('the nudge says when a school counts interest and nothing is logged', () => {
  const important = research('Important (CDS 2025-26 C7)', 'No interviews offered');
  const s = L.interestSignal(app(), important);
  assert.equal(s.counts, 'important');
  assert.equal(s.nudge, 'Counts interest as important; nothing logged yet.');
  assert.equal(s.countsFact.sourceUrl, 'https://example.edu/cds');
  assert.equal(L.interestSignal(app(), research('Considered (CDS 2025-26 C7)')).nudge, 'Counts interest; nothing logged yet.');
  const logged = L.addInterest(app(), { kind: 'info_session', date: '2026-10-01' }, TODAY);
  assert.equal(L.interestSignal(logged, important).nudge, undefined);
  assert.equal(L.interestSignal(app(), research('Not considered (CDS 2025-26 C7)')).nudge, undefined);
  assert.equal(L.interestSignal(app({ status: 'admitted' }), important).nudge, undefined, 'no nudge once decided');
  assert.equal(L.interestSignal(app(), null).counts, 'unknown');
});

test('evaluative interviews nudge while working, and a thank-you owed comes first', () => {
  const evaluative = research('Not considered', 'Optional and evaluative: not required, but interviews become part of the application');
  assert.equal(L.interestSignal(app(), evaluative).nudge, 'Interviews count here; none scheduled yet.');
  assert.equal(L.interestSignal(app({ status: 'submitted' }), evaluative).nudge, undefined);
  const done = L.addInterest(app(), { kind: 'interview', date: '2026-11-20' }, TODAY);
  const s = L.interestSignal(done, evaluative);
  assert.equal(s.thankYouOwed, 1);
  assert.equal(s.nudge, 'Send your interviewer a thank-you note.');
  const sent = L.setInterest(done, done.interest[0].id, { thankYouSent: true });
  assert.equal(L.interestSignal(sent, evaluative).nudge, undefined);
});

// ── Lists across schools ────────────────────────────────────────────────────

test('upcoming interviews sort by date and time; owed lists done interviews without a thank-you', () => {
  let a = app({ id: 'a1', name: 'Tulane University' });
  a = L.addInterest(a, { kind: 'interview', date: '2026-12-05', time: '16:00' }, TODAY);
  a = L.addInterest(a, { kind: 'interview', date: '2026-11-10' }, TODAY);
  a = L.addInterest(a, { kind: 'visit', date: '2026-12-01' }, TODAY);
  let b = { ...tracker.newApp({ name: 'Union College' }, 1000), id: 'b1' };
  b = L.addInterest(b, { kind: 'interview', date: '2026-12-05', time: '09:30' }, TODAY);
  const t = { ...tracker.emptyTracker(), apps: [a, b] };
  const up = L.upcomingInterviews(t, TODAY);
  assert.deepEqual(up.map((r) => `${r.school} ${r.event.date} ${r.event.time}`), ['Union College 2026-12-05 09:30', 'Tulane University 2026-12-05 16:00']);
  const owed = L.thankYousOwed(t);
  assert.deepEqual(owed.map((r) => r.event.date), ['2026-11-10']);
  assert.equal(L.calendarInterest(t, TODAY).length, 3, 'two interviews and the visit ahead');
});

test('the calendar export gives timed interviews a start time and an hour', () => {
  const ws = store.emptyWorkspace();
  let a = tracker.newApp({ name: 'Tulane University' }, 1000);
  const ahead = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  a = L.addInterest(a, { kind: 'interview', date: ahead, time: '15:30', who: 'Alum' }, tracker.todayIso());
  a = L.addInterest(a, { kind: 'visit', date: ahead }, tracker.todayIso());
  const text = exportCalendar({ ...ws, tracker: { ...ws.tracker, apps: [a] } }).text;
  const compact = ahead.replace(/-/g, '');
  assert.match(text, new RegExp(`DTSTART:${compact}T153000\\r\\nDURATION:PT1H`));
  assert.match(text, /Tulane University — interview with Alum/);
  assert.match(text, new RegExp(`DTSTART;VALUE=DATE:${compact}\\r\\nSUMMARY:Tulane University — campus visit`));
});

test('viewApp carries the log and signal; progress links do not', () => {
  const a = L.addInterest(app(), { kind: 'interview', date: '2026-12-05', notes: 'private' }, TODAY);
  const v = service.viewApp(a, TODAY, undefined, research('Important (CDS 2025-26 C7)'));
  assert.equal(v.interest.length, 1);
  assert.equal(v.interestSignal.counts, 'important');
  assert.equal(service.viewApp(a, TODAY).interestSignal.counts, 'important', 'curated Tulane research is the fallback');
  const shared = JSON.stringify(service.shareTracker({ ...tracker.emptyTracker(), apps: [a] }, TODAY));
  assert.doesNotMatch(shared, /private/);
});

// ── API and tools ───────────────────────────────────────────────────────────

test('the applications API adds, edits and removes interest entries with validation', () => isolated(async () => {
  const cookie = `forge_session=${session.signSession({ sub: 'xa_INT', workspaceId: 'interest-ws-1', email: 'a@b.co', name: 'A' })}`;
  const post = (body) => appsRoute.POST(new NextRequest('http://localhost/api/applications', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  const added = await (await post({ action: 'add', name: 'Tulane University' })).json();
  const id = added.app.id;
  assert.equal((await post({ action: 'interest-add', id, kind: 'tour', date: '2026-12-01' })).status, 400);
  assert.equal((await post({ action: 'interest-add', id, kind: 'visit', date: '2026-12-01', time: '9am' })).status, 400);
  assert.equal((await post({ action: 'interest-add', id, kind: 'visit', date: '2026-02-30' })).status, 400);
  assert.equal((await post({ action: 'interest-add', id, kind: 'visit', date: '2026-12-01', notes: 'x'.repeat(1001) })).status, 400);
  const ok = await (await post({ action: 'interest-add', id, kind: 'interview', date: '2026-12-01', time: '10:00', who: 'Regional AO' })).json();
  assert.equal(ok.success, true);
  const ev = ok.app.interest[0];
  assert.equal(ev.who, 'Regional AO');
  assert.ok(ok.data.apps[0].interestSignal);
  const edited = await (await post({ action: 'interest-set', id, interestId: ev.id, done: true, thankYouSent: true })).json();
  assert.equal(edited.app.interest[0].thankYouSent, true);
  const missing = await post({ action: 'interest-set', id, interestId: 'nope', done: true });
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /No interest entry/);
  const removed = await (await post({ action: 'interest-set', id, interestId: ev.id, remove: true })).json();
  assert.equal(removed.app.interest.length, 0);
}));

test('MCP tools log interest, list it, and gather interview prep from the student\'s own material', () => isolated(async () => {
  const names = toolList().map((t) => t.name);
  for (const n of ['list_interest', 'log_interest', 'set_interest', 'interview_prep']) assert.ok(names.includes(n), n);
  const ws = 'interest-ws-2';
  await store.updateWorkspace(ws, (w) => ({
    ...w,
    colleges: [{ slug: 'tulane-university-of-louisiana', name: 'Tulane University', short: 'Tulane' }],
    essays: { ...w.essays, supplements: { 'tulane-university-of-louisiana': [{ id: 'tul-why', label: 'Why Tulane?', prompt: 'Why are you interested in Tulane?', limit: 250, unit: 'words' }] } },
    essayDrafts: { 'tul-why': 'I want to study coastal engineering in New Orleans.' },
    profile: { ...w.profile, intended: 'Civil engineering', activities: [{ rank: 1, name: 'Robotics', type: 'Academic', role: 'Captain', desc: 'Led a 20-person team' }] },
  }));
  await service.addApp(ws, { name: 'Tulane University', slug: 'tulane-university-of-louisiana' });
  const ahead = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  const logged = await callTool(ws, 'log_interest', { school: 'Tulane', kind: 'interview', date: ahead, time: '14:00', who: 'Alum' });
  assert.equal(logged.isError, undefined, JSON.stringify(logged));
  const listed = (await callTool(ws, 'list_interest', {})).structuredContent;
  assert.equal(listed.upcomingInterviews.length, 1);
  assert.equal(listed.schools[0].policy.counts, 'important');
  const entry = listed.upcomingInterviews[0].eventId;
  const prep = (await callTool(ws, 'interview_prep', { school: 'Tulane' })).structuredContent;
  assert.equal(prep.interview.id, entry);
  assert.equal(prep.why_us_drafts[0].draft, 'I want to study coastal engineering in New Orleans.');
  assert.equal(prep.activities[0].name, 'Robotics');
  assert.ok(prep.school_facts.every((f) => /^https:\/\//.test(f.source)));
  assert.match(prep.instructions, /never invent/);
  const saved = await callTool(ws, 'set_interest', { school: 'Tulane', entry_id: entry, prep: '1. Why Tulane? Coastal engineering.' });
  assert.equal(saved.structuredContent.events[0].prep, '1. Why Tulane? Coastal engineering.');
  const dates = JSON.stringify((await callTool(ws, 'upcoming_dates', { days: 30 })).structuredContent);
  assert.match(dates, /Tulane University interview at 14:00/);
  const bad = await callTool(ws, 'log_interest', { school: 'Tulane', kind: 'interview', date: 'soon' });
  assert.equal(bad.isError, true);
  const unknown = await callTool(ws, 'set_interest', { school: 'Tulane', entry_id: 'nope', done: true });
  assert.equal(unknown.isError, true);
  assert.match(unknown.content[0].text, /No interest entry/);
}));
