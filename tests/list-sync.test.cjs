const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ts = require('typescript');
const Module = require('node:module');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.join(__dirname, '..', request.slice(2)) + '.ts' : request, ...args); };
process.env.CF_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-list-sync-'));
delete process.env.BLOB_READ_WRITE_TOKEN;

const { emptyWorkspace, getWorkspace, updateWorkspace } = require('../lib/store.ts');
const { newApp } = require('../lib/tracker.ts');
const sync = require('../lib/list-sync.ts');
const { removeCollegeFrom, upsertCollegeInto } = require('../lib/colleges.ts');
const { rebalanceWorkspace } = require('../lib/college-recommendations.ts');

const ws = (over = {}) => ({ ...emptyWorkspace(), ...over });
const withApps = (w, apps) => ({ ...w, tracker: { ...w.tracker, apps } });
const college = (slug, name, over = {}) => ({ slug, name, short: name, ...over });

test('an application with no list school adds one with origin "user" and links it', () => {
  const app = newApp({ name: 'University of Michigan' });
  const out = sync.linkListAndApplications(withApps(ws(), [app]));
  assert.equal(out.colleges.length, 1);
  assert.equal(out.colleges[0].origin, 'user');
  assert.equal(out.colleges[0].slug, 'university-of-michigan-ann-arbor', 'U.S. News row for the catalog school');
  assert.equal(out.tracker.apps[0].slug, out.colleges[0].slug);
});

test('a kept list school gets a Not started application; a seed suggestion does not', () => {
  const out = sync.linkListAndApplications(ws({
    colleges: [college('rice-university', 'Rice University', { origin: 'user' }), college('tulane-university', 'Tulane University', { origin: 'seed' })],
  }));
  assert.equal(out.tracker.apps.length, 1);
  assert.equal(out.tracker.apps[0].slug, 'rice-university');
  assert.equal(out.tracker.apps[0].status, 'planning');
  const starred = sync.linkListAndApplications(ws({ colleges: [college('tulane-university', 'Tulane University', { origin: 'seed', priority: true })] }));
  assert.equal(starred.tracker.apps.length, 1, 'a starred suggestion counts as kept');
});

test('matching by catalog school or name does not duplicate', () => {
  const app = newApp({ name: 'UMich' });
  const out = sync.linkListAndApplications(withApps(ws({ colleges: [college('university-of-michigan-ann-arbor', 'University of Michigan-Ann Arbor')] }), [app]));
  assert.equal(out.colleges.length, 1);
  assert.equal(out.tracker.apps.length, 1);
  assert.equal(out.tracker.apps[0].slug, 'university-of-michigan-ann-arbor');
});

test('each UC campus maps one to one', () => {
  const apps = [newApp({ name: 'UC Davis' }), newApp({ name: 'UCLA' })];
  const out = sync.linkListAndApplications(withApps(ws({ colleges: [college('university-of-california-davis', 'University of California-Davis')] }), apps));
  assert.equal(out.colleges.length, 2);
  assert.equal(out.tracker.apps.length, 2);
  assert.deepEqual(new Set(out.tracker.apps.map((a) => a.slug)).size, 2);
  assert.equal(out.tracker.apps.find((a) => a.name === 'UC Davis').slug, 'university-of-california-davis');
});

test('running the sync twice gives the same result', () => {
  const once = sync.linkListAndApplications(withApps(ws({ colleges: [college('rice-university', 'Rice University')] }), [newApp({ name: 'Purdue University' })]));
  assert.equal(sync.linkListAndApplications(once), once);
  assert.equal(sync.syncListAndApplications(once, once), once);
});

test('removing a school with an untouched application removes both', () => {
  const before = sync.linkListAndApplications(ws({ colleges: [college('rice-university', 'Rice University')] }));
  const after = sync.syncListAndApplications(before, removeCollegeFrom(before, 'rice-university'));
  assert.equal(after.colleges.length, 0);
  assert.equal(after.tracker.apps.length, 0);
  const back = sync.syncListAndApplications(before, withApps(before, []));
  assert.equal(back.colleges.length, 0, 'removing an untouched application removes the list school');
});

