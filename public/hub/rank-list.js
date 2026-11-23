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

  function ranksOf(s) {
    return {
      usn: (s.usn && s.usn.rank) || null,
      // U.S. News ranks liberal arts colleges on their own list, so that number
      // isn't on the same scale as a university's. Niche and Forbes rank both together.
      lac: !!(s.usn && s.usn.lac),
      niche: (s.niche && s.niche.rank) || null,
      forbes: s.forbes || null,
    };
  }

  /** Every app with its ranks and their average, best first; schools with no rank go last. */
  function rankList(apps, schools) {
    var rows = apps.map(function (app) {
      var school = matchSchool(app.name, schools);
      var ranks = school ? ranksOf(school) : { usn: null, lac: false, niche: null, forbes: null };
      var have = [ranks.lac ? null : ranks.usn, ranks.niche, ranks.forbes].filter(function (r) { return r != null; });
      var avg = have.length ? have.reduce(function (a, b) { return a + b; }, 0) / have.length : null;
      return { app: app, ranks: ranks, avg: avg };
    });
    return rows.sort(function (a, b) {
      if (a.avg == null || b.avg == null) return a.avg == null ? (b.avg == null ? a.app.name.localeCompare(b.app.name) : 1) : -1;
      return a.avg - b.avg || a.app.name.localeCompare(b.app.name);
    });
  }

  var api = { matchSchool: matchSchool, rankList: rankList };
  root.cfRankList = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
