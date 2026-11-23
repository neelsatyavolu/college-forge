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

test('a liberal arts college’s separate U.S. News rank stays out of its average', () => {
  const [row] = rankList([{ id: 'a', name: 'Amherst College' }], schools);
  const amherst = schools.find((s) => s.name === 'Amherst');
  assert.equal(row.ranks.lac, true);
  assert.equal(row.ranks.usn, amherst.usn.rank);
  assert.equal(row.avg, (amherst.niche.rank + amherst.forbes) / 2);
});

test('the average uses only the ranks a school has', () => {
  const one = [{ name: 'Testing College', full: 'Testing College', usn: { rank: 10 }, niche: { rank: 20 }, forbes: null }];
  const [row] = rankList([{ id: 't', name: 'Testing College' }], one);
  assert.equal(row.avg, 15);
});
