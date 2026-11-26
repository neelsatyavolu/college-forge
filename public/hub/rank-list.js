// The List tab: applications ordered by a weighted average of their U.S. News,
// Forbes, Niche, WSJ and Princeton Review ranks (/data/career-ranking.json and
// /data/official-rankings.json).
// Plain script so the List tab and the node tests share it.
(function (root) {
  /**
   * How much each list counts, fixed before looking at any school's result.
   * U.S. News and Forbes: broad coverage, mostly outcome data, stable year to year.
   * Niche: broad, but a large share comes from student reviews, so it leans on popularity.
   * WSJ/College Pulse: outcome-heavy, but its salary measure is "above what we'd predict for
   * these students", which rewards some narrow schools (Babson #2) more than overall strength,
   * it moves a lot year to year, and only its top 100 is public.
   * Princeton Review Best Value: a cost-and-aid value rating, not an overall ranking, ranked
   * separately for public and private schools and only to 50, so it counts least.
   */
  var WEIGHTS = { usn: 1, forbes: 1, niche: 0.75, wsj: 0.5, pr: 0.25 };

  // Campus suffixes in the ranking file's full names ("Ohio State University-Main Campus").
  var CAMPUS = / (main campus|campus immersion|pittsburgh campus|seattle campus)$/;
  // The campus a system's bare name means.
  var FLAGSHIP = /^(new brunswick|main campus|ann arbor|twin cities|college station|university park|columbus|west lafayette|urbana champaign|college park|chapel hill|amherst|austin|madison|seattle|pittsburgh|storrs|knoxville|columbia|athens|norman|lincoln|lawrence|boulder)$/;
    var CAMPUS_SUFFIX = /[-,]\s*(main campus|campus immersion|pittsburgh campus|seattle campus)$/i;

  function norm(name) {
    return String(name || "").normalize("NFD").replace(/[\u0300-\u036f\u02bb]/g, "").toLowerCase()
      .replace(/[‐-―-]/g, " ")
      .replace(/[.,'’]/g, "")
      .replace(/\b(the|at)\b/g, " ")
      .replace(/\s+/g, " ").trim();
  }

  // Nicknames students write, as the lists spell them.
  var NICKNAMES = [
    [/^cal poly pomona$/, "california state polytechnic university pomona"],
    [/^cal poly( san luis obispo| slo)?$/, "california polytechnic state university san luis obispo"],
    [/^cal poly humboldt$/, "california state polytechnic university humboldt"],
    [/^cal state (la|los angeles)$/, "california state university los angeles"],
    [/^(cal state|csu) (.+)$/, "california state university $2"],
    [/^(chico|fresno|sacramento|stanislaus) state$/, "california state university $1"],
    [/^umass (.+)$/, "university of massachusetts $1"],
    [/^unc (.+)$/, "university of north carolina $1"],
    [/^umbc$/, "university of maryland baltimore county"],
  ];

  /** The ranking school for an application name, or null when none or several fit. */
  function matchSchool(appName, schools) {
    var hit = matchName(norm(appName), schools);
    if (hit) return hit;
    for (var i = 0; i < NICKNAMES.length; i++) {
      var n = norm(appName);
      if (NICKNAMES[i][0].test(n)) return matchName(n.replace(NICKNAMES[i][0], NICKNAMES[i][1]), schools);
    }
    return null;
  }

  function matchName(n, schools) {
    if (!n) return null;
    var exact = schools.filter(function (s) { return norm(s.name) === n || norm(s.full).replace(CAMPUS, "") === n; });
    if (exact.length === 1) return exact[0];
    // "University of Michigan" for "University of Michigan-Ann Arbor".
    var prefix = schools.filter(function (s) { return norm(s.full).indexOf(n + " ") === 0; });
    if (prefix.length === 1) return prefix[0];
    // "Rutgers University" fits New Brunswick, Newark and Camden: the flagship campus is meant.
    var flagship = prefix.filter(function (s) { return FLAGSHIP.test(norm(s.full).slice(n.length + 1)); });
    return flagship.length === 1 ? flagship[0] : null;
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
   * The U.S. News national-university line: how its rank tracks the common
   * yardstick (the Niche/Forbes average, since both rank every kind of school
   * on one list) across the ranking file. Null when too few schools have both.
   */
  function nationalLine(schools) {
    var nat = [];
    schools.forEach(function (s) {
      var anchor = nicheForbes(s);
      if (s.usn && s.usn.rank && !s.usn.lac && anchor != null) nat.push([s.usn.rank, anchor]);
    });
    return logLine(nat);
  }

  /**
   * Turns a rank on another list into the U.S. News national rank at the same
   * standing: fit how that list tracks the yardstick, then read the yardstick
   * value back through the national line. Null when either line is too thin.
   */
  function linkThrough(pairs, N) {
    var L = logLine(pairs);
    if (!L || !N) return null;
    return function (rank) { return Math.exp((L.a + L.b * Math.log(rank) - N.a) / N.b); };
  }

  /** A U.S. News liberal arts rank as the national rank at the same standing. */
  function lacLink(schools) {
    var lac = [];
    schools.forEach(function (s) {
      var anchor = nicheForbes(s);
      if (s.usn && s.usn.lac && s.usn.rank && anchor != null) lac.push([s.usn.rank, anchor]);
    });
    return linkThrough(lac, nationalLine(schools));
  }

  /** A name without its campus or city: "Purdue University—West Lafayette" → "Purdue University". */
  function baseOf(name) {
    return String(name || "").replace(CAMPUS_SUFFIX, "").replace(/\s*(,|—|–| - |-| at | in ).*$/i, "");
  }

  /**
   * A list's rank for a school; null when it isn't on the list or more than one entry fits.
   * Names match exactly: a full name against an entry's full or campus-less name, or a
   * campus-less name against an entry's full name, never two campus-less names (UNC Charlotte
   * must not take Chapel Hill's rank). A short name ("Georgia") only matches a full entry exactly.
   */
  function rankOn(list, school, appName) {
    if (!list || !list.length) return null;
    var names = [appName, school && school.full].filter(Boolean);
    var full = names.map(function (n) { return norm(String(n).replace(CAMPUS_SUFFIX, "")); });
    var base = names.map(function (n) { return norm(baseOf(n)); });
    var short = school && school.name ? norm(school.name) : "";
    var hits = list.filter(function (e) {
      var ef = norm(e.name), eb = norm(baseOf(e.name));
      return full.indexOf(ef) >= 0 || full.indexOf(eb) >= 0 || base.indexOf(ef) >= 0 || (!!short && short === ef);
    });
    return hits.length === 1 ? hits[0].rank : null;
  }

  /**
   * Princeton Review ranks its public and private schools on separate lists, so
   * each one is linked to the national scale on its own, like a LAC rank.
   */
  function prLinks(schools, extra) {
    var N = nationalLine(schools);
    var out = {};
    ["prPublic", "prPrivate"].forEach(function (id) {
      var pairs = [];
      schools.forEach(function (s) {
        var r = rankOn(extra[id], s, null);
        var anchor = nicheForbes(s);
        if (r != null && anchor != null) pairs.push([r, anchor]);
      });
      out[id] = linkThrough(pairs, N);
    });
    return out;
  }

  function weightedAverage(parts) {
    var sum = 0, w = 0;
    parts.forEach(function (p) { if (p[0] != null) { sum += p[0] * p[1]; w += p[1]; } });
    return { avg: w ? sum / w : null, weight: w };
  }

  /**
   * Schools from /data/official-rankings.json in the career file's shape, for
   * applications the career file doesn't cover: the merged full lists (every U.S. News
   * national and liberal arts school, Forbes's 500, Niche's list) when present, else
   * the top-100 lists with their cross-references.
   */
  function officialSchools(data) {
    // The full lists merged across publishers, when the data file has them.
    var all = data && data.extra && data.extra.schools;
    if (all && all.length) {
      return all.map(function (e) {
        var usn = e.usn ? { rank: e.usn, lac: false } : e.lac ? { rank: e.lac, lac: true } : null;
        return { name: e.name, full: e.name, usn: usn, niche: e.niche ? { rank: e.niche } : null, forbes: e.forbes || null };
      });
    }
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

  /** Every app with its ranks and their weighted average, best first; schools with no rank go last.
   * A liberal arts college's U.S. News rank counts as its linked national rank, and so does a
   * Princeton Review rank. Apps the career file doesn't cover are looked up in `fallback`
   * (officialSchools). `extra` is official-rankings.json's extra lists (WSJ, Princeton Review). */
  function rankList(apps, schools, fallback, extra) {
    var toNational = lacLink(schools);
    var ex = extra || {};
    var pr = prLinks(schools, ex);
    var rows = apps.map(function (app) {
      var school = matchSchool(app.name, schools) || (fallback ? matchSchool(app.name, fallback) : null);
      var ranks = school ? ranksOf(school, toNational) : { usn: null, lac: false, usnNational: null, niche: null, forbes: null };
      ranks.wsj = rankOn(ex.wsj, school, app.name);
      ranks.pr = null;
      ["prPublic", "prPrivate"].forEach(function (id) {
        var r = ranks.pr ? null : rankOn(ex[id], school, app.name);
        if (r != null) ranks.pr = { rank: r, kind: id === "prPublic" ? "public" : "private", national: pr[id] ? pr[id](r) : null };
      });
      var wa = weightedAverage([
        [ranks.usnNational, WEIGHTS.usn], [ranks.niche, WEIGHTS.niche], [ranks.forbes, WEIGHTS.forbes],
        [ranks.wsj, WEIGHTS.wsj], [ranks.pr && ranks.pr.national, WEIGHTS.pr],
      ]);
      return { app: app, ranks: ranks, avg: wa.avg, weight: wa.weight };
    });
    return rows.sort(function (a, b) {
      if (a.avg == null || b.avg == null) return a.avg == null ? (b.avg == null ? a.app.name.localeCompare(b.app.name) : 1) : -1;
      return a.avg - b.avg || a.app.name.localeCompare(b.app.name);
    });
  }

  /** Schools need this much list weight (U.S. News plus Niche, say) to get a Forge rank; one list alone is too thin. */
  var FORGE_MIN_WEIGHT = 1.5;

  /**
   * The Forge ranking: every school on the official lists, ordered by the List tab's
   * weighted average. Schools within 0.05 of each other share a rank.
   * Returns [{rank, name, avg, ranks}] best first.
   */
  function forgeRanking(data) {
    var schools = officialSchools(data);
    var apps = schools.map(function (s, i) { return { id: i, name: s.name }; });
    var rows = rankList(apps, schools, null, (data && data.extra) || {})
      .filter(function (r) { return r.avg != null && r.weight >= FORGE_MIN_WEIGHT; });
    var out = [];
    rows.forEach(function (r, i) {
      var prev = out[i - 1];
      var rank = prev && Math.abs(prev.avg - r.avg) < 0.05 ? prev.rank : i + 1;
      out.push({ rank: rank, name: r.app.name, avg: Math.round(r.avg * 10) / 10, ranks: r.ranks });
    });
    return out;
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

  var api = { matchSchool: matchSchool, rankList: rankList, officialSchools: officialSchools, copyText: copyText, lacLink: lacLink, prLinks: prLinks, WEIGHTS: WEIGHTS, forgeRanking: forgeRanking };
  root.cfRankList = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
