const test = require('node:test');
const assert = require('node:assert/strict');
const { deadlineTone, planDeadlines } = require('../public/hub/deadline-plan.js');

const tone = (plan) => deadlineTone(plan).label;

test('aid, scholarship, program and document deadlines are not flagged as admission rounds', () => {
  assert.equal(tone('Financial aid — ED I'), 'Aid');
  assert.equal(tone('FAFSA priority — ED I'), 'Aid');
  assert.equal(tone('Foundation Fellowship application'), '$');
  assert.equal(tone('Presidential merit scholarship'), '$');
  assert.equal(tone('Core Honors interview request'), 'Program');
  assert.equal(tone('EA/ED I materials — full admission and scholarship consideration'), '$');
  assert.equal(tone('EA supplemental materials'), 'Docs');
});

test('admission rounds keep their flags', () => {
  assert.equal(tone('ED I'), 'ED');
  assert.equal(tone('ED II'), 'ED');
  assert.equal(tone('EA I'), 'EA');
  assert.equal(tone('REA'), 'REA');
  assert.equal(tone('RD'), 'RD');
  assert.equal(tone('Rolling admission final deadline'), 'Rolling');
  assert.equal(tone('Priority'), 'Priority');
});

const plans = (college) => planDeadlines(college).map((d) => d.plan);

test('shows only the chosen round and the deadlines that go with it', () => {
  const college = {
    deadline: 'EA · Nov 1',
    deadlines: [
      { plan: 'ED I', date: '2026-11-01' },
      { plan: 'EA', date: '2026-11-01' },
      { plan: 'ED II', date: '2027-01-05' },
      { plan: 'RD', date: '2027-01-05' },
      { plan: 'Financial aid — ED I', date: '2026-11-01' },
      { plan: 'CSS Profile — EA/RD', date: '2026-11-15' },
      { plan: 'EA supplemental materials', date: '2026-11-09' },
      { plan: 'Honors program', date: '2026-12-01' },
    ],
  };
  assert.deepEqual(plans(college), ['EA', 'CSS Profile — EA/RD', 'EA supplemental materials', 'Honors program']);
});

test('EA I and EA II are different rounds; ED means ED I', () => {
  const college = { deadline: 'EA I · Nov 1', deadlines: [{ plan: 'EA I', date: 'x' }, { plan: 'EA II', date: 'y' }, { plan: 'RD', date: 'z' }] };
  assert.deepEqual(plans(college), ['EA I']);
  const ed = { deadline: 'ED · Nov 1', deadlines: [{ plan: 'ED I', date: 'x' }, { plan: 'ED II', date: 'y' }] };
  assert.deepEqual(plans(ed), ['ED I']);
});

test('non-lettered chosen rounds such as Priority match by name', () => {
  const college = {
    deadline: 'Priority · Dec 1',
    deadlines: [
      { plan: 'Priority', date: 'a' },
      { plan: 'Rolling admission final deadline', date: 'b' },
      { plan: 'Honors scholarships', date: 'c' },
    ],
  };
  assert.deepEqual(plans(college), ['Priority', 'Honors scholarships']);
});

test('schools without a chosen round show every deadline', () => {
  const college = { deadlines: [{ plan: 'ED I', date: 'x' }, { plan: 'RD', date: 'y' }] };
  assert.deepEqual(plans(college), ['ED I', 'RD']);
});
