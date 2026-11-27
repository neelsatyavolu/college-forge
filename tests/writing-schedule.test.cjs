const test = require('node:test');
const assert = require('node:assert/strict');
const { timeline, schoolDeadline, roundChoiceLabel } = require('../public/hub/timeline-plan.js');
const { writingSchedule, MIN_DAILY_WORDS } = require('../public/hub/writing-schedule.js');

const TODAY = '2026-11-27'; // a Friday

const personal = { id: 'ca-ps-1', label: 'Personal statement', prompt: 'Share a story.', limit: 650, unit: 'words', chooseGroup: 'common', choose: 1 };
const college = (slug, deadline, deadlines) => ({ slug, name: slug.replace(/-/g, ' '), short: slug, deadline, deadlines });
const supp = (id, limit, unit = 'words') => ({ id, label: `Essay ${id}`, prompt: 'Why us?', limit, unit, required: true });
function workspace(over) {
  return {
    colleges: [],
    essays: { commonApp: [personal], supplements: {} },
    essayDrafts: {},
    essayStatus: {},
    criticalDates: [],
    ...over,
  };
}

test('the personal statement comes first and every essay finishes before its deadline', () => {
  const ws = workspace({
    colleges: [college('alpha', 'EA · Dec 15', [{ plan: 'EA', date: '2026-12-15' }, { plan: 'RD', date: '2027-01-05' }])],
    essays: { commonApp: [personal], supplements: { alpha: [supp('a1', 250)] } },
  });
  const plan = writingSchedule(ws, [], TODAY);
  assert.equal(plan.groups[0].kind, 'common');
  assert.equal(plan.groups[0].finishBy, '2026-12-08');
  assert.equal(plan.groups[1].finishBy, '2026-12-12');
  const [ps] = plan.groups[0].essays;
  const [a1] = plan.groups[1].essays;
  assert.ok(ps.targets.outline <= ps.targets.draft && ps.targets.draft <= ps.targets.final);
  assert.ok(ps.targets.final <= '2026-12-08');
  assert.ok(a1.targets.final <= '2026-12-12');
  assert.ok(ps.targets.final <= a1.targets.outline);
  assert.equal(ps.behind, false);
  assert.equal(a1.behind, false);
  // This week starts with the personal statement.
  assert.equal(plan.thisWeek.items[0].id, 'ca-ps-1');
  assert.equal(plan.thisWeek.start, '2026-11-23');
});

test('finished essays, skipped schools and submitted schools drop out', () => {
  const ws = workspace({
    colleges: [
      college('alpha', 'RD · Jan 5', [{ plan: 'RD', date: '2027-01-05' }]),
      college('beta', 'RD · Jan 5', [{ plan: 'RD', date: '2027-01-05' }]),
      college('gamma', 'RD · Jan 5', [{ plan: 'RD', date: '2027-01-05' }]),
    ],
    essays: { commonApp: [personal], supplements: { alpha: [supp('a1', 250), supp('a2', 100)], beta: [supp('b1', 300)], gamma: [supp('g1', 300)] } },
    essayStatus: { a2: 'final', 'ca-ps-1': 'final' },
    essaySchools: { beta: false },
  });
  const apps = [{ slug: 'gamma', name: 'gamma', stage: 'waiting' }];
  const plan = writingSchedule(ws, apps, TODAY);
  assert.deepEqual(plan.groups.map((g) => g.key), ['common', 'alpha']);
  assert.deepEqual(plan.groups[0].essays, []);
  assert.deepEqual(plan.groups[1].essays.map((e) => e.id), ['a1']);
  assert.deepEqual(plan.groups[1].finished.map((e) => e.id), ['a2']);
  const scheduled = plan.weeks.flatMap((w) => w.items.map((i) => i.id));
  assert.ok(!scheduled.includes('a2') && !scheduled.includes('b1') && !scheduled.includes('g1') && !scheduled.includes('ca-ps-1'));
});

