const test = require('node:test');
const assert = require('node:assert/strict');
const { matchSchool, rankList, WEIGHTS: W } = require('../public/hub/rank-list.js');
// The List tab's weighted average of [rank, weight] pairs, skipping missing ranks.
const wavg = (...p) => { const h = p.filter(([r]) => r != null); return h.reduce((a, [r, w]) => a + r * w, 0) / h.reduce((a, [, w]) => a + w, 0); };
const { schools } = require('../public/data/career-ranking.json');

const nameOf = (appName) => (matchSchool(appName, schools) || {}).name;

test('application names match the ranking file’s schools', () => {
  assert.equal(nameOf('University of Michigan'), 'Michigan');
  assert.equal(nameOf('University of Wisconsin–Madison'), 'Wisconsin');
  assert.equal(nameOf('The Ohio State University'), 'Ohio State');
  assert.equal(nameOf('Washington University in St. Louis'), 'WashU');
  assert.equal(nameOf('University of Illinois at Urbana-Champaign'), 'UIUC');
  assert.equal(nameOf('University of North Carolina at Chapel Hill'), 'UNC Chapel Hill');
  assert.equal(nameOf('Rutgers University–New Brunswick'), 'Rutgers');
  assert.equal(nameOf('Arizona State University'), 'Arizona State');
  assert.equal(nameOf('Penn State'), 'Penn State');
  assert.equal(nameOf('UCLA'), 'UCLA');
});

test('ambiguous or unknown names do not match', () => {
  assert.equal(nameOf('University of California'), undefined);
  assert.equal(nameOf('Gotham University'), undefined);
  assert.equal(nameOf(''), undefined);
});

test('the list runs best average rank first, unranked schools last', () => {
  const apps = [
    { id: 'a', name: 'Arizona State University' },
    { id: 'r', name: 'Gotham University' },
    { id: 'c', name: 'Cornell University' },
    { id: 'm', name: 'University of Michigan' },
  ];
  const list = rankList(apps, schools);
  assert.deepEqual(list.map((r) => r.app.id), ['c', 'm', 'a', 'r']);
  const cornell = schools.find((s) => s.name === 'Cornell');
  assert.equal(list[0].avg, wavg([cornell.usn.rank, W.usn], [cornell.niche.rank, W.niche], [cornell.forbes, W.forbes]));
  assert.equal(list[3].avg, null);
});

test('a liberal arts college’s U.S. News rank counts as its linked national rank', () => {
  const [row] = rankList([{ id: 'a', name: 'Amherst College' }], schools);
  const amherst = schools.find((s) => s.name === 'Amherst');
  assert.equal(row.ranks.lac, true);
  assert.equal(row.ranks.usn, amherst.usn.rank);
  // #2 on the LAC list links to a national rank below #2 but above its Niche/Forbes average.
  assert.ok(row.ranks.usnNational > amherst.usn.rank && row.ranks.usnNational < (amherst.niche.rank + amherst.forbes) / 2);
  assert.equal(row.avg, wavg([row.ranks.usnNational, W.usn], [amherst.niche.rank, W.niche], [amherst.forbes, W.forbes]));
});

test('the LAC link keeps order: a better LAC rank links to a better national rank', () => {
  const { lacLink } = require('../public/hub/rank-list.js');
  const toNational = lacLink(schools);
  for (let r = 1; r < 60; r++) assert.ok(toNational(r) < toNational(r + 1));
});

test('without enough schools to link, a LAC rank stays out of the average', () => {
  const few = [{ name: 'Testing College', full: 'Testing College', usn: { rank: 3, lac: true }, niche: { rank: 20 }, forbes: 40 }];
  const [row] = rankList([{ id: 't', name: 'Testing College' }], few);
  assert.equal(row.ranks.usnNational, null);
  assert.equal(row.avg, wavg([20, W.niche], [40, W.forbes]));
});

test('the average uses only the ranks a school has', () => {
  const one = [{ name: 'Testing College', full: 'Testing College', usn: { rank: 10 }, niche: { rank: 20 }, forbes: null }];
  const [row] = rankList([{ id: 't', name: 'Testing College' }], one);
  assert.equal(row.avg, wavg([10, W.usn], [20, W.niche]));
});

