const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  return resolve.call(this, request.startsWith('@/') ? path.join(__dirname, '..', request.slice(2)) + '.ts' : request, ...args);
};
const N = require('../lib/explore-notes.ts');
const C = require('../lib/explore-catalog.ts');

const info = (over = {}) => ({
  thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Hall.jpg/1280px-Hall.jpg?utm_source=x',
  width: 3000, height: 2000,
  extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a href="//x">Jane Doe</a>' } },
  ...over,
});

test('Commons photos: large, landscape, freely licensed campus shots only', async () => {
  const { commonsPhoto, commonsThumb } = await import('../scripts/explore/catalog.mjs');
  const ok = commonsPhoto(info(), 'https://commons.wikimedia.org/wiki/File:Hall.jpg');
  assert.equal(ok.src, 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Hall.jpg/1280px-Hall.jpg');
  assert.deepEqual(ok.credit, { by: 'Jane Doe', license: 'CC BY-SA 4.0', page: 'https://commons.wikimedia.org/wiki/File:Hall.jpg' });
  assert.equal(commonsThumb(ok.src, 500), 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Hall.jpg/500px-Hall.jpg');
  assert.ok(commonsPhoto(info({ thumburl: 'https://thumb.wikimedia.org/x/1280px-a.jpg' }), 'https://commons.wikimedia.org/wiki/File:a.jpg'));
  assert.equal(commonsPhoto(info({ width: 800 }), 'p'), null, 'too small');
  assert.equal(commonsPhoto(info({ width: 1500, height: 2000 }), 'p'), null, 'portrait');
  assert.equal(commonsPhoto(info({ extmetadata: { LicenseShortName: { value: 'Fair use' } } }), 'p'), null, 'not free');
  assert.equal(commonsPhoto(info({ thumburl: 'https://evil.example/1280px-a.jpg' }), 'p'), null, 'other host');
  assert.equal(commonsPhoto(info(), 'https://commons.wikimedia.org/wiki/File:Old_Main_postcard.jpg'), null, 'postcard');
  assert.equal(commonsPhoto(info(), 'https://commons.wikimedia.org/wiki/File:Students_on_the_quad.jpg'), null, 'people');
  assert.equal(commonsPhoto(info({ extmetadata: { ...info().extmetadata, DateTimeOriginal: { value: '1908' } } }), 'p'), null, 'old photo');
});

test('photo choice: Commons, then a good local photo, then any local, then U.S. News', async () => {
  const { pickPhoto } = await import('../scripts/explore/catalog.mjs');
  const commons = { src: 'https://upload.wikimedia.org/a/1280px-x.jpg', credit: { by: 'a', license: 'CC0', page: 'p' } };
  assert.equal(pickPhoto({ usnewsPhoto: '/colleges/x.jpg', localSize: { width: 2000, height: 1200 }, commons }).photo, commons.src);
  assert.deepEqual(pickPhoto({ usnewsPhoto: '/colleges/x.jpg', localSize: { width: 600, height: 800 }, commons: null }), { photo: '/colleges/x.jpg' });
  assert.deepEqual(pickPhoto({ usnewsPhoto: 'https://www.usnews.com/dims4/x.jpg', commons: null }), { photo: 'https://www.usnews.com/dims4/x.jpg' });
  assert.deepEqual(pickPhoto({ usnewsPhoto: 'javascript:alert(1)', commons: null }), {});
});

test('catalog rows: Scorecard mapping, unique slugs, image sizes, article candidates', async () => {
  const M = await import('../scripts/explore/catalog.mjs');
  const row = M.scorecardRow({ id: 1, 'school.name': 'Test College', 'school.ownership': 2, 'school.locale': 12, 'school.carnegie_basic': 21, 'school.region_id': 1, 'latest.admissions.sat_scores.25th_percentile.math': 600, 'latest.admissions.sat_scores.25th_percentile.critical_reading': 610, 'school.minority_serving.historically_black': 1 });
  assert.deepEqual(row, { id: 1, name: 'Test College', region: 'northeast', control: 'private', setting: 'urban', kind: 'liberal-arts', hbcu: true, sat25: 1210 });
  const slugs = M.assignSlugs([{ id: 1, name: 'Columbia College', state: 'MO' }, { id: 2, name: 'Columbia College', state: 'SC' }, { id: 3, name: 'X', slug: 'kept' }]).map((r) => r.slug);
  assert.deepEqual(slugs, ['columbia-college', 'columbia-college-sc', 'kept']);
  const png = Buffer.alloc(32); png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(1600, 16); png.writeUInt32BE(900, 20);
  assert.deepEqual(M.imageSize(png), { width: 1600, height: 900 });
  assert.equal(M.isGoodSize({ width: 1600, height: 900 }), true);
  assert.equal(M.isGoodSize({ width: 778, height: 203 }), false);
  assert.deepEqual(M.articlePhotoCandidates(['Seal_of_X.svg', 'X_logo.png', 'Old_Main_at_X.jpg', 'Map_of_X.png', 'Quad.JPG']), ['File:Old Main at X.jpg', 'File:Quad.JPG']);
});

test('research flags read the audited notes conservatively', () => {
  assert.equal(N.meetsFullNeed('Yes: 100% of need met on average (CDS H2)'), true);
  assert.equal(N.meetsFullNeed('Need-blind; meets full demonstrated need for U.S. citizens'), true);
  assert.equal(N.meetsFullNeed('No; average 60% of need met'), false);
  assert.equal(N.meetsFullNeed('No guarantee of full need; average 88% met'), false);
  assert.equal(N.meetsFullNeed('Average 88% of need met'), undefined);
  assert.equal(N.testPolicyOf('Test-optional for all first-year applicants'), 'optional');
  assert.equal(N.testPolicyOf('Test-required: official ACT/SAT scores are required'), 'required');
  assert.equal(N.testPolicyOf('Test-blind: scores are not considered'), 'blind');
  assert.deepEqual(N.roundsOf('ED only (binding, Nov 1); no EA or ED II; RD Jan 1'), { ed: true, ea: false });
  assert.deepEqual(N.roundsOf('Non-binding Early Action in rounds; Regular Decision Feb 1'), { ed: false, ea: true });
  assert.equal(N.meritOf('Essentially none: aid is need-based'), false);
  assert.equal(N.meritOf('Yes: automatic consideration'), true);
  assert.equal(N.interestOf('Very important (CDS C7)'), 'very-important');
  assert.equal(N.interviewOffered('Not considered (CDS C7)'), false);
});

test('catalog: more colleges than the ranking, every slug unique, safe photo links', () => {
  assert.ok(C.CATALOG.length > 1000, `catalog has ${C.CATALOG.length} colleges`);
  const slugs = new Set(C.CATALOG.map((c) => c.slug));
  assert.equal(slugs.size, C.CATALOG.length);
  for (const c of C.CATALOG) {
    if (c.photo) assert.match(c.photo, /^(\/colleges\/|https:\/\/(upload|thumb)\.wikimedia\.org\/|https:\/\/www\.usnews\.com\/)/, c.slug);
    if (c.credit) assert.match(c.credit.page, /^https:\/\//, c.slug);
  }
  assert.ok(C.CATALOG.filter((c) => c.lacRank).length >= 50, 'liberal arts colleges are in');
  assert.equal(C.catalogRow('williams-college').lacRank, 1);
});

test('catalog search: aliases, cities and partial names', () => {
  assert.equal(C.searchCatalog('williams')[0].slug, 'williams-college');
  assert.ok(C.searchCatalog('ucla').some((c) => /Los Angeles/.test(c.name)), 'UCLA alias');
  assert.ok(C.searchCatalog('pittsburgh').length > 1, 'city search');
  assert.deepEqual(C.searchCatalog('   '), []);
});

test('Explore rows carry facets and other rankings; extras keep only http(s) links', () => {
  const yale = C.toExploreCollege(C.catalogRow('yale-university'));
  assert.equal(yale.f.meetsNeed, true);
  assert.equal(yale.f.notes, true);
  assert.equal(typeof yale.f.admit, 'number');
  assert.ok(yale.f.lists && Object.keys(yale.f.lists).length >= 2, 'ranked elsewhere too');
  const extras = C.exploreExtras('yale-university');
  assert.ok(extras.research.notes.length > 5);
  for (const n of extras.research.notes) assert.match(n.sourceUrl, /^https?:\/\//);
  assert.ok(extras.niche, 'Niche grades');
  assert.equal(C.exploreExtras('no-such-school').research, null);
});
