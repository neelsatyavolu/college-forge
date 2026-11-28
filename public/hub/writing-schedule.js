// The Timeline tab's writing schedule: target dates to outline, draft and finish every essay still to write,
// working back from each school's deadline at one steady pace so no week is overloaded.
// Plain script so the Timeline tab and the node tests share it.
//
// Rules:
// - The essays are the ones the Essays tab counts (essay-archetypes requiredItems): required prompts and the
//   picks of choose-N sets, without hidden essays or schools the student isn't writing for. Essays marked
//   final drop out, and so do schools whose every application is submitted.
// - Each school's essays finish BUFFER_DAYS before its deadline (timeline-plan schoolDeadline). The Common App
//   personal statement finishes COMMON_LEAD_DAYS before the first non-UC deadline and goes first on ties.
// - Work is measured in words (a character limit counts as limit / 6 words). An essay not started needs an
//   outline (15%), a draft (55%, less what's already written) and a final pass (30%).
// - Essays are written earliest-due first at a steady pace in words a day: the lowest pace that meets the
//   tightest finish-by date, then the lowest for what's left after it (paceTasks). Paces never rise, so no
//   week is busier than one before it, and they stay between MIN_DAILY_WORDS and MAX_DAILY_WORDS. Steps that
//   can't finish in time are marked behind.
(function (root) {
  var plan = root.cfEssayArchetypes || (typeof require === "function" ? require("./essay-archetypes.js") : null);
  var tl = root.cfTimelinePlan || (typeof require === "function" ? require("./timeline-plan.js") : null);

  var BUFFER_DAYS = 3;
  var COMMON_LEAD_DAYS = 7;
  var MIN_DAILY_WORDS = 50;
  var MAX_DAILY_WORDS = 750;
  var STEPS = [["outline", 0.15], ["draft", 0.55], ["final", 0.3]];
  var EPSILON = 1e-9;

  function isCharacters(it) { return /character/i.test((it && it.unit) || ""); }
  function wordsOf(it) { return Math.max(1, Math.round(isCharacters(it) ? (it.limit || 0) / 6 : it.limit || 0)); }
  function written(it, text) {
    var t = String(text || "");
    if (isCharacters(it)) return Array.from(t).length / 6;
    var trimmed = t.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }

  /** Essays groups as the Essays tab builds them: Common App, one UC Application, one per other school. */
  function essayGroups(data) {
    var supplements = (data.essays && data.essays.supplements) || {};
    var chosen = data.essayOption || {};
    var withOption = function (items) { return (items || []).map(function (it) { return plan.withChosenOption(it, chosen[it.id]); }); };
    var groups = [{ key: "common", kind: "common", title: "Common App personal statement", items: withOption(data.essays && data.essays.commonApp), colleges: [] }];
    var byKey = { common: groups[0] };
    (data.colleges || []).forEach(function (c) {
      var key = plan.essayGroupKey(c);
      if (!key) return;
      if (!byKey[key]) {
        var uc = key === "uc-application";
        byKey[key] = { key: key, kind: uc ? "uc" : "school", title: uc ? "UC Application" : plan.schoolTitle(c).title || key, items: withOption(supplements[key]), colleges: [] };
        groups.push(byKey[key]);
      }
      byKey[key].colleges.push(c);
    });
    return groups;
  }

  function stepsFor(it, text, status) {
    var words = wordsOf(it);
    var done = Math.min(words, written(it, text));
    var started = status === "draft" || done > 0;
    var out = [];
    if (!started) out.push({ step: "outline", work: words * STEPS[0][1] });
    var draftLeft = words * STEPS[1][1] * (1 - done / words);
    if (draftLeft > EPSILON) out.push({ step: "draft", work: draftLeft });
    out.push({ step: "final", work: words * STEPS[2][1] });
    return { state: started ? "draft" : "not_started", steps: out };
  }

  /**
   * The pace (words a day) for each task, written earliest-due first: the lowest steady pace that gets the
   * work up to the tightest finish-by date done in time, then the same again for the work after it. Paces only
   * fall over time, so a crunch before an early deadline doesn't pull later schools' essays forward.
   * Returns [{ pace, start, end }] per task, in days from the start of today.
   */
  function paceTasks(tasks, today) {
    var out = [];
    var time = 0;
    var i = 0;
    while (i < tasks.length) {
      var cum = 0;
      var best = -1;
      var bestRate = 0;
      for (var k = i; k < tasks.length; k++) {
        cum += tasks[k].work;
        if (!tasks[k].finishBy) continue;
        var rate = cum / Math.max(1, tl.dayDiff(today, tasks[k].finishBy) + 1 - time);
        if (rate >= bestRate - EPSILON) { best = k; bestRate = rate; }
      }
      // Only work without a deadline is left: the slowest pace.
      if (best < 0) best = tasks.length - 1;
      var pace = Math.min(MAX_DAILY_WORDS, Math.max(MIN_DAILY_WORDS, bestRate));
      for (var j = i; j <= best; j++) {
        var end = time + tasks[j].work / pace;
        out.push({ pace: pace, start: time, end: end });
        time = end;
      }
      i = best + 1;
    }
    return out;
  }

  // The day (0 = today) a task ending `end` days from now is done.
  function dayOf(end) { return Math.max(0, Math.ceil(end - EPSILON) - 1); }

  function weekIndex(day, today) {
    var dow = (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7;
    return day < 7 - dow ? 0 : Math.floor((day - (7 - dow)) / 7) + 1;
  }
  function weekBounds(index, today) {
    var dow = (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7;
    var monday = tl.addDays(today, -dow + 7 * index);
    var first = index === 0 ? 0 : 7 - dow + 7 * (index - 1);
    return { start: monday, end: tl.addDays(monday, 6), firstDay: first, lastDay: 6 - dow + 7 * index };
  }

  function activeColleges(group, apps) {
    return group.colleges.filter(function (c) { return !tl.isSubmitted(tl.appFor(c, apps)); });
  }

  function earliest(list) {
    return list.filter(Boolean).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; })[0] || null;
  }

  /**
   * The plan: { pace (the busiest pace, in words per week), groups, weeks, thisWeek }.
   * groups: [{ key, kind, title, slug, deadline, finishBy, essays, finished }], earliest finish-by first;
   * essays: [{ id, label, limit, unit, state, targets: { outline, draft, final }, behind }].
   * weeks: [{ start, end, words, items: [{ id, groupKey, school, label, steps }] }] from this week on.
   */
  function writingSchedule(data, apps, today) {
    var drafts = data.essayDrafts || {};
    var status = data.essayStatus || {};
    var opts = { hidden: data.essayHidden || {}, commonAppPrompt: data.commonAppPrompt || "", essaySchools: data.essaySchools };
    var groups = [];
    // Every active non-UC school uses the personal statement, with or without supplements of its own, so
    // these are gathered before schools without essays (or opted out of supplements) drop out.
    var commonSchools = 0;
    var commonDeadlines = [];
    essayGroups(data).forEach(function (g, order) {
      var active = g.kind === "common" ? [] : activeColleges(g, apps);
      if (g.kind !== "common" && !active.length) return;
      var deadline = g.kind === "common" ? null : earliest(active.map(function (c) { return tl.schoolDeadline(c, tl.appFor(c, apps), today); }));
      if (g.kind === "school") { commonSchools++; commonDeadlines.push(deadline); }
      if (plan.isSchoolSkipped(g.key, opts)) return;
      var items = plan.requiredItems([g], drafts, status, opts);
      if (!items.length) return;
      groups.push({
        key: g.key, kind: g.kind, title: g.title, order: order,
        slug: g.kind === "school" ? g.colleges[0].slug : null,
        deadline: deadline,
        finishBy: deadline ? maxDate(today, tl.addDays(deadline.date, -BUFFER_DAYS)) : null,
        items: items,
      });
    });
    // The personal statement is shared by every Common App school, so it's due before the first of them.
    var common = groups.find(function (g) { return g.kind === "common"; });
    var firstCommonApp = earliest(commonDeadlines);
    if (common) {
      if (!commonSchools) groups = groups.filter(function (g) { return g !== common; });
      else if (firstCommonApp) common.finishBy = maxDate(today, tl.addDays(firstCommonApp.date, -COMMON_LEAD_DAYS));
    }
    groups.sort(function (a, b) {
      var x = a.finishBy || "9999", y = b.finishBy || "9999";
      return x < y ? -1 : x > y ? 1 : (a.kind === "common" ? -1 : b.kind === "common" ? 1 : a.order - b.order);
    });

    // Supplement prompts usually come out around Aug 1 of the application year, so a student whose deadlines
    // are a year or more away (class of 2028 in 2026-27) starts writing then, not today.
    var earliestDue = earliest(groups.map(function (g) { return g.deadline; }).concat(firstCommonApp ? [firstCommonApp] : []));
    var start = earliestDue ? maxDate(today, seasonStart(earliestDue.date)) : today;

    var tasks = [];
    var shaped = groups.map(function (g) {
      var finished = [];
      var essays = [];
      g.items.forEach(function (it) {
        var label = plan.sidebarLabel(it).text || it.label;
        if (status[it.id] === "final") { finished.push({ id: it.id, label: label }); return; }
        var s = stepsFor(it, drafts[it.id], status[it.id]);
        var essay = { id: it.id, label: label, limit: it.limit, unit: it.unit, state: s.state, targets: {}, behind: false };
        essays.push(essay);
        s.steps.forEach(function (st) { tasks.push({ essay: essay, group: g, step: st.step, work: st.work, finishBy: g.finishBy }); });
      });
      return { key: g.key, kind: g.kind, title: g.title, slug: g.slug, deadline: g.deadline, finishBy: g.finishBy, essays: essays, finished: finished };
    });

    var timing = paceTasks(tasks, start);
    var weeks = {};
    tasks.forEach(function (t, i) {
      var span = timing[i];
      var endDay = dayOf(span.end);
      var target = tl.addDays(start, endDay);
      t.essay.targets[t.step] = target;
      if (t.finishBy && target > t.finishBy) t.essay.behind = true;
      for (var w = weekIndex(dayOf(span.start + EPSILON), start); w <= weekIndex(endDay, start); w++) {
        var b = weekBounds(w, start);
        var share = span.pace * (Math.min(span.end, b.lastDay + 1) - Math.max(span.start, b.firstDay));
        if (share <= EPSILON) continue;
        var week = weeks[w] || (weeks[w] = { start: b.start, end: b.end, words: 0, items: [] });
        week.words += share;
        var item = week.items.find(function (x) { return x.id === t.essay.id; });
        if (!item) week.items.push(item = { id: t.essay.id, groupKey: t.group.key, school: t.group.title, label: t.essay.label, steps: [] });
        item.steps.push({ step: t.step, by: target });
      }
    });
    var weekList = Object.keys(weeks).map(Number).sort(function (a, b) { return a - b; }).map(function (k) {
      return Object.assign({}, weeks[k], { index: k, words: Math.round(weeks[k].words) });
    });
    var later = start > today;
    var thisWeek = !later && weekList[0] && weekList[0].index === 0 ? weekList[0] : Object.assign({ index: 0, words: 0, items: [] }, weekBounds(0, today));
    var peak = timing.reduce(function (m, s) { return Math.max(m, s.pace); }, 0);
    return { pace: Math.round(peak * 7), groups: shaped, weeks: weekList, thisWeek: thisWeek, startsOn: later ? start : null };
  }

  function maxDate(a, b) { return a > b ? a : b; }
  /** Aug 1 of the application season a deadline belongs to (a Jan 5 deadline's season began the August before). */
  function seasonStart(date) {
    var y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
    return (m >= 8 ? y : y - 1) + "-08-01";
  }

  var api = { writingSchedule: writingSchedule, BUFFER_DAYS: BUFFER_DAYS, COMMON_LEAD_DAYS: COMMON_LEAD_DAYS, MIN_DAILY_WORDS: MIN_DAILY_WORDS, MAX_DAILY_WORDS: MAX_DAILY_WORDS };
  root.cfWritingSchedule = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
