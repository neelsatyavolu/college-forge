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

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-that-is-long-enough-1234';
process.env.PORTAL_LOGINS_KEY = process.env.PORTAL_LOGINS_KEY || crypto.randomBytes(32).toString('base64');
process.env.FORGE_SERVICE_KEY = 'svc-test-key';

const { NextRequest } = require('next/server');
const letter = require('../lib/decision-letter.ts');
const letters = require('../lib/decision-letters.ts');
const tracker = require('../lib/tracker.ts');
const session = require('../lib/session.ts');
const service = require('../lib/tracker-service.ts');
const store = require('../lib/store.ts');
const { runChecks } = require('../lib/portal-check.ts');
const { composeEmail, pushBody } = require('../lib/notify/changes.ts');
const appsRoute = require('../app/api/applications/route.ts');

async function isolated(run) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-letters-'));
  const prev = process.env.CF_DATA_DIR, blob = process.env.BLOB_READ_WRITE_TOKEN, realFetch = globalThis.fetch;
  process.env.CF_DATA_DIR = dir;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try { await run(dir); } finally {
    globalThis.fetch = realFetch;
    if (prev === undefined) delete process.env.CF_DATA_DIR; else process.env.CF_DATA_DIR = prev;
    if (blob !== undefined) process.env.BLOB_READ_WRITE_TOKEN = blob;
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

const ADMIT = 'Dear Sam, Congratulations! I am delighted to offer you admission to the Class of 2031. You have been selected for the Presidential Scholarship of $25,000 per year, renewable for four years. Your estimated aid package, including a $5,500 Federal Direct Loan, is in the portal.';

// ── Outcome ────────────────────────────────────────────────────────────────

test('classifyOutcome reads admits, denials, waitlists and deferrals, negatives first', () => {
  assert.equal(letter.classifyOutcome(ADMIT), 'admitted');
  assert.equal(letter.classifyOutcome('Admitted'), 'admitted');
  assert.equal(letter.classifyOutcome('Not admitted'), 'denied');
  assert.equal(letter.classifyOutcome('After careful review, we are not able to offer you admission this year.'), 'denied');
  assert.equal(letter.classifyOutcome('We regret to inform you that we cannot offer you a place in the class, nor a place on our waitlist.'), 'denied');
  assert.equal(letter.classifyOutcome('We are unable to offer you admission at this time, but we have placed you on our waitlist.'), 'waitlisted');
  assert.equal(letter.classifyOutcome('Waitlisted'), 'waitlisted');
  assert.equal(letter.classifyOutcome('Your application will be reconsidered with the Regular Decision pool.'), 'deferred');
  assert.equal(letter.classifyOutcome('We have deferred your application to Regular Decision.'), 'deferred');
  assert.equal(letter.classifyOutcome('Congratulations, you are admitted! If you wish to request deferred enrollment for a gap year, write to us.'), 'admitted');
  assert.equal(letter.classifyOutcome('Congratulations on submitting your application!'), '');
  assert.equal(letter.classifyOutcome('Decision Released'), '');
  assert.equal(letter.classifyOutcome(''), '');
  // An admit off the waitlist, and an admit that turns down a scholarship, are still admits.
  assert.equal(letter.classifyOutcome('We are pleased to offer you admission from our waitlist.'), 'admitted');
  assert.equal(letter.classifyOutcome('You are admitted. We are unable to offer you a scholarship this year.'), 'admitted');
  // Conflicting wording is unclear, so reveal records nothing.
  assert.equal(letter.classifyOutcome('Congratulations, you are admitted to the university. We are unable to offer you a place in the Honors College.'), '');
});

test('findAwards finds merit awards and leaves need-based estimates out', () => {
  assert.deepEqual(letter.findAwards(ADMIT), [{ name: 'Presidential Scholarship', amount: '$25,000', period: 'per year' }]);
  const full = letter.findAwards('We are pleased to name you a recipient of the Stamps Merit Scholarship, which covers full tuition.');
  assert.equal(full.length, 1);
  assert.equal(full[0].amount, 'Full tuition');
  assert.match(full[0].name, /Stamps Merit Scholarship$/);
  assert.deepEqual(letter.findAwards('Your estimated need-based grant is $12,000. Your net price is $18,000.'), []);
  assert.deepEqual(letter.findAwards('You were admitted. Pell Grant eligibility is $7,395.'), []);
  assert.deepEqual(letter.findAwards('Learn about scholarships on our website.'), []);
  assert.deepEqual(letter.findAwards('We invite you to apply for the Presidential Scholarship of $25,000.'), [], 'an invitation is not an award');
  assert.deepEqual(letter.findAwards('You were not selected for the Dean’s Award of $5,000.'), []);
});

test('inline styles lose every way to load something', () => {
  const clean = letter.sanitizeLetterHtml('<p style="color:blue;background:\\75 rl(https://x.test/a);background-image:image-set(\'https://x.test/b\' 1x)">Hi</p>');
  assert.match(clean, /style="color:blue"/);
  assert.doesNotMatch(clean, /x\.test|image-set|\\75/);
});

test('sanitizeLetterHtml strips scripts, handlers, frames, forms, remote images and unsafe links', () => {
  const dirty = `<html><head><style>body{background:url(https://evil.test/x)}</style><script>alert(1)</script></head><body>
    <p onclick="alert(1)" style="color:red;background:url(https://evil.test/t.png)">Congratulations!</p>
    <img src="https://evil.test/track.gif" onerror="alert(1)"><img src="data:image/png;base64,iVBORw0KGgo=" alt="crest">
    <a href="javascript:alert(1)">bad</a><a href="https://school.edu/next">next</a>
    <iframe src="https://evil.test"></iframe><form action="https://evil.test"><input name="pw"></form>
    <svg><script>alert(1)</script></svg><custom-el>kept text</custom-el><!-- comment --></body></html>`;
  const clean = letter.sanitizeLetterHtml(dirty);
  assert.doesNotMatch(clean, /script|onclick|onerror|iframe|<form|<input|evil\.test|javascript:|<svg|comment|<custom/i);
  assert.match(clean, /Congratulations!/);
  assert.match(clean, /style="color:red"/);
  assert.match(clean, /src="data:image\/png;base64,/);
  assert.match(clean, /href="https:\/\/school\.edu\/next"/);
  assert.match(clean, /kept text/);
  assert.equal(letter.sanitizeLetterHtml('<script>x</script>'), '');
});

test('cleanLetter validates what the Worker sends and caps it', () => {
  assert.equal(letter.cleanLetter(null), null);
  assert.equal(letter.cleanLetter({}), null);
  assert.deepEqual(letter.cleanLetter({ text: '  You are   admitted. ' }), { kind: 'text', text: 'You are admitted.' });
  const html = letter.cleanLetter({ html: '<p>You are <b>admitted</b>.</p><script>x()</script>' });
  assert.equal(html.kind, 'html');
  assert.equal(html.text, 'You are admitted.');
  assert.doesNotMatch(html.html, /script/);
  const pdf = letter.cleanLetter({ pdfBase64: Buffer.from('%PDF-1.7 test').toString('base64'), text: 'Admitted' });
  assert.equal(pdf.kind, 'pdf');
  // Not a PDF, or too large: dropped, falling back to text.
  assert.equal(letter.cleanLetter({ pdfBase64: Buffer.from('<html>').toString('base64'), text: 'x' }).kind, 'text');
  assert.equal(letter.cleanLetter({ pdfBase64: 'JVBER' + 'A'.repeat(8 * 1024 * 1024), text: 'x' }).kind, 'text');
  assert.equal(letter.cleanLetter({ text: 'a'.repeat(80_000) }).text.length, 50_000);
  assert.match(letter.letterKey('Admitted|View Update'), /^[a-f0-9]{32}$/);
});

// ── Tracker rules ──────────────────────────────────────────────────────────

test('withResult never stores a letter in the portal result', () => {
  const app = tracker.newApp({ name: 'Purdue University' }, 1000);
  const next = tracker.withResult(app, { checkedAt: 2000, ok: true, error: '', statusText: 'Decision Released', checklist: [], update: 'View Update', letter: { text: 'Admitted' } });
  assert.equal(next.portal.letter, undefined);
  const failed = tracker.withResult(tracker.newApp({ name: 'Purdue University' }, 1000), { checkedAt: 2000, ok: false, error: 'x', statusText: '', checklist: [], update: '', letter: { text: 'x' } });
  assert.equal(failed.portal.letter, undefined);
});

// ── Service, route and checks ──────────────────────────────────────────────

function stubPortal(snapshot) {
  const portal = { snapshot };
  globalThis.fetch = async (url) => {
    if (String(url) === 'https://collegeapps.n3el.dev/api/service/check') return new Response(JSON.stringify({ snapshot: portal.snapshot }), { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  };
  return portal;
}

async function owned(sub = 'xa_LETTER') {
  const account = await session.signInAccount({ sub, email: `${sub}@example.com`, name: 'Stu' }, null);
  const a = await service.addApp(account.workspaceId, { name: 'Purdue University', status: 'complete' });
  await service.setLogin(account.workspaceId, a.id, { username: 'u', password: 'p' });
  const cookie = `forge_session=${session.signSession({ sub, workspaceId: account.workspaceId, email: `${sub}@example.com`, name: 'Stu' })}`;
  const post = async (body) => {
    const res = await appsRoute.POST(new NextRequest('http://localhost/api/applications', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };
  return { ws: account.workspaceId, id: a.id, post };
}

const DECISION = { statusText: 'Decision Released', update: 'View Update', checklist: [] };

test('a captured letter stays hidden until reveal, then shows with its result and awards', () => isolated(async (dir) => {
  stubPortal({ ...DECISION, letter: { html: `<p>${ADMIT}</p><script>steal()</script>` } });
  const { ws, id, post } = await owned();
  await runChecks(ws, { appIds: [id] });
  const raw = (await store.getWorkspace(ws)).tracker.apps.find((a) => a.id === id);
  assert.equal(raw.portal.letter, undefined, 'the letter body is never in the workspace');
  assert.equal(raw.letters.length, 1);
  assert.doesNotMatch(JSON.stringify(await store.getWorkspace(ws)), /delighted/, 'only metadata is in the workspace');
  // On disk the letter is sealed.
  const files = fs.readdirSync(path.join(dir, 'letters', ws));
  assert.equal(files.length, 1);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'letters', ws, files[0]), 'utf8'), /Presidential|delighted/);

  const before = service.viewApp(raw);
  assert.equal(before.decision.state, 'hidden');
  assert.equal(before.decision.result, undefined);
  assert.equal(before.letter, null);
  assert.deepEqual(before.letterHistory, []);
  assert.equal((await post({ action: 'letter', id })).status, 400, 'no letter before reveal');
  assert.equal((await post({ action: 'award-add', id, index: 0 })).status, 400, 'no award before reveal');
  // Share views and the browser's raw workspace never carry letter metadata.
  assert.doesNotMatch(JSON.stringify(store.redactTracker((await store.getWorkspace(ws)).tracker)), /Presidential|letters/);

  const revealed = await post({ action: 'reveal', id });
  assert.equal(revealed.body.app.decision.state, 'revealed');
  assert.equal(revealed.body.app.decision.result, 'admitted');
  assert.equal(revealed.body.app.status, 'admitted', 'reveal records the outcome');
  assert.equal(revealed.body.app.letter.kind, 'html');
  assert.deepEqual(revealed.body.app.letter.awards, [{ name: 'Presidential Scholarship', amount: '$25,000', period: 'per year' }]);
  const share = service.shareTracker((await store.getWorkspace(ws)).tracker);
  assert.doesNotMatch(JSON.stringify(share), /Presidential|\$25,000|letter/i, 'parents and counselors never see letters or awards');

  const read = await post({ action: 'letter', id });
  assert.equal(read.status, 200);
  assert.equal(read.body.letter.kind, 'html');
  assert.match(read.body.letter.html, /delighted/);
  assert.doesNotMatch(read.body.letter.html, /script/);

  const award = await post({ action: 'award-add', id, index: 0 });
  assert.equal(award.status, 200);
  assert.equal(award.body.scholarship.status, 'won');
  assert.equal(award.body.scholarship.kind, 'school');
  assert.equal(award.body.scholarship.amount, '$25,000 per year');
  await post({ action: 'award-add', id, index: 0 });
  assert.equal((await store.getWorkspace(ws)).scholarships.length, 1, 'adding an award twice keeps one');
  assert.equal((await post({ action: 'award-add', id, index: 3 })).status, 400);

  // Another workspace can't read it.
  const other = await owned('xa_OTHER');
  assert.equal((await other.post({ action: 'letter', id })).status, 400);

  await service.removeApp(ws, id);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'letters', ws)), [], 'removing the school deletes its letters');
}));

