const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true } }).outputText, file);

const s = require('../lib/check-schedule.ts');
const sched = (everyHours, startHour, timeZone = 'America/Los_Angeles') => ({ everyHours, startHour, timeZone });
const H = 3600 * 1000;

test('slot times follow the frequency and start hour, wrapping past midnight', () => {
  assert.deepEqual(s.slotTimes(sched(8, 7)), [7, 15, 23]);
  assert.deepEqual(s.slotTimes(sched(12, 7)), [7, 19]);
  assert.deepEqual(s.slotTimes(sched(24, 7)), [7]);
  assert.deepEqual(s.slotTimes(sched(8, 20)), [4, 12, 20]);
  assert.deepEqual(s.describeSchedule(sched(8, 7), Date.UTC(2026, 0, 10, 12)).times, ['07:00', '15:00', '23:00']);
});

test('latest and next slot in Los Angeles across a day boundary', () => {
  // 2026-01-10 06:30 PST = 14:30Z. Every 8 h from 7: the latest slot is 2026-01-09 23:00 PST = 2026-01-10 07:00Z.
  const now = Date.UTC(2026, 0, 10, 14, 30);
  assert.equal(s.latestSlot(sched(8, 7), now), Date.UTC(2026, 0, 10, 7));
  assert.equal(s.nextSlot(sched(8, 7), now), Date.UTC(2026, 0, 10, 15));
  // Exactly on a slot counts as that slot.
  assert.equal(s.latestSlot(sched(8, 7), Date.UTC(2026, 0, 10, 15)), Date.UTC(2026, 0, 10, 15));
});

test('half-hour offsets (Asia/Kolkata) land on the local hour', () => {
  // 07:00 IST = 01:30Z.
  const now = Date.UTC(2026, 0, 10, 2);
  assert.equal(s.latestSlot(sched(24, 7, 'Asia/Kolkata'), now), Date.UTC(2026, 0, 10, 1, 30));
  assert.equal(s.nextSlot(sched(24, 7, 'Asia/Kolkata'), now), Date.UTC(2026, 0, 11, 1, 30));
});

test('DST spring forward: a skipped hour runs at the next real hour, once', () => {
  // 2026-03-08 in LA: 02:00 PST jumps to 03:00 PDT (10:00Z). A 2:00 slot runs at 03:00 PDT.
  const day = sched(24, 2);
  assert.equal(s.nextSlot(day, Date.UTC(2026, 2, 8, 8)), Date.UTC(2026, 2, 8, 10));
  // Every-8 from 7 that day: 07:00 PDT (14:00Z), 15:00 PDT, 23:00 PDT; none duplicated or skipped.
  const slots = [];
  let t = Date.UTC(2026, 2, 8, 0);
  for (let i = 0; i < 4; i++) { t = s.nextSlot(sched(8, 7), t); slots.push(t); }
  assert.deepEqual(slots, [Date.UTC(2026, 2, 8, 7), Date.UTC(2026, 2, 8, 14), Date.UTC(2026, 2, 8, 22), Date.UTC(2026, 2, 9, 6)]);
});

test('DST fall back: a repeated hour runs once', () => {
  // 2026-11-01 in LA: 01:00 happens at 08:00Z (PDT) and again at 09:00Z (PST).
  const day = sched(24, 1);
  const first = s.nextSlot(day, Date.UTC(2026, 10, 1, 7));
  assert.equal(first, Date.UTC(2026, 10, 1, 8));
  assert.equal(s.nextSlot(day, first), Date.UTC(2026, 10, 2, 9));
  assert.equal(s.latestSlot(day, Date.UTC(2026, 10, 1, 9, 30)), first);
});

test('DST fall back east of UTC (Berlin) also picks the first occurrence', () => {
  // 2026-10-25: 02:00 local happens at 00:00Z (CEST) and again at 01:00Z (CET).
  assert.equal(s.nextSlot(sched(24, 2, 'Europe/Berlin'), Date.UTC(2026, 9, 24, 23)), Date.UTC(2026, 9, 25, 0));
  // Spring forward 2026-03-29: 02:00 doesn't exist; it runs at 03:00 CEST (01:00Z).
  assert.equal(s.nextSlot(sched(24, 2, 'Europe/Berlin'), Date.UTC(2026, 2, 28, 23)), Date.UTC(2026, 2, 29, 1));
});

test('time zones are stored in their canonical spelling', () => {
  assert.equal(s.normalizeSchedule({ timeZone: 'america/new_york' }).timeZone, 'America/New_York');
});

test('normalizeSchedule falls back to defaults for bad values', () => {
  assert.deepEqual(s.normalizeSchedule(undefined), { everyHours: 12, startHour: 7, timeZone: 'America/Los_Angeles' });
  assert.deepEqual(s.normalizeSchedule({ everyHours: 5, startHour: 24, timeZone: 'Mars/Base' }), { everyHours: 12, startHour: 7, timeZone: 'America/Los_Angeles' });
  assert.deepEqual(s.normalizeSchedule({ everyHours: 8, startHour: 0, timeZone: 'Europe/London' }), { everyHours: 8, startHour: 0, timeZone: 'Europe/London' });
  assert.equal(s.normalizeSchedule({ startHour: 3.5 }).startHour, 7);
});

test('isTimeZone accepts IANA names and rejects the rest', () => {
  assert.equal(s.isTimeZone('America/New_York'), true);
  assert.equal(s.isTimeZone('Not/AZone'), false);
  assert.equal(s.isTimeZone(''), false);
  assert.equal(s.isTimeZone('x'.repeat(65)), false);
  assert.equal(s.isTimeZone(42), false);
  assert.ok(Math.abs(s.nextSlot(sched(12, 7), 0) - 0) <= 12 * H);
});
