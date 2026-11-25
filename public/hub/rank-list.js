// The List tab: applications ordered by the average of their U.S. News, Niche
// and Forbes ranks from /data/career-ranking.json.
// Plain script so the List tab and the node tests share it.
(function (root) {
  // Campus suffixes in the ranking file's full names ("Ohio State University-Main Campus").
  var CAMPUS = / (main campus|campus immersion|pittsburgh campus|seattle campus)$/;

  function norm(name) {
    return String(name || "").toLowerCase()
      .replace(/[‐-―-]/g, " ")
      .replace(/[.,'’]/g, "")
      .replace(/\b(the|at)\b/g, " ")
      .replace(/\s+/g, " ").trim();
  }

  /** The ranking school for an application name, or null when none or several fit. */
  function matchSchool(appName, schools) {
    var n = norm(appName);
    if (!n) return null;
    var exact = schools.filter(function (s) { return norm(s.name) === n || norm(s.full).replace(CAMPUS, "") === n; });
    if (exact.length === 1) return exact[0];
    // "University of Michigan" for "University of Michigan-Ann Arbor".
    var prefix = schools.filter(function (s) { return norm(s.full).indexOf(n + " ") === 0; });
    return prefix.length === 1 ? prefix[0] : null;
  }

  function ranksOf(s, toNational) {
    var usn = (s.usn && s.usn.rank) || null;
    var lac = !!(s.usn && s.usn.lac);
    return {
      usn: usn,
      // U.S. News ranks liberal arts colleges on their own list, so that number
      // isn't on the same scale as a university's. Niche and Forbes rank both together.
      lac: lac,
      // The national-list rank the LAC rank links to; null when it can't be linked.
      usnNational: lac ? (usn && toNational ? toNational(usn) : null) : usn,
      niche: (s.niche && s.niche.rank) || null,
      forbes: s.forbes || null,
    };
  }

  function nicheForbes(s) {
    var v = [s.niche && s.niche.rank, s.forbes].filter(function (r) { return r; });
    return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null;
  }

  // Reduced major axis fit of log(anchor) on log(rank): the symmetric line
  // concordance tables use, which doesn't shrink a weak fit toward the middle.
  function logLine(pairs) {
    var n = pairs.length;
    if (n < 3) return null;
    var xs = pairs.map(function (p) { return Math.log(p[0]); });
    var ys = pairs.map(function (p) { return Math.log(p[1]); });
    var mx = xs.reduce(function (a, b) { return a + b; }, 0) / n;
    var my = ys.reduce(function (a, b) { return a + b; }, 0) / n;
    var sxx = 0, syy = 0, sxy = 0;
    for (var i = 0; i < n; i++) { sxx += (xs[i] - mx) * (xs[i] - mx); syy += (ys[i] - my) * (ys[i] - my); sxy += (xs[i] - mx) * (ys[i] - my); }
    if (!sxx || !syy || sxy <= 0) return null;
    var b = Math.sqrt(syy / sxx);
    return { a: my - b * mx, b: b };
  }

  /**
   * Turns a U.S. News liberal arts rank into the national-university rank at the
   * same standing. Niche and Forbes rank both kinds of school on one list, so
   * their average is the common yardstick: fit how each U.S. News list tracks it
   * across every school in the ranking file, then read the LAC rank's yardstick
   * value back through the national line. Null when either list is too thin.
   */
  function lacLink(schools) {
    var lac = [], nat = [];
    schools.forEach(function (s) {
      var anchor = nicheForbes(s);
      if (!s.usn || !s.usn.rank || anchor == null) return;
      (s.usn.lac ? lac : nat).push([s.usn.rank, anchor]);
    });
    var L = logLine(lac), N = logLine(nat);
    if (!L || !N) return null;
    return function (rank) { return Math.exp((L.a + L.b * Math.log(rank) - N.a) / N.b); };
  }

  /**
   * Schools from /data/official-rankings.json in the career file's shape, for
   * applications the career file doesn't cover. Each U.S. News entry carries its
   * Forbes and Niche ranks; Forbes and Niche entries add schools off U.S. News.
   */
  function officialSchools(data) {
    var lists = (data && data.lists) || {};
    var out = [];
    function add(e, usn, lac, niche, forbes) {
      out.push({ name: e.name, full: e.name, usn: usn ? { rank: usn, lac: lac } : null, niche: niche ? { rank: niche } : null, forbes: forbes || null });
    }
    ["usn", "lac"].forEach(function (k) {
      (lists[k] || []).forEach(function (e) { var o = e.elsewhere || {}; add(e, e.rank, k === "lac", o.niche, o.forbes); });
    });
    (lists.forbes || []).forEach(function (e) {
      var o = e.elsewhere || {};
      if (!o.usn && !o.lac) add(e, null, false, o.niche, e.rank);
    });
    (lists.niche || []).forEach(function (e) {
      var o = e.elsewhere || {};
      if (!o.usn && !o.lac && !o.forbes) add(e, null, false, e.rank, null);
    });
    return out;
  }

  /** Every app with its ranks and their average, best first; schools with no rank go last.
   * A liberal arts college's U.S. News rank counts as its linked national rank.
   * Apps the career file doesn't cover are looked up in `fallback` (officialSchools). */
  function rankList(apps, schools, fallback) {
    var toNational = lacLink(schools);
    var rows = apps.map(function (app) {
      var school = matchSchool(app.name, schools) || (fallback ? matchSchool(app.name, fallback) : null);
      var ranks = school ? ranksOf(school, toNational) : { usn: null, lac: false, usnNational: null, niche: null, forbes: null };
      var have = [ranks.usnNational, ranks.niche, ranks.forbes].filter(function (r) { return r != null; });
      var avg = have.length ? have.reduce(function (a, b) { return a + b; }, 0) / have.length : null;
      return { app: app, ranks: ranks, avg: avg };
    });
    return rows.sort(function (a, b) {
      if (a.avg == null || b.avg == null) return a.avg == null ? (b.avg == null ? a.app.name.localeCompare(b.app.name) : 1) : -1;
      return a.avg - b.avg || a.app.name.localeCompare(b.app.name);
    });
  }

  var UC_NAME = /^(university of california|uc )/i;
  // Restrictive early action is still early action for this list.
  var ROUND_LABEL = { ED: "ED1", ED2: "ED2", EA: "EA", REA: "EA", RD: "RD", Rolling: "Rolling" };

  /** "Cornell University - ED1", one line per school in list order; UC campuses say "UC". */
  function copyText(rows) {
    return rows.map(function (r) {
      var round = UC_NAME.test(r.app.name) ? "UC" : ROUND_LABEL[r.app.round] || "";
      return round ? r.app.name + " - " + round : r.app.name;
    }).join("\n");
  }

  var api = { matchSchool: matchSchool, rankList: rankList, officialSchools: officialSchools, copyText: copyText, lacLink: lacLink };
  root.cfRankList = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
