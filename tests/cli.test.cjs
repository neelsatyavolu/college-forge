const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true } }).outputText, file);

const { parseArgs } = require('../cli/args.ts');
const { findSchool, detailText, listText, credsText } = require('../cli/format.ts');
const { readSession, saveSession, clearSession, sessionPath } = require('../cli/session.ts');
const { itemTemplate, saveTo1Password } = require('../cli/onepassword.ts');
const { authorizeUrl } = require('../cli/oauth.ts');

const school = (over = {}) => ({
  school: 'Purdue University', id: 'a1', status: 'submitted', status_label: 'Submitted', round: 'EA', deadline: '2026-11-01',
  decision_date: null, next: 'decision 2027-01-15 (estimated)', decision: 'none yet',
  portal: { checked_at: '2026-11-16T12:00:00.000Z', ok: true, says: 'Awaiting materials', error: null, missing_items: ['Transcript'], last_check_failed: null },
  submitted: null, follow_ups: [], portal_link: 'https://apply.purdue.edu/apply/status', portal_login_saved: true, notes: null, ...over,
});

test('splits the command, positionals and flags', () => {
  assert.deepEqual(parseArgs(['show', 'purdue', '--json']), { command: 'show', positionals: ['purdue'], flags: { json: true } });
  assert.deepEqual(parseArgs(['1password', '--vault', 'Personal', '--dry-run']).flags, { vault: 'Personal', 'dry-run': true });
  assert.equal(parseArgs([]).command, 'help');
});

test('finds a school by id or a unique part of its name, and refuses ambiguity', () => {
  const list = [school(), school({ id: 'a2', school: 'University of Michigan' }), school({ id: 'a3', school: 'Michigan State University' })];
  assert.equal(findSchool(list, 'purdue').id, 'a1');
  assert.equal(findSchool(list, 'a2').id, 'a2');
  assert.throws(() => findSchool(list, 'michigan'), /more than one/);
  assert.throws(() => findSchool(list, 'yale'), /No school matches/);
});

test('list and show print status and missing items, never a hidden decision', () => {
  const hidden = school({ decision: "A decision is posted in the portal but the student hasn't opened it." });
  assert.match(listText([school()]), /Purdue University\s+Submitted\s+EA/);
  assert.match(detailText(school()), /Missing:\s+Transcript/);
  assert.match(detailText(hidden), /Decision received/);
});

test('creds prints the login for one school', () => {
  const text = credsText(school(), { username: 'stu', password: 'pw-123', portalUrl: 'https://apply.purdue.edu/apply/status' });
  assert.match(text, /username: stu/);
  assert.match(text, /password: pw-123/);
  assert.match(credsText(school(), undefined), /no saved login/);
});

test('the session file is private to the user and round-trips', async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cf-cli-'));
  const env = { COLLEGEFORGE_CONFIG_DIR: dir };
  const s = { url: 'https://forge.xanom.co', clientId: 'fc_x', accessToken: 'a'.repeat(30), refreshToken: 'r'.repeat(30), expiresAt: 1 };
  await saveSession(s, env);
  assert.equal((await fs.promises.stat(sessionPath(env))).mode & 0o777, 0o600);
  assert.deepEqual(await readSession(env), s);
  await clearSession(env);
  assert.equal(await readSession(env), null);
  await fs.promises.rm(dir, { recursive: true, force: true });
});

test('sign-in asks for the logins scope on a loopback address with PKCE', () => {
  const u = new URL(authorizeUrl('https://forge.xanom.co', 'fc_x', 'http://127.0.0.1:5555/callback', 'c'.repeat(43), 'st'));
  assert.equal(u.pathname, '/oauth/authorize');
  assert.equal(u.searchParams.get('scope'), 'applications logins');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:5555/callback');
});

test('1Password items come from a template file, never with the password in the arguments', async () => {
  const picked = [{ school: 'Purdue University', portalUrl: 'https://apply.purdue.edu/apply/status', username: 'stu', password: 'pw-123' }];
  const calls = [];
  const op = async (args, template) => {
    calls.push({ args, template });
    return args[1] === 'list' ? { code: 0, stdout: '[]', stderr: '' } : { code: 0, stdout: '{}', stderr: '' };
  };
  const report = await saveTo1Password(picked, {}, op);
  assert.equal(report.created.length, 1);
  for (const c of calls) assert.ok(!c.args.join(' ').includes('pw-123'));
  assert.equal(JSON.parse(calls[1].template).fields.find((f) => f.id === 'password').value, 'pw-123');
  assert.deepEqual(itemTemplate(picked[0]).tags, ['collegeforge']);
});

test('a login already in 1Password (from College Apps or Forge) is skipped', async () => {
  const picked = [{ school: 'Purdue University', portalUrl: 'https://apply.purdue.edu/apply/status', username: 'stu', password: 'pw' }];
  const op = async (args) => args[1] === 'list'
    ? { code: 0, stdout: JSON.stringify([{ urls: [{ href: 'https://apply.purdue.edu/x' }], additional_information: 'stu' }]), stderr: '' }
    : { code: 0, stdout: '{}', stderr: '' };
  const report = await saveTo1Password(picked, {}, op);
  assert.equal(report.skipped.length, 1);
});