test('copy text is one "Full name - round" line per school, in list order', () => {
  const { copyText } = require('../public/hub/rank-list.js');
  const apps = [
    { id: 'a', name: 'Arizona State University', round: 'EA' },
    { id: 'c', name: 'Cornell University', round: 'ED' },
    { id: 'u', name: 'University of California-Los Angeles', round: 'RD' },
    { id: 'm', name: 'University of Michigan', round: 'REA' },
    { id: 'n', name: 'Northeastern University', round: 'ED2' },
    { id: 'p', name: 'Purdue University', round: 'Rolling' },
    { id: 'r', name: 'Gotham University', round: '' },
  ];
  assert.equal(copyText(rankList(apps, schools)), [
    'Cornell University - ED1',
    'University of California-Los Angeles - UC',
    'University of Michigan - EA',
    'Northeastern University - ED2',
    'Purdue University - Rolling',
    'Arizona State University - EA',
    'Gotham University',
  ].join('\n'));
});

test('schools outside the career file fall back to the official rankings', () => {
  const { officialSchools } = require('../public/hub/rank-list.js');
  const official = officialSchools(require('../public/data/official-rankings.json'));
  const apps = [
    { id: 'nw', name: 'Northwestern University' },
    { id: 'ut', name: 'University of Texas at Austin' },
    { id: 'wi', name: 'Williams College' },
    { id: 'x', name: 'Nowhere Testing College' },
  ];
  const byId = Object.fromEntries(rankList(apps, schools, official).map((r) => [r.app.id, r]));
  assert.deepEqual([byId.nw.ranks.usn, byId.nw.ranks.niche, byId.nw.ranks.forbes], [9, 27, 15]);
  assert.equal(byId.ut.ranks.usn, 34);
  assert.equal(byId.wi.ranks.lac, true);
  assert.equal(byId.wi.ranks.usn, 1);
  assert.ok(byId.wi.ranks.usnNational > 1);
  assert.equal(byId.x.avg, null);
  // A school in the career file keeps the career file's ranks.
  const [mich] = rankList([{ id: 'm', name: 'University of Michigan' }], schools, official);
  const m = schools.find((s) => s.name === 'Michigan');
  assert.equal(mich.ranks.niche, m.niche.rank);
});

test('weights put U.S. News and Forbes first and Princeton Review last', () => {
  assert.ok(W.usn === W.forbes && W.forbes > W.niche && W.niche > W.wsj && W.wsj > W.pr && W.pr > 0);
});

test('WSJ and Princeton Review ranks join the weighted average', () => {
  const { officialSchools } = require('../public/hub/rank-list.js');
  const data = require('../public/data/official-rankings.json');
  const official = officialSchools(data);
  const apps = [
    { id: 'gt', name: 'Georgia Institute of Technology' },
    { id: 'p', name: 'Princeton University' },
    { id: 'm', name: 'University of Michigan' },
  ];
  const byId = Object.fromEntries(rankList(apps, schools, official, data.extra).map((r) => [r.app.id, r]));
  assert.equal(byId.p.ranks.wsj, data.extra.wsj.find((e) => e.name === 'Princeton University').rank);
  assert.deepEqual([byId.p.ranks.pr.kind, byId.p.ranks.pr.rank], ['private', 1]);
  assert.deepEqual([byId.gt.ranks.pr.kind, byId.gt.ranks.pr.rank], ['public', 1]);
  assert.equal(byId.m.ranks.pr.kind, 'public');
  // A Princeton Review rank counts as a national rank at the same standing.
  for (const r of Object.values(byId)) assert.ok(r.ranks.pr.national > 0);
  const p = byId.p.ranks;
  assert.equal(byId.p.avg, wavg([p.usnNational, W.usn], [p.niche, W.niche], [p.forbes, W.forbes], [p.wsj, W.wsj], [p.pr.national, W.pr]));
});

test('the Princeton Review links keep order on both lists', () => {
  const { prLinks } = require('../public/hub/rank-list.js');
  const links = prLinks(schools, require('../public/data/official-rankings.json').extra);
  for (const f of [links.prPublic, links.prPrivate]) {
    assert.ok(f);
    for (let r = 1; r < 50; r++) assert.ok(f(r) < f(r + 1));
  }
});