test('reveal records the outcome only while the application is pending', () => isolated(async () => {
  stubPortal({ statusText: 'Waitlisted', update: 'View Update', checklist: [] });
  const { ws, id } = await owned('xa_PENDING');
  await runChecks(ws, { appIds: [id] });
  await service.updateApp(ws, id, { status: 'withdrawn' });
  const v = await service.reveal(ws, id);
  assert.equal(v.status, 'withdrawn');
  assert.equal(v.decision.result, 'waitlisted', 'no letter: the result comes from the portal words');
  assert.equal(v.letter, null);
}));

test('a letter from an older decision never attaches to a newer one', () => isolated(async () => {
  const portal = stubPortal({ ...DECISION, letter: { text: 'We have deferred your application to Regular Decision.' } });
  const { ws, id } = await owned('xa_STALE');
  await runChecks(ws, { appIds: [id] });
  await service.reveal(ws, id);
  portal.snapshot = { statusText: 'Admitted', update: 'View Update', checklist: [] };
  await runChecks(ws, { appIds: [id] });
  const app = (await store.getWorkspace(ws)).tracker.apps.find((a) => a.id === id);
  const hidden = service.viewApp(app);
  assert.equal(hidden.decision.state, 'hidden');
  assert.equal(hidden.letter, null);
  assert.equal(hidden.letterHistory.length, 1, 'the earlier, opened deferral letter stays readable');
  assert.equal(hidden.letterHistory[0].result, 'deferred');
  const after = await service.reveal(ws, id);
  assert.equal(after.status, 'admitted', 'a deferred application records the new outcome');
  assert.equal(after.letter, null);
  const old = await service.getLetter(ws, id, hidden.letterHistory[0].id);
  assert.match(old.text, /deferred/);
}));