test('removing a school with work in its application keeps the application off the list', () => {
  const linked = sync.linkListAndApplications(ws({ colleges: [college('rice-university', 'Rice University')] }));
  const before = withApps(linked, [{ ...linked.tracker.apps[0], status: 'submitted' }]);
  const after = sync.syncListAndApplications(before, removeCollegeFrom(before, 'rice-university'));
  assert.equal(after.colleges.length, 0);
  assert.equal(after.tracker.apps.length, 1);
  assert.equal(after.tracker.apps[0].offList, true);
  assert.equal(after.tracker.apps[0].slug, undefined);
  assert.equal(sync.linkListAndApplications(after), after, 'the school is not added back');
  // Adding the school again relinks the same application.
  const readded = sync.syncListAndApplications(after, upsertCollegeInto(after, college('rice-university', 'Rice University')));
  assert.equal(readded.tracker.apps.length, 1);
  assert.equal(readded.tracker.apps[0].offList, undefined);
  assert.equal(readded.tracker.apps[0].slug, 'rice-university');
});

test('removing an application with work in it keeps the list school without re-adding the application', () => {
  const linked = sync.linkListAndApplications(ws({ colleges: [college('rice-university', 'Rice University')] }));
  const before = withApps(linked, [{ ...linked.tracker.apps[0], notes: 'Interview Dec 2' }]);
  const after = sync.syncListAndApplications(before, withApps(before, []));
  assert.equal(after.colleges.length, 1);
  assert.equal(after.tracker.apps.length, 0);
  assert.deepEqual(after.noApplication, ['rice-university']);
  // Adding the application again clears the mark.
  const again = sync.syncListAndApplications(after, withApps(after, [newApp({ name: 'Rice University' })]));
  assert.equal(again.tracker.apps.length, 1);
  assert.equal(again.noApplication, undefined);
  // Removing the school drops the stale mark.
  assert.equal(sync.syncListAndApplications(after, removeCollegeFrom(after, 'rice-university')).noApplication, undefined);
});

test('a suggested school with an application becomes the student\'s and survives a rebalance', () => {
  const seed = college('rice-university', 'Rice University', { origin: 'seed', tier: 'reach' });
  const app = { ...newApp({ name: 'Rice University' }), status: 'submitted' };
  const out = sync.linkListAndApplications(withApps(ws({ colleges: [seed] }), [app]));
  assert.equal(out.colleges[0].origin, 'user');
  const rebalanced = rebalanceWorkspace(out).workspace;
  assert.ok(rebalanced.colleges.some((c) => c.slug === 'rice-university'));
  assert.equal(sync.syncListAndApplications(out, rebalanced).tracker.apps.length, 1);
});