test('without the extra lists the average still works', () => {
  const [row] = rankList([{ id: 'c', name: 'Cornell University' }], schools);
  assert.equal(row.ranks.wsj, null);
  assert.equal(row.ranks.pr, null);
});

test('extra lists match names exactly enough not to borrow a neighbor’s rank', () => {
  const { officialSchools } = require('../public/hub/rank-list.js');
  const data = require('../public/data/official-rankings.json');
  const official = officialSchools(data);
  const rank = (name) => rankList([{ id: 1, name }], schools, official, data.extra)[0].ranks;
  // A campus name matches the list's campus-less entry and the other way round.
  assert.equal(rank('University of Colorado Boulder').pr.rank, 38);
  assert.equal(rank('Harvard University').pr.kind, 'private');
  // Neighbors with a shared stem don't.
  assert.equal(rank('University of North Carolina at Charlotte').pr, null);
  assert.equal(rank('The University of the South').pr, null);
  assert.equal(rank('University of Georgia').wsj, null);
});

test('the full lists rank schools well outside the top 100s', () => {
  const { officialSchools } = require('../public/hub/rank-list.js');
  const data = require('../public/data/official-rankings.json');
  const official = officialSchools(data);
  const rank = (name) => rankList([{ id: 1, name }], schools, official, data.extra)[0];
  // A bare system name means the flagship campus.
  assert.equal(matchSchool('Rutgers University', schools).name, 'Rutgers');
  assert.ok(rank('Rutgers University').avg != null);
  // Nicknames students write.
  for (const n of ['Cal State Long Beach', 'Chico State', 'UMass Amherst', 'UMBC', 'Cal Poly San Luis Obispo', 'Miami University']) {
    assert.ok(rank(n).avg != null, n);
  }
  // Still nothing for a made-up school.
  assert.equal(rank('Gotham Testing College').avg, null);
});

test('the Forge ranking orders schools by the List tab average and skips thin coverage', () => {
  const { forgeRanking, WEIGHTS: Wt } = require('../public/hub/rank-list.js');
  const data = require('../public/data/official-rankings.json');
  const f = forgeRanking(data);
  assert.ok(f.length > 100);
  for (let i = 1; i < f.length; i++) assert.ok(f[i].avg >= f[i - 1].avg && f[i].rank >= f[i - 1].rank);
  // Only U.S. News plus Niche's worth of weight or more gets a rank.
  for (const r of f) {
    const w = [r.ranks.usnNational && Wt.usn, r.ranks.niche && Wt.niche, r.ranks.forbes && Wt.forbes, r.ranks.wsj && Wt.wsj, r.ranks.pr && r.ranks.pr.national && Wt.pr].reduce((a, b) => a + (b || 0), 0);
    assert.ok(w >= 1.5, r.name);
  }
});

test('the student’s career rank joins the average at the national rank of the same standing', () => {
  const { lacLink } = require('../public/hub/rank-list.js');
  assert.equal(W.career, W.usn);
  // A made-up career ranking: the schools in Forbes order, so it tracks the other lists and can be linked.
  const career = [...schools].sort((a, b) => (a.forbes || 999) - (b.forbes || 999)).map((s, i) => ({ id: s.id, rank: i + 1 }));
  const apps = [{ id: 'c', name: 'Cornell University' }, { id: 'u', name: 'Unknown College of Nowhere' }];
  const byId = Object.fromEntries(rankList(apps, schools, null, null, career).map((r) => [r.app.id, r]));
  const c = byId.c.ranks;
  const cornell = schools.find((s) => s.name === nameOf('Cornell University'));
  assert.equal(c.career.rank, career.find((x) => x.id === cornell.id).rank);
  assert.ok(c.career.national > 0);
  assert.equal(byId.c.avg, wavg([c.usnNational, W.usn], [c.niche, W.niche], [c.forbes, W.forbes], [c.career.national, W.career]));
  assert.equal(byId.u.ranks.career, null);
  assert.ok(lacLink(schools));
});

test('without a career ranking the average is unchanged', () => {
  const [a] = rankList([{ id: 'c', name: 'Cornell University' }], schools);
  const [b] = rankList([{ id: 'c', name: 'Cornell University' }], schools, null, null, null);
  assert.equal(a.ranks.career, null);
  assert.equal(a.avg, b.avg);
});