test('a later letter never replaces one already saved, a late letter counts as seen, and a second reveal changes nothing', () => isolated(async () => {
  const portal = stubPortal({ ...DECISION });
  const { ws, id } = await owned('xa_LATE');
  await runChecks(ws, { appIds: [id] });
  const first = await service.reveal(ws, id);
  assert.equal(first.letter, null, 'revealed before any letter was captured');
  portal.snapshot = { ...DECISION, letter: { text: 'We have deferred your application to Regular Decision.' } };
  await runChecks(ws, { appIds: [id] });
  const raw = (await store.getWorkspace(ws)).tracker.apps.find((a) => a.id === id);
  assert.equal(raw.letters[0].seen, true, 'the decision was already open');
  portal.snapshot = { ...DECISION, letter: { text: 'Congratulations! You have been admitted.' } };
  await runChecks(ws, { appIds: [id] });
  assert.match((await service.getLetter(ws, id)).text, /deferred/, 'the first letter for a decision is kept');
  await service.updateApp(ws, id, { status: 'waitlisted' });
  assert.equal((await service.reveal(ws, id)).status, 'waitlisted', 'reveal again keeps the student’s correction');
}));

test('the JSON export carries no letter metadata or covered decision', () => isolated(async () => {
  stubPortal({ ...DECISION, letter: { text: ADMIT } });
  const { ws, id } = await owned('xa_EXPORT');
  await runChecks(ws, { appIds: [id] });
  const exportRoute = require('../app/api/workspace/export/route.ts');
  const cookie = `forge_session=${session.signSession({ sub: 'xa_EXPORT', workspaceId: ws, email: 'xa_EXPORT@example.com', name: 'Stu' })}`;
  const res = await exportRoute.GET(new NextRequest('http://localhost/api/workspace/export?format=json', { headers: { cookie } }));
  const text = await res.text();
  assert.match(text, /Purdue/);
  assert.doesNotMatch(text, /Presidential|"letters"|Decision Released/);
}));

