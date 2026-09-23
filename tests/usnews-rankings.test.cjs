const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../scripts/rankings/usnews.mjs');

const item = (over = {}, search = {}) => ({
  institution: {
    displayName: 'University of St. Thomas', city: 'St. Paul', state: 'MN', xwalkId: '174914',
    rankingSortRank: 158, rankingRankStatus: 'ranked', primaryPhotoCardLarge: 'https://cdn/x.jpg', ...over,
  },
  searchData: {
    satAvg: { displayValue: '1120-1300' }, hsGpaAvg: { rawValue: '3.6' }, acceptanceRate: { rawValue: 85 }, ...search,
  },
});

test('parseItem reads rank, IPEDS id, SAT band, GPA and acceptance rate', async () => {
  const { parseItem } = await load();
  assert.deepEqual(parseItem(item()), {
    name: 'University of St. Thomas', rank: 158, city: 'St. Paul', state: 'MN', scorecardId: 174914,
    photo: 'https://cdn/x.jpg', gpa: 3.6, gpaWeighted: false, admitRate: 0.85, sat25: 1120, sat75: 1300,
  });
  assert.equal(parseItem(item({ rankingRankStatus: 'unranked' })), null);
  assert.equal(parseItem(item({ rankingSortRank: null })), null);
  const sparse = parseItem(item({ xwalkId: null }, { satAvg: { displayValue: 'N/A' }, hsGpaAvg: { rawValue: null }, acceptanceRate: {} }));
  assert.deepEqual([sparse.scorecardId, sparse.sat25, sparse.gpa, sparse.admitRate], [null, null, null, null]);
  assert.equal(parseItem(item({}, { hsGpaAvg: { rawValue: 4.2 } })).gpaWeighted, true);
});

test('buildRow prefers Scorecard admissions, falls back to U.S. News, and keeps saved slugs', async () => {
  const { buildRow, parseItem } = await load();
  const usn = parseItem(item());
  const fresh = buildRow(usn, { scorecard: { locale: 12, admitRate: 0.81234, sat25: 1100, sat75: null } });
  assert.equal(fresh.slug, 'university-of-st-thomas');
  assert.deepEqual([fresh.setting, fresh.settingDetail, fresh.admitRate, fresh.sat25, fresh.sat75], ['urban', 'City: Midsize', 0.8123, 1100, 1300]);
  const kept = buildRow(usn, { scorecard: undefined, previous: { slug: 'old-slug', setting: 'town', settingDetail: 'Town: Fringe' } });
  assert.deepEqual([kept.slug, kept.setting, kept.settingDetail, kept.admitRate], ['old-slug', 'town', 'Town: Fringe', 0.85]);
});

test('same-named schools get distinct slugs', async () => {
  const { disambiguateSlugs } = await load();
  const rows = disambiguateSlugs([
    { slug: 'university-of-st-thomas', state: 'MN' },
    { slug: 'yale-university', state: 'CT' },
    { slug: 'university-of-st-thomas', state: 'TX' },
  ]);
  assert.deepEqual(rows.map((r) => r.slug), ['university-of-st-thomas-mn', 'yale-university', 'university-of-st-thomas-tx']);
});

test('validateRows blocks short, duplicate, unordered or settingless data', async () => {
  const { validateRows } = await load();
  const row = (rank, id) => ({ name: `S${id}`, slug: `s${id}`, scorecardId: id, rank, setting: 'urban' });
  assert.deepEqual(validateRows([row(1, 1), row(2, 2)], { maxRank: 250, minRows: 2 }), []);
  const problems = validateRows([row(3, 1), row(2, 1), { ...row(300, 3), setting: null }], { maxRank: 250, minRows: 5 });
  assert.ok(problems.some((p) => /only 3/.test(p)));
  assert.ok(problems.some((p) => /duplicate scorecardId/.test(p)));
  assert.ok(problems.some((p) => /out of rank order/.test(p)));
  assert.ok(problems.some((p) => /past the cutoff/.test(p)));
  assert.ok(problems.some((p) => /no campus setting/.test(p)));
});

test('a fall release is next year\'s edition', async () => {
  const { editionFor } = await load();
  assert.equal(editionFor(new Date('2026-09-23T12:00:00Z')), '2027');
  assert.equal(editionFor(new Date('2027-03-01T12:00:00Z')), '2027');
});

test('the checked-in dataset is valid and matches its edition', () => {
  const { US_NEWS_TOP_250, US_NEWS_EDITION, US_NEWS_BY_SLUG } = require('../lib/us-news-rankings.ts');
  assert.match(US_NEWS_EDITION, /^20\d\d$/);
  assert.ok(US_NEWS_TOP_250.length >= 225);
  assert.equal(US_NEWS_BY_SLUG.size, US_NEWS_TOP_250.length, 'slugs are unique');
  for (const c of US_NEWS_TOP_250) {
    assert.ok(['urban', 'suburban', 'town', 'rural'].includes(c.setting), c.name);
    assert.ok(Number.isInteger(c.scorecardId) && c.scorecardId > 0, c.name);
  }
});