test('the store backfills on read once, with stable ids, and fills Essays for import-only schools', async () => {
  const id = 'list-sync-store';
  const file = path.join(process.env.CF_DATA_DIR, 'workspaces', `${id}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // As after a College Apps import: applications only, no list schools.
  const raw = { ...emptyWorkspace(), tracker: { apps: [newApp({ name: 'Rice University' }), newApp({ name: 'Nowhere Test College' })], autocheck: true, emails: true, flags: [] } };
  fs.writeFileSync(file, JSON.stringify(raw));
  const first = await getWorkspace(id);
  const second = await getWorkspace(id);
  assert.equal(first.colleges.length, 2);
  assert.deepEqual(second.tracker.apps.map((a) => a.id), first.tracker.apps.map((a) => a.id));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).colleges.map((c) => c.slug), first.colleges.map((c) => c.slug), 'the backfill was saved');
  const rice = first.colleges.find((c) => /rice/.test(c.slug)).slug;
  assert.ok(first.essays.supplements[rice]?.length, 'Rice has an Essays group');
  assert.ok(!first.essays.supplements[rice].some((e) => /not loaded yet/.test(e.prompt)), 'with real prompts');
  assert.match(first.essays.supplements['nowhere-test-college'][0].prompt, /not loaded yet/, 'an unknown school gets placeholders');
});

test('every store write runs the cascade', async () => {
  const id = 'list-sync-writes';
  await updateWorkspace(id, (w) => ({ ...w, colleges: [college('rice-university', 'Rice University'), college('purdue-university', 'Purdue University')] }));
  let w = await getWorkspace(id);
  assert.equal(w.tracker.apps.length, 2);
  // iOS replaces the whole list.
  w = await updateWorkspace(id, (x) => ({ ...x, colleges: x.colleges.filter((c) => c.slug !== 'rice-university') }));
  assert.deepEqual(w.tracker.apps.map((a) => a.slug), ['purdue-university']);
});

test('a campus never claims another campus\'s application', () => {
  const annArbor = newApp({ name: 'University of Michigan' });
  const out = sync.linkListAndApplications(withApps(ws({ colleges: [college('university-of-michigan-dearborn', 'University of Michigan-Dearborn')] }), [annArbor]));
  assert.equal(out.colleges.length, 2, 'Ann Arbor gets its own row');
  assert.equal(out.tracker.apps.length, 2, 'Dearborn gets its own application');
  assert.notEqual(out.tracker.apps.find((a) => a.id === annArbor.id).slug, 'university-of-michigan-dearborn');
});

test('a school whose slug changed keeps its application', () => {
  const before = sync.linkListAndApplications(ws({ colleges: [college('rice', 'Rice University')] }));
  const app = before.tracker.apps[0];
  const after = sync.syncListAndApplications(before, { ...before, colleges: [college('rice-university', 'Rice University')] });
  assert.equal(after.tracker.apps.length, 1);
  assert.equal(after.tracker.apps[0].id, app.id);
  assert.equal(after.tracker.apps[0].slug, 'rice-university');
});

test('duplicate list rows do not get two applications', () => {
  const once = sync.linkListAndApplications(ws({ colleges: [college('rice-university', 'Rice University'), college('rice-university', 'Rice University')] }));
  assert.equal(once.tracker.apps.length, 1);
  assert.equal(sync.linkListAndApplications(once), once);
});

test('adding an application the list already made fills it in instead of dropping the details', async () => {
  const service = require('../lib/tracker-service.ts');
  const id = 'list-sync-fill';
  await updateWorkspace(id, (w) => ({ ...w, colleges: [college('rice-university', 'Rice University')] }));
  const placeholder = (await getWorkspace(id)).tracker.apps[0];
  const added = await service.addApp(id, { name: 'Rice University', status: 'submitted', notes: 'Sent Nov 1' });
  assert.equal(added.id, placeholder.id);
  assert.equal(added.status, 'submitted');
  assert.equal(added.notes, 'Sent Nov 1');
  // Work already saved is never overwritten by a later add.
  const again = await service.addApp(id, { name: 'Rice University', status: 'planning' });
  assert.equal(again.status, 'submitted');
});

test('parents never receive hidden essays or their drafts', () => {
  const { parentView } = require('../lib/parent-view.ts');
  const w = { ...emptyWorkspace(), commonAppPrompt: 'ca-ps-2', essayHidden: { 'rice-1': true }, essayDrafts: { 'ca-ps-1': 'secret', 'ca-ps-2': 'shown', 'rice-1': 'hidden' },
    essays: { commonApp: emptyWorkspace().essays.commonApp, supplements: { rice: [{ id: 'rice-1', label: 'Why', prompt: 'p', limit: 250, unit: 'words' }] } } };
  const view = parentView(w, 'full');
  assert.deepEqual(Object.keys(view.essayDrafts), ['ca-ps-2']);
  assert.ok(!view.essays.commonApp.some((e) => e.id === 'ca-ps-1'));
  assert.deepEqual(view.essays.supplements, {});
});