test('workspace reset deletes every letter',() => isolated(async (dir) => {
  await letters.saveLetter('ws-reset-1', 'app-1', 'a'.repeat(32), { kind: 'text', text: 'x', capturedAt: 1 });
  await letters.saveLetter('ws-reset-1', 'app-2', 'b'.repeat(32), { kind: 'text', text: 'y', capturedAt: 1 });
  await letters.deleteLetters('ws-reset-1', 'app-1');
  assert.equal(fs.readdirSync(path.join(dir, 'letters', 'ws-reset-1')).length, 1);
  assert.equal((await letters.readLetter('ws-reset-1', 'app-2', 'b'.repeat(32))).text, 'y');
  await letters.deleteLetters('ws-reset-1');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'letters', 'ws-reset-1')), []);
}));

test('decision emails and pushes send the student to Forge without naming the outcome', () => {
  const email = composeEmail('Purdue University', [{ kind: 'decision' }], 'https://forge.test', { unsubscribeUrl: 'https://forge.test/u' });
  assert.match(email.html, /href="https:\/\/forge\.test\/hub\/index\.html#decisions"/);
  assert.match(email.text, /Open Forge to see it/);
  assert.doesNotMatch(email.html + email.text + email.subject, /admit|denied|waitlist|defer/i);
  assert.equal(pushBody([{ kind: 'decision' }]), 'Decision received. Open Forge to see it.');
});

