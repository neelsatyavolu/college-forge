// The Timeline tab's dated events: each school's chosen-round deadline (other rounds muted), the student's
// milestones and decision dates, grouped by month with today marked.
// Plain script so the Timeline tab, the writing schedule and the node tests share it.
(function (root) {
  var deadlinePlan = root.cfDeadlinePlan || (typeof require === "function" ? require("./deadline-plan.js") : null);

  var DATE = /^\d{4}-\d{2}-\d{2}$/;
  // Past dates this many days back stay on the timeline, de-emphasized.
  var PAST_DAYS = 45;
  var APPLICATION_ROUNDS = { ED: 1, REA: 1, EA: 1, RD: 1, Rolling: 1, Priority: 1 };
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  // Same day: deadlines first, then milestones, then decisions.
  var KIND_ORDER = { deadline: 0, related: 1, aid: 1, scholarship: 1, task: 2, "other-round": 3, milestone: 4, decision: 5 };

  function isDate(s) { return DATE.test(String(s || "")); }
  function addDays(iso, n) {
    var d = new Date(iso + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function dayDiff(from, to) { return Math.round((Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) / 86400000); }
  function shortDate(iso) {
    var p = iso.split("-");
    return MONTHS[Number(p[1]) - 1].slice(0, 3) + " " + Number(p[2]);
  }
  function monthKey(iso) { return iso.slice(0, 7); }
  function monthLabel(key) { return MONTHS[Number(key.slice(5, 7)) - 1] + " " + key.slice(0, 4); }

  function isApplicationRound(plan) { return !!APPLICATION_ROUNDS[deadlinePlan.deadlineTone(plan).label]; }
  /** The round label in "EA · Nov 1", or "" when the student hasn't picked one. */
  function roundLabel(college) { return String((college && college.deadline) || "").split("·")[0].trim(); }

  /** The tracked application for a list school: by slug, else by name. */
  function appFor(college, apps) {
    return (apps || []).find(function (a) { return (a.slug && a.slug === college.slug) || (!a.slug && a.name === college.name); }) || null;
  }
  function isSubmitted(app) { return !!(app && app.stage && app.stage !== "working"); }

  /**
   * The application deadline the student is working toward at one school:
   * the chosen round's date, else the tracked application's own round and deadline, else (assumed: true)
   * the earliest upcoming round so the writing schedule still has something to aim at.
   */
  function schoolDeadline(college, app, today) {
    var all = ((college && college.deadlines) || []).filter(function (d) { return d && isDate(d.date) && isApplicationRound(d.plan); });
    if (roundLabel(college)) {
      var chosen = deadlinePlan.planDeadlines(college).filter(function (d) { return d && isDate(d.date) && isApplicationRound(d.plan); });
      if (chosen.length) {
        var upcoming = chosen.filter(function (d) { return d.date >= today; }).sort(byDate);
        var pick = upcoming[0] || chosen.slice().sort(byDate)[chosen.length - 1];
        return { date: pick.date, plan: pick.plan, assumed: false };
      }
    }
    if (app && isDate(app.deadline)) return { date: app.deadline, plan: app.round || "Deadline", assumed: false };
    var next = all.filter(function (d) { return d.date >= today; }).sort(byDate)[0];
    return next ? { date: next.date, plan: next.plan, assumed: true } : null;
  }
  function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }
  function hasChosenRound(college, app) {
    return !!(roundLabel(college) && deadlinePlan.planDeadlines(college).some(function (d) { return isDate(d.date); })) || !!(app && isDate(app.deadline));
  }

  /**
   * One school's dated events. Aid and scholarship dates the student opted out of are left out; the rest get
   * their own kind ("aid", "scholarship") with the form they're for, apart from the admission rounds.
   */
  function schoolEvents(college, app, data) {
    var name = college.short || college.name || college.slug;
    var done = isSubmitted(app);
    // Denied, withdrawn, or the student skips aid at this school (Recs & aid): no aid forms to file there.
    var stopped = !!(app && (app.stage === "closed" || app.stage === "denied" || app.ignoreAid));
    var events = [];
    var all = ((college.deadlines) || []).filter(function (d) { return d && isDate(d.date) && deadlinePlan.showsDeadline(d.plan, data); });
    var picked = roundLabel(college) ? deadlinePlan.planDeadlines(college) : [];
    all.forEach(function (d) {
      var inRound = picked.indexOf(d) >= 0;
      var aid = deadlinePlan.aidKind(d.plan);
      // An aid date counts until a round is picked; after that only the ones that go with that round.
      var kind = aid && (inRound || !picked.length) ? aid : !inRound ? "other-round" : isApplicationRound(d.plan) ? "deadline" : "related";
      if (kind === aid && stopped) return;
      // Sending the application meets its deadline only; materials and aid forms in that round stay open.
      var ev = { date: d.date, kind: kind, title: name, sub: d.plan, tone: deadlinePlan.deadlineTone(d.plan).label, slug: college.slug, done: done && kind === "deadline" };
      if (kind === aid) ev.form = deadlinePlan.aidForm(d.plan);
      events.push(ev);
    });
    if (!picked.length && app && isDate(app.deadline)) {
      events.push({ date: app.deadline, kind: "deadline", title: name, sub: app.round || "Application deadline", tone: deadlinePlan.deadlineTone(app.round || "RD").label, slug: college.slug, done: done });
    }
    return events;
  }

  var OPEN_SCHOLARSHIP = { researching: 1, in_progress: 1 };
  var OPEN_LETTER = { not_asked: 1, asked: 1, in_progress: 1 };
  /**
   * The student's own dated to-dos (kind "task"), each linking to where it's managed: open scholarships and
   * recommendation letters (Recs & aid), and follow-ups on applications still in play (Progress).
   */
  function ownEvents(data, apps) {
    var out = [];
    ((data && data.scholarships) || []).forEach(function (s) {
      if (s && OPEN_SCHOLARSHIP[s.status] && isDate(s.deadline)) out.push({ date: s.deadline, kind: "task", title: "Scholarship: " + s.name, sub: s.amount || "", href: "#track", label: "Scholarship", slug: null, done: false });
    });
    ((data && data.recommendations) || []).forEach(function (r) {
      if (r && OPEN_LETTER[r.status] && isDate(r.deadline)) out.push({ date: r.deadline, kind: "task", title: "Letter: " + r.name, sub: r.type ? r.type + " recommendation" : "", href: "#track", label: "Letter", slug: null, done: false });
    });
    (apps || []).forEach(function (a) {
      if (!a || a.stage === "closed" || a.stage === "denied") return;
      (a.followUps || []).forEach(function (f) {
        if (f && !f.done && isDate(f.due)) out.push({ date: f.due, kind: "task", title: a.name, sub: f.text, href: "#progress", label: "To-do", slug: null, done: false });
      });
    });
    return out;
  }

  function decisionEvent(app, college) {
    var d = app.decisionDate;
    var date = d && (typeof d === "string" ? d : d.date);
    if (!isDate(date) || !(app.stage === "working" || app.stage === "waiting")) return null;
    return {
      date: date, kind: "decision", title: (college && (college.short || college.name)) || app.name,
      sub: d.estimated ? "Decision (estimated from last year)" : "Decision released", slug: (college && college.slug) || app.slug || null, done: false,
    };
  }

  /**
   * Everything dated from PAST_DAYS ago onward, by month, plus the schools still waiting on a round.
   * Returns { months: [{ key, label, events, todayAt }], needsRound: [{ slug, title, options }] }:
   * todayAt is where the today marker sits in a month's events (-1 when today is in another month).
   */
  function timeline(data, apps, today) {
    var colleges = (data && data.colleges) || [];
    var events = [];
    var needsRound = [];
    var seenApps = [];
    colleges.forEach(function (c) {
      if (!c || !c.slug) return;
      var app = appFor(c, apps);
      if (app) seenApps.push(app);
      events = events.concat(schoolEvents(c, app, data));
      if (!hasChosenRound(c, app) && !isSubmitted(app)) {
        var options = ((c.deadlines) || []).filter(function (d) { return d && isDate(d.date) && isApplicationRound(d.plan); });
        needsRound.push({ slug: c.slug, title: c.short || c.name || c.slug, options: options.slice().sort(byDate) });
      }
    });
    (apps || []).forEach(function (a) {
      var college = colleges.find(function (c) { return appFor(c, [a]) === a; }) || null;
      var ev = decisionEvent(a, college);
      if (ev) events.push(ev);
      // An application not on the list still has its own deadline.
      if (!college && isDate(a.deadline)) events.push({ date: a.deadline, kind: "deadline", title: a.name, sub: a.round || "Application deadline", tone: deadlinePlan.deadlineTone(a.round || "RD").label, slug: null, done: isSubmitted(a) });
    });
    events = events.concat(ownEvents(data, apps));
    ((data && data.criticalDates) || []).forEach(function (m) {
      if (m && isDate(m.date)) events.push({ date: m.date, kind: "milestone", title: m.label, sub: m.detail || "", mine: m.source === "student", slug: null, done: false });
    });
    var from = addDays(today, -PAST_DAYS);
    var shown = events.filter(function (e) { return e.date >= from; }).map(function (e) { return Object.assign({}, e, { past: e.date < today }); });
    shown.sort(function (a, b) { return byDate(a, b) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || String(a.title).localeCompare(String(b.title)); });
    var months = [];
    shown.forEach(function (e) {
      var key = monthKey(e.date);
      var last = months[months.length - 1];
      if (last && last.key === key) last.events.push(e); else months.push({ key: key, label: monthLabel(key), events: [e] });
    });
    var todayKey = monthKey(today);
    if (!months.some(function (m) { return m.key === todayKey; })) {
      var at = months.filter(function (m) { return m.key < todayKey; }).length;
      months.splice(at, 0, { key: todayKey, label: monthLabel(todayKey), events: [] });
    }
    months = months.map(function (m) {
      if (m.key !== todayKey) return Object.assign({}, m, { todayAt: -1 });
      return Object.assign({}, m, { todayAt: m.events.filter(function (e) { return e.date < today; }).length });
    });
    var aid = shown.filter(function (e) { return e.kind === "aid" || e.kind === "scholarship"; });
    return { months: months, needsRound: needsRound, aid: aid };
  }

  /** The label a college keeps for its chosen round ("EA · Nov 1"), as lib/application-rounds.ts writes it. */
  function roundChoiceLabel(deadline) { return deadline.plan + " · " + shortDate(deadline.date); }

  var api = {
    timeline: timeline,
    schoolDeadline: schoolDeadline,
    appFor: appFor,
    isSubmitted: isSubmitted,
    roundChoiceLabel: roundChoiceLabel,
    addDays: addDays,
    dayDiff: dayDiff,
    shortDate: shortDate,
  };
  root.cfTimelinePlan = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