test('no week carries more than the steady pace', () => {
  const colleges = [];
  const supplements = {};
  ['a', 'b', 'c', 'd', 'e', 'f'].forEach((s, i) => {
    colleges.push(college(s, 'RD · Jan 15', [{ plan: 'RD', date: i < 3 ? '2026-12-20' : '2027-01-15' }]));
    supplements[s] = [supp(s + '1', 400), supp(s + '2', 250)];
  });
  const plan = writingSchedule(workspace({ colleges, essays: { commonApp: [personal], supplements } }), [], TODAY);
  assert.ok(plan.pace >= MIN_DAILY_WORDS * 7);
  for (const w of plan.weeks) assert.ok(w.words <= plan.pace + 1, `${w.start}: ${w.words} > ${plan.pace}`);
  // Full weeks never get busier than the week before.
  const full = plan.weeks.slice(1, -1).map((w) => w.words);
  assert.ok(full.length > 1, full.join(','));
  full.forEach((x, i) => assert.ok(i === 0 || x <= full[i - 1] + 1, full.join(',')));
  const behind = plan.groups.flatMap((g) => g.essays).filter((e) => e.behind);
  assert.deepEqual(behind, []);
});

test('a crunch before an early deadline does not pull later schools forward', () => {
  const ws = workspace({
    colleges: [
      college('early', 'EA · Dec 1', [{ plan: 'EA', date: '2026-12-01' }]),
      college('late', 'RD · Jan 15', [{ plan: 'RD', date: '2027-01-15' }]),
    ],
    essays: { commonApp: [personal], supplements: { early: [supp('e1', 650), supp('e2', 650)], late: [supp('l1', 250), supp('l2', 250)] } },
    essayStatus: { 'ca-ps-1': 'final' },
  });
  const plan = writingSchedule(ws, [], TODAY);
  const late = plan.groups.find((g) => g.key === 'late');
  // After the crunch the later school's essays go at the gentle minimum pace, not the crunch pace.
  assert.ok(plan.weeks[0].words > MIN_DAILY_WORDS * 7);
  for (const w of plan.weeks.slice(1)) assert.ok(w.words <= MIN_DAILY_WORDS * 7 + 1, `${w.start}: ${w.words}`);
  assert.ok(late.essays[0].targets.outline > '2026-11-28');
  assert.ok(late.essays[1].targets.final <= late.finishBy);
});

test('started essays skip the outline, and character limits count as words', () => {
  const ws = workspace({
    colleges: [college('alpha', 'RD · Jan 5', [{ plan: 'RD', date: '2027-01-05' }])],
    essays: { commonApp: [personal], supplements: { alpha: [supp('a1', 250), supp('a2', 1200, 'characters')] } },
    essayDrafts: { a1: 'one two three' },
    essayStatus: { 'ca-ps-1': 'draft' },
  });
  const plan = writingSchedule(ws, [], TODAY);
  const [ps] = plan.groups[0].essays;
  const [a1, a2] = plan.groups[1].essays;
  assert.equal(ps.state, 'draft');
  assert.equal(ps.targets.outline, undefined);
  assert.equal(a1.state, 'draft');
  assert.equal(a1.targets.outline, undefined);
  assert.equal(a2.state, 'not_started');
  assert.ok(a2.targets.outline);
});

test('an essay that cannot be done in time is marked behind', () => {
  const ws = workspace({
    colleges: [college('alpha', 'EA · Nov 30', [{ plan: 'EA', date: '2026-11-30' }])],
    essays: { commonApp: [personal], supplements: { alpha: [supp('a1', 650), supp('a2', 650), supp('a3', 650)] } },
  });
  const plan = writingSchedule(ws, [], TODAY);
  assert.ok(plan.groups.flatMap((g) => g.essays).some((e) => e.behind));
  assert.equal(plan.groups[1].finishBy, TODAY, 'finish-by never lands before today');
});