// ── Letter blobs never outlive their record ──────────────────────────────────

const letterFiles = (dir, ws) => {
  try { return fs.readdirSync(path.join(dir, 'letters', ws)); } catch { return []; }
};

test('a letter captured for a school removed mid-check is not left behind', () => isolated(async (dir) => {
  const { ws, id } = await owned('xa_ORPHAN');
  globalThis.fetch = async (url) => {
    if (String(url) !== 'https://collegeapps.n3el.dev/api/service/check') throw new Error(`unexpected fetch ${url}`);
    await service.removeApp(ws, id);
    return new Response(JSON.stringify({ snapshot: { ...DECISION, letter: { text: ADMIT } } }), { status: 200 });
  };
  await runChecks(ws, { appIds: [id] });
  assert.equal((await store.getWorkspace(ws)).tracker.apps.length, 0);
  assert.deepEqual(letterFiles(dir, ws), [], 'no sealed letter without a record');
}));

test('letters past the last 10 lose their sealed body too', () => isolated(async (dir) => {
  const portal = stubPortal({ ...DECISION });
  const { ws, id } = await owned('xa_TRIM');
  for (let i = 0; i < 11; i++) {
    portal.snapshot = { statusText: 'Decision Released', update: `View Update ${i}`, checklist: [], letter: { text: `Letter number ${i}` } };
    await runChecks(ws, { appIds: [id] });
  }
  const kept = (await store.getWorkspace(ws)).tracker.apps.find((a) => a.id === id).letters;
  assert.equal(kept.length, 10);
  const files = letterFiles(dir, ws).sort();
  assert.deepEqual(files, kept.map((l) => `${id}.${l.id}.json`).sort(), 'only the kept letters have bodies');
}));

test('letter ids are keyed with the server secret, stay deterministic, and old ids still read and dedupe', () => isolated(async () => {
  const decisionKey = 'Decision Released|View Update';
  const legacy = crypto.createHash('sha256').update(decisionKey).digest('hex').slice(0, 32);
  const keyed = crypto.createHmac('sha256', Buffer.from(process.env.PORTAL_LOGINS_KEY, 'base64')).update(`forge-letter-id:${decisionKey}`).digest('hex').slice(0, 32);
  assert.equal(letter.letterKey(decisionKey), keyed);
  assert.notEqual(letter.letterKey(decisionKey), legacy, 'not guessable from the portal words alone');
  assert.equal(letter.letterKey(decisionKey), letter.letterKey(decisionKey));

  const portal = stubPortal({ ...DECISION });
  const { ws, id } = await owned('xa_LEGACY');
  await runChecks(ws, { appIds: [id] });
  // A letter saved before keyed ids, under the old unsalted id.
  await letters.saveLetter(ws, id, legacy, { kind: 'text', text: 'Old deferral letter', capturedAt: 1 });
  await store.updateWorkspace(ws, (cur) => ({
    ...cur,
    tracker: tracker.replaceApp(cur.tracker, tracker.withLetter(cur.tracker.apps.find((a) => a.id === id), { id: legacy, decisionKey, capturedAt: 1, kind: 'text', result: 'deferred', awards: [], seen: false })),
  }));
  portal.snapshot = { ...DECISION, letter: { text: ADMIT } };
  await runChecks(ws, { appIds: [id] });
  const app = (await store.getWorkspace(ws)).tracker.apps.find((a) => a.id === id);
  assert.deepEqual(app.letters.map((l) => l.id), [legacy], 'the same decision keeps its first letter');
  await service.reveal(ws, id);
  assert.match((await service.getLetter(ws, id)).text, /Old deferral/, 'an old id still reads');
}));
