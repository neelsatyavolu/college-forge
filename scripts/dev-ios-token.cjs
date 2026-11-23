#!/usr/bin/env node
/**
 * LOCAL DEVELOPMENT ONLY. Creates a synthetic student (fake name, fake data) in the local data/ store and
 * prints an OAuth access token for the iPhone app, so the simulator can run against `npm run dev` with
 * `-ForgeBaseURL http://localhost:3000 -ForgeDevToken <token>`.
 *
 *   CF_DATA_DIR=data node scripts/dev-ios-token.cjs [name]
 *
 * Refuses to run against Vercel Blob (production storage).
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const ts = require('typescript');

if (process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('Refusing: BLOB_READ_WRITE_TOKEN is set, so this would write to real storage. Unset it for local dev.');
  process.exit(1);
}

require.extensions['.ts'] = (mod, file) =>
  mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  return resolve.call(this, request.startsWith('@/') ? path.join(__dirname, '..', request.slice(2)) + '.ts' : request, ...args);
};

const session = require('../lib/session.ts');
const store = require('../lib/store.ts');
const service = require('../lib/tracker-service.ts');
const oauth = require('../lib/oauth.ts');

const REDIRECT = 'collegeforge://oauth/callback';
const SUB = 'xa_devios_' + (process.argv[2] || 'demo').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30);

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const checklist = (items) => items.map(([item, done]) => ({ item, status: done ? 'Received' : 'Awaiting', date: done ? day(-5) : '', done, optional: false }));

/** [name, edit, portal snapshot or null] */
const SHORT = ['Purdue', 'Michigan', 'Georgia Tech', 'UW', 'UIUC', 'CMU'];
const APPS = [
  ['Purdue University', { status: 'submitted', round: 'EA', deadline: day(-20), decisionDate: day(40) }, { statusText: 'Application complete', update: '', items: [['Application', true], ['Transcript', true], ['SAT scores', true]] }],
  ['University of Michigan', { status: 'submitted', round: 'EA', deadline: day(-22) }, { statusText: 'Awaiting materials', update: '', items: [['Application', true], ['Transcript', true], ['Counselor recommendation', false]] }],
  ['Georgia Institute of Technology', { status: 'complete', round: 'EA', deadline: day(-35) }, { statusText: 'Decision available', update: 'View Update', items: [['Application', true], ['Transcript', true]] }],
  ['University of Washington', { status: 'final_checks', round: 'RD', deadline: day(9), notes: 'Short answer still needs a trim.' }, null],
  ['University of Illinois Urbana-Champaign', { status: 'in_progress', round: 'RD', deadline: day(38) }, null],
  ['Carnegie Mellon University', { status: 'in_progress', round: 'RD', deadline: day(38) }, null],
  ['University of Wisconsin-Madison', { status: 'admitted', round: 'EA', deadline: day(-50), decisionNote: 'Honors program invite' }, null],
  ['Rice University', { status: 'deferred', round: 'ED', deadline: day(-60) }, null],
  ['Arizona State University', { status: 'committed', round: 'Rolling', deadline: day(-80) }, null],
  ['Northeastern University', { status: 'planning', round: 'RD', deadline: day(45) }, null],
];

async function seed(workspaceId) {
  await store.updateWorkspace(workspaceId, (ws) => ({
    ...ws,
    applicant: { ...ws.applicant, name: 'Sample Student', cycle: '2026-27', year: 'Senior', gpaWeighted: '4.21', gpaUnweighted: '3.86', sat: '1480', satNote: 'Superscore', awards: 3 },
    profile: {
      ...ws.profile,
      intended: 'Computer Science', hs: 'Example High School', gradYear: 2027, location: 'Springfield, IL', counselor: 'Counselor (synthetic)', residency: 'In-state',
      testing: { sat: '1480', satNote: 'Superscore', aps: [] },
      activities: [
        { rank: 1, name: 'Robotics team', type: 'Robotics', role: 'Software lead', years: '9-12', hpw: '8', wpy: '30', desc: 'Wrote the autonomous routines.' },
        { rank: 2, name: 'Math tutoring', type: 'Community service', role: 'Tutor', years: '10-12', hpw: '3', wpy: '35', desc: 'Free tutoring for middle schoolers.' },
      ],
      honors: [{ title: 'AP Scholar with Distinction', level: 'National', year: '11' }],
    },
    colleges: APPS.slice(0, 6).map(([name], i) => ({ slug: `demo-${i}`, name, short: SHORT[i], tier: i < 2 ? 'target' : i < 4 ? 'reach' : 'safety' })),
    essayDrafts: { ...ws.essayDrafts, 'ca-ps-1': 'The first robot I built could not drive in a straight line. (Synthetic draft for testing.)' },
    onboarding: { completed: true, completedAt: Date.now() },
  }));
  const ids = [];
  for (const [name, edit] of APPS) ids.push((await service.addApp(workspaceId, { name, ...edit })).id);
  await store.updateWorkspace(workspaceId, (ws) => ({
    ...ws,
    tracker: {
      ...ws.tracker,
      apps: ws.tracker.apps.map((app) => {
        const spec = APPS[ids.indexOf(app.id)];
        const snap = spec && spec[2];
        if (!snap) return app;
        return { ...app, lastChecked: Date.now() - 3600000, portal: { checkedAt: Date.now() - 3600000, ok: true, error: '', statusText: snap.statusText, update: snap.update, checklist: checklist(snap.items) } };
      }),
    },
  }));
}

async function mint(account) {
  const client = await oauth.registerClient({ client_name: 'Forge for iPhone (dev)', redirect_uris: [REDIRECT] });
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const code = await oauth.issueCode(client, REDIRECT, challenge, account.sub, account.workspaceId);
  return oauth.exchange(new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: client.client_id }));
}

(async () => {
  const account = await session.signInAccount({ sub: SUB, email: 'sample.student@example.com', name: 'Sample Student' }, null);
  const ws = await store.getWorkspace(account.workspaceId);
  if (!ws.tracker.apps.length) await seed(account.workspaceId);
  const tokens = await mint(account);
  console.error(`Synthetic account ${SUB}, workspace ${account.workspaceId}. Access token lasts 1 hour; refresh token below.`);
  console.error(`refresh_token: ${tokens.refresh_token}`);
  console.log(tokens.access_token);
})().catch((err) => {
  console.error('dev-ios-token failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