test('a school with no chosen round is planned against its earliest upcoming round', () => {
  const c = college('alpha', '', [{ plan: 'RD', date: '2027-01-05' }, { plan: 'EA', date: '2026-12-01' }, { plan: 'Financial aid', date: '2026-11-30' }]);
  assert.deepEqual(schoolDeadline(c, null, TODAY), { date: '2026-12-01', plan: 'EA', assumed: true });
  assert.deepEqual(schoolDeadline(c, { deadline: '2027-01-05', round: 'RD' }, TODAY), { date: '2027-01-05', plan: 'RD', assumed: false });
  assert.deepEqual(schoolDeadline({ ...c, deadline: 'RD · Jan 5' }, null, TODAY), { date: '2027-01-05', plan: 'RD', assumed: false });
  const plan = writingSchedule(workspace({ colleges: [c], essays: { commonApp: [personal], supplements: { alpha: [supp('a1', 250)] } } }), [], TODAY);
  assert.equal(plan.groups[1].finishBy, '2026-11-28');
});

test('UC campuses share one UC Application group and need no personal statement', () => {
  const uc = { slug: 'university-of-california-davis', name: 'University of California-Davis', short: 'UC Davis', deadline: 'RD · Nov 30', deadlines: [{ plan: 'RD', date: '2026-11-30' }] };
  const piq = { id: 'uc-piq-1', label: 'PIQ 1', prompt: 'Leadership', limit: 350, unit: 'words', chooseGroup: 'uc', choose: 1 };
  const plan = writingSchedule(workspace({ colleges: [uc], essays: { commonApp: [personal], supplements: { 'uc-application': [piq] } } }), [], TODAY);
  assert.deepEqual(plan.groups.map((g) => g.key), ['uc-application']);
});

test('the timeline shows chosen rounds, mutes the others and marks today', () => {
  const ws = workspace({
    colleges: [
      college('alpha', 'EA · Nov 1', [{ plan: 'EA', date: '2026-11-01' }, { plan: 'RD', date: '2027-01-05' }]),
      college('beta', '', [{ plan: 'ED', date: '2026-11-15' }, { plan: 'RD', date: '2027-01-02' }]),
      college('gamma', '', []),
    ],
    criticalDates: [{ date: '2026-12-01', label: 'Ask for recs', detail: '', source: 'student' }, { date: '2026-01-01', label: 'Too old', detail: '' }],
  });
  const apps = [{ slug: 'alpha', name: 'alpha', stage: 'waiting', decisionDate: { date: '2026-12-12', estimated: true } }];
  const { months, needsRound } = timeline(ws, apps, TODAY);
  assert.deepEqual(months.map((m) => m.key), ['2026-11', '2026-12', '2027-01']);
  const nov = months[0];
  assert.equal(nov.todayAt, 2, 'today sits after Nov 1 and Nov 15');
  assert.deepEqual(nov.events.map((e) => [e.title, e.kind, e.past, e.done]), [['alpha', 'deadline', true, true], ['beta', 'other-round', true, false]]);
  assert.deepEqual(months[1].events.map((e) => e.kind), ['milestone', 'decision']);
  assert.equal(months[1].events[0].mine, true);
  assert.deepEqual(months[2].events.map((e) => [e.title, e.kind]), [['beta', 'other-round'], ['alpha', 'other-round']]);
  assert.deepEqual(needsRound.map((n) => [n.slug, n.options.map((o) => o.plan)]), [['beta', ['ED', 'RD']], ['gamma', []]]);
  assert.equal(months.flatMap((m) => m.events).some((e) => e.title === 'Too old'), false);
  assert.equal(roundChoiceLabel({ plan: 'ED', date: '2026-11-15' }), 'ED · Nov 15');
});

test('today gets its own month when nothing else falls in it', () => {
  const { months } = timeline(workspace({ criticalDates: [{ date: '2027-02-01', label: 'FAFSA', detail: '' }] }), [], TODAY);
  assert.deepEqual(months.map((m) => [m.key, m.todayAt]), [['2026-11', 0], ['2027-02', -1]]);
});
