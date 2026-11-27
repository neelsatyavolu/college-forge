// Recommendation letters per school: whether each portal shows the letter, and what the student owes.
// Plain script so LettersPanel, Progress and the node tests share it. Works on the tracker view the
// hub gets from /api/applications (lib/tracker-service.ts viewApp). iOS ports it in LetterReceipts.swift.
(function (root) {
  // Portal checklist items that are recommendation letters ("Teacher Evaluation", "Secondary School Report").
  var LETTER_ITEM = /\b(teacher|counselor|secondary school|school)\s+(evaluation|report|recommendation)s?\b|\bletters? of rec(ommendation)?\b|\brecommendation letters?\b/i;
  var COUNSELOR_ITEM = /\b(counselors?|school reports?)\b/i;
  var TEACHER_ITEM = /\bteachers?\b/i;
  // Applications that are decided or withdrawn don't need letters chased.
  var CLOSED_STAGES = { admitted: 1, denied: 1, closed: 1 };
  var DAY = 86400000;
  var ASK_WEEKS = 4;
  var NUDGE_DAYS = 10;
  var TITLES = /^(mr|mrs|ms|mx|miss|dr|prof|professor|coach|sr|sra|srta)\.?$/i;

  function isLetterItem(text) { return LETTER_ITEM.test(String(text || "")); }

  function itemType(text) {
    if (COUNSELOR_ITEM.test(text)) return "counselor";
    if (TEACHER_ITEM.test(text)) return "teacher";
    return "other";
  }

  // "Ms. Ana de la Cruz" -> "cruz". Empty when the name has no usable last word.
  function lastName(name) {
    var words = String(name || "").split(/[\s,]+/).map(function (w) { return w.replace(/[^\p{L}'-]/gu, ""); })
      .filter(function (w) { return w && !TITLES.test(w); });
    var last = words.length ? words[words.length - 1].toLowerCase() : "";
    return last.length >= 2 ? last : "";
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function names(text, last) {
    if (!last) return false;
    return new RegExp("(^|[^\\p{L}])" + escapeRe(last) + "($|[^\\p{L}])", "iu").test(text);
  }

  // A letter item counts for this kind of recommender: teachers also take generic "Letter of Recommendation" slots.
  function fits(recType, itemKind) {
    if (recType === "teacher") return itemKind === "teacher" || itemKind === "other";
    return itemKind === recType;
  }

  /**
   * One school's receipt for one recommender. state is "received", "missing", "unclear" or "no portal data".
   * matched "name" when a checklist item names the recommender; "type" when Forge only counted letters
   * of the same type (done of total), without guessing which teacher each one is. A partial count, or
   * fewer slots than same-type recommenders sent there, is "unclear": no nudge and no thank-you from it.
   */
  function schoolReceipt(rec, app, others) {
    var portal = app && app.portal;
    if (!portal || !portal.ok || !Array.isArray(portal.checklist)) return { state: "no portal data" };
    // An empty optional slot ("Optional Teacher Evaluation") isn't a missing letter.
    var letters = portal.checklist.filter(function (c) { return c && isLetterItem(c.item) && !(c.optional && !c.done); });
    var last = lastName(rec.name);
    var named = letters.filter(function (c) { return names(c.item, last); });
    if (named.length) {
      var allIn = named.every(function (c) { return c.done; });
      return { state: allIn ? "received" : "missing", matched: "name", done: named.filter(function (c) { return c.done; }).length, total: named.length };
    }
    var peers = (others || []).filter(function (o) { return o && o.id !== rec.id; });
    var otherLasts = peers.map(function (o) { return lastName(o.name); }).filter(function (l) { return l && l !== last; });
    var sameType = letters.filter(function (c) {
      return !otherLasts.some(function (l) { return names(c.item, l); }) && fits(rec.type, itemType(c.item));
    });
    if (!sameType.length) return { state: "no portal data" };
    var done = sameType.filter(function (c) { return c.done; }).length;
    var sharing = 1 + peers.filter(function (o) {
      return o.type === rec.type && o.status !== "waived" && Array.isArray(o.schools) && o.schools.indexOf(app.id) >= 0;
    }).length;
    var state = done === 0 ? "missing" : done === sameType.length && sameType.length >= sharing ? "received" : "unclear";
    return { state: state, matched: "type", done: done, total: sameType.length };
  }

  /** Per assigned school: { appId, name, deadline, state, matched?, done?, total? }. Unknown app ids are skipped. */
  function receiptFor(rec, tracker, others) {
    var apps = (tracker && tracker.apps) || [];
    var ids = Array.isArray(rec && rec.schools) ? rec.schools : [];
    var out = [];
    ids.forEach(function (id) {
      var app = apps.find(function (a) { return a.id === id; });
      if (!app) return;
      var r = schoolReceipt(rec, app, others);
      out.push(Object.assign({ appId: app.id, name: app.name, deadline: app.deadline || rec.deadline || "", closed: !!CLOSED_STAGES[app.stage] }, r));
    });
    return out;
  }

  function toDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  }
  function isoOf(ms) { return new Date(ms).toISOString().slice(0, 10); }

  /**
   * What the student owes their recommenders, soonest first:
   *  ask    not asked yet; due 4 weeks before the earliest assigned deadline (or the letter's own deadline)
   *  nudge  an assigned school's deadline is within 10 days (or past) and its portal still shows the letter missing
   *  thank  every assigned school shows the letter received (or it's marked submitted and none shows missing)
   */
  function letterTasks(recs, tracker, today) {
    var now = toDay(today);
    var tasks = [];
    (recs || []).forEach(function (rec) {
      if (!rec || rec.status === "waived") return;
      var receipts = receiptFor(rec, tracker, recs);
      var dates = receipts.map(function (r) { return r.deadline; }).concat(rec.deadline ? [rec.deadline] : [])
        .map(toDay).filter(function (d) { return !isNaN(d); });
      if (rec.status === "not_asked") {
        var due = dates.length ? isoOf(Math.min.apply(null, dates) - ASK_WEEKS * 7 * DAY) : "";
        tasks.push({ recId: rec.id, kind: "ask", due: due, overdue: !!due && toDay(due) < now, text: "Ask " + rec.name + " for a letter" });
        return;
      }
      var open = receipts.filter(function (r) { return !r.closed; });
      open.forEach(function (r) {
        var d = toDay(r.deadline);
        if (r.state !== "missing" || isNaN(d) || isNaN(now) || d - now > NUDGE_DAYS * DAY) return;
        tasks.push({ recId: rec.id, kind: "nudge", due: r.deadline, overdue: d < now, appId: r.appId, text: r.name + " doesn't show " + rec.name + "'s letter yet" });
      });
      var allReceived = open.length > 0 && open.every(function (r) { return r.state === "received"; });
      var submittedClean = rec.status === "submitted" && !open.some(function (r) { return r.state === "missing"; });
      if (!rec.thankYouSent && (allReceived || submittedClean)) {
        tasks.push({ recId: rec.id, kind: "thank", due: "", overdue: false, text: "Send " + rec.name + " a thank-you note" });
      }
    });
    var order = { nudge: 0, ask: 1, thank: 2 };
    return tasks.sort(function (a, b) {
      return (a.due || "9999").localeCompare(b.due || "9999") || order[a.kind] - order[b.kind];
    });
  }

  var api = { isLetterItem: isLetterItem, lastName: lastName, receiptFor: receiptFor, letterTasks: letterTasks };
  root.cfRecommenders = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
