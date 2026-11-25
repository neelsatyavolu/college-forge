const test = require('node:test');
const assert = require('node:assert/strict');
const { matchSchool, rankList } = require('../public/hub/rank-list.js');
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
  assert.equal(nameOf('Rice University'), undefined);
  assert.equal(nameOf(''), undefined);
});

test('the list runs best average rank first, unranked schools last', () => {
  const apps = [
    { id: 'a', name: 'Arizona State University' },
    { id: 'r', name: 'Rice University' },
    { id: 'c', name: 'Cornell University' },
    { id: 'm', name: 'University of Michigan' },
  ];
  const list = rankList(apps, schools);
  assert.deepEqual(list.map((r) => r.app.id), ['c', 'm', 'a', 'r']);
  const cornell = schools.find((s) => s.name === 'Cornell');
  assert.equal(list[0].avg, (cornell.usn.rank + cornell.niche.rank + cornell.forbes) / 3);
  assert.equal(list[3].avg, null);
});

test('a liberal arts college’s U.S. News rank counts as its linked national rank', () => {
  const [row] = rankList([{ id: 'a', name: 'Amherst College' }], schools);
  const amherst = schools.find((s) => s.name === 'Amherst');
  assert.equal(row.ranks.lac, true);
  assert.equal(row.ranks.usn, amherst.usn.rank);
  // #2 on the LAC list links to a national rank below #2 but above its Niche/Forbes average.
  assert.ok(row.ranks.usnNational > amherst.usn.rank && row.ranks.usnNational < (amherst.niche.rank + amherst.forbes) / 2);
  assert.equal(row.avg, (row.ranks.usnNational + amherst.niche.rank + amherst.forbes) / 3);
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
  assert.equal(row.avg, 30);
});

test('the average uses only the ranks a school has', () => {
  const one = [{ name: 'Testing College', full: 'Testing College', usn: { rank: 10 }, niche: { rank: 20 }, forbes: null }];
  const [row] = rankList([{ id: 't', name: 'Testing College' }], one);
  assert.equal(row.avg, 15);
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
    { id: 'r', name: 'Rice University', round: '' },
  ];
  assert.equal(copyText(rankList(apps, schools)), [
    'Cornell University - ED1',
    'University of California-Los Angeles - UC',
    'University of Michigan - EA',
    'Northeastern University - ED2',
    'Purdue University - Rolling',
    'Arizona State University - EA',
    'Rice University',
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
