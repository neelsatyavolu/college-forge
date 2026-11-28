// What a shortlist school's detail page (SchoolDetail.jsx) and card show: the chosen round, research
// facts by group with their cycle, net price for the family's income against its budget, and the
// school's supplements with how far each draft is. Plain script so the hub and the node tests share it.
(function (root) {
  var CURRENT_CYCLE = "2026-27";

  var RESEARCH_GROUPS = [
    ["Admissions", [["admit_rate", "Admit rate"], ["ed_admit_rate", "Early admit rate"], ["sat_mid50", "SAT middle 50%"], ["act_mid50", "ACT middle 50%"], ["gpa_note", "GPA"], ["test_policy", "Testing"]]],
    ["Cost and aid", [["sticker_cost", "Cost of attendance"], ["meets_full_need", "Need-based aid"], ["css_profile", "CSS Profile"], ["merit_aid", "Merit aid"], ["net_price_lt30k", "Net price, under $30k income"], ["net_price_30_48k", "Net price, $30–48k"], ["net_price_48_75k", "Net price, $48–75k"], ["net_price_75_110k", "Net price, $75–110k"], ["net_price_gt110k", "Net price, over $110k"]]],
    ["Applying", [["ed_ea_options", "Early rounds"], ["interview", "Interview"], ["demonstrated_interest", "Demonstrated interest"], ["major_notes", "Your major"], ["notes", "Notes"]]],
  ];

  var NET_PRICE_KEY = { lt30: "net_price_lt30k", "30-48": "net_price_30_48k", "48-75": "net_price_48_75k", "75-110": "net_price_75_110k", gt110: "net_price_gt110k" };
  var INCOME_LABEL = { lt30: "under $30k", "30-48": "$30–48k", "48-75": "$48–75k", "75-110": "$75–110k", gt110: "over $110k" };
  // The top of each yearly budget bucket (lib/store.ts ListBudget). "50plus" and "unsure" set no cap.
  var BUDGET_CAP = { lt15: 15000, "15-30": 30000, "30-50": 50000 };
  var BUDGET_LABEL = { lt15: "under $15k a year", "15-30": "$15–30k a year", "30-50": "$30–50k a year", "50plus": "$50k+ a year" };

  function norm(s) { return String(s == null ? "" : s).trim().toLowerCase(); }

  /** The round the student picked ("EA · Nov 1", saved by lib/application-rounds.ts), or null when none is chosen. */
  function chosenRound(college) {
    var label = String((college && college.deadline) || "").trim();
    var cut = label.indexOf("·");
    if (cut < 1) return null;
    var plan = label.slice(0, cut).trim();
    var match = ((college && college.deadlines) || []).find(function (d) { return d && norm(d.plan) === norm(plan); });
    return { plan: plan, label: label, date: match ? match.date : null };
  }

  /** The card's round text: the chosen round's label, or that none is chosen yet. */
  function roundText(college) {
    var r = chosenRound(college);
    return r ? r.label : "Round not chosen";
  }

  /** "last cycle" for the cycle before the current one, "<cycle> cycle" for older ones, null when current or unknown. */
  function cycleTag(cycle, current) {
    var now = current || CURRENT_CYCLE;
    if (!cycle || cycle === now) return null;
    var y = Number(String(now).slice(0, 4));
    var prev = (y - 1) + "-" + String(y).slice(2);
    return cycle === prev ? "last cycle" : cycle + " cycle";
  }

  // Facts the page already shows under "For you" or "Application", so Research facts doesn't repeat them.
  var SHOWN_ABOVE = { admit_rate: 1, test_policy: 1, ed_ea_options: 1, interview: 1, demonstrated_interest: 1 };
  var NET_PRICE_KEYS = {};
  Object.keys(NET_PRICE_KEY).forEach(function (k) { NET_PRICE_KEYS[NET_PRICE_KEY[k]] = 1; });

  /**
   * Whether Research facts lists a fact: not one shown above it, and of the net prices by income only the
   * family's own band (all five when the band is unknown, none when they aren't applying for aid).
   */
  function keepResearchFact(key, prefs) {
    if (!prefs) return true;
    if (SHOWN_ABOVE[key]) return false;
    if (!NET_PRICE_KEYS[key]) return true;
    if (prefs.needAid === false) return false;
    var own = NET_PRICE_KEY[prefs.incomeBracket];
    return !own || own === key;
  }

  /** Every fact, grouped: known keys under their group, anything else under "Other". Empty groups are left out. */
  function researchGroups(facts, prefs) {
    var list = Array.isArray(facts) ? facts.filter(function (f) { return f && f.value && keepResearchFact(f.key, prefs); }) : [];
    var known = {};
    var groups = RESEARCH_GROUPS.map(function (g) {
      var rows = [];
      g[1].forEach(function (pair) {
        known[pair[0]] = true;
        list.forEach(function (f) { if (f.key === pair[0]) rows.push({ label: pair[1], fact: f }); });
      });
      return { title: g[0], rows: rows };
    });
    var other = list.filter(function (f) { return !known[f.key]; }).map(function (f) { return { label: String(f.key).replace(/_/g, " "), fact: f }; });
    if (other.length) groups.push({ title: "Other", rows: other });
    return groups.filter(function (g) { return g.rows.length; });
  }

  function factFor(facts, key) {
    return (Array.isArray(facts) ? facts : []).find(function (f) { return f && f.key === key && f.value; }) || null;
  }

  /**
   * The highest dollar amount in a text, so a range is judged by its top: "$23,450 a year" → 23450,
   * "about $18k" → 18000, "$12,000–$19,500" → 19500. Null when there is none.
   */
  function dollars(text) {
    var re = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/gi;
    var best = null;
    var m;
    while ((m = re.exec(String(text || "")))) {
      var n = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(n)) best = Math.max(best === null ? 0 : best, Math.round(m[2] ? n * 1000 : n));
    }
    return best;
  }

  /**
   * What a year would likely cost this family: the researched net price for their income bracket, else the
   * list's own estimate. With a budget cap, whether it fits. Null when there's no price to show.
   */
  /** place: { residency, state } (student's home state, school's state), for schools that price residents apart. */
  function costForYou(college, prefs, place) {
    var p = prefs || {};
    var facts = college && college.research && college.research.facts;
    var cap = BUDGET_CAP[p.budget] || null;
    if (p.needAid === false) return fullCost(college, place || {}, cap, p);
    var fact = NET_PRICE_KEY[p.incomeBracket] ? factFor(facts, NET_PRICE_KEY[p.incomeBracket]) : null;
    var text = fact ? fact.value : (college && college.netPriceForYou) || "";
    if (!text) return null;
    var price = dollars(text);
    return {
      text: text,
      fact: fact,
      basis: "net",
      income: INCOME_LABEL[p.incomeBracket] || null,
      budget: BUDGET_LABEL[p.budget] || null,
      fits: price !== null && cap !== null ? price <= cap : null,
    };
  }

  var SPLIT_PRICE = /non-?resident|out-of-state|non-[A-Z][a-z]+ns?\b/;
  /** The two-letter state at the end of "Ann Arbor, MI", or null. */
  function schoolState(college) {
    var m = /,\s*([A-Z]{2})\s*$/.exec(String((college && college.location) || ""));
    return m ? m[1] : null;
  }

  /**
   * Not applying for need-based aid: a year costs the full cost of attendance. When the school prices
   * residents and nonresidents apart, the student's residency picks the price (first amount for residents,
   * the highest for everyone else); unknown residency gives the text with no budget verdict.
   */
  function fullCost(college, place, cap, p) {
    var fact = factFor(college && college.research && college.research.facts, "sticker_cost");
    var text = fact ? fact.value : (college && college.coa) || "";
    if (!text) return null;
    var price = dollars(text);
    var where = null;
    var split = SPLIT_PRICE.test(text);
    if (split) {
      var state = place.state || schoolState(college);
      var home = String(place.residency || "").trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(home)) home = null;
      if (!state || !home) price = null;
      else {
        where = state === home ? "in-state" : "out-of-state";
        var first = /\$\s?(\d[\d,]*)/.exec(text);
        price = where === "in-state" ? (first ? Number(first[1].replace(/,/g, "")) : null) : dollars(text);
      }
    }
    return {
      text: price !== null ? "$" + price.toLocaleString("en-US") : split ? "Depends on your residency" : text,
      fact: fact,
      basis: "full",
      residency: where,
      income: null,
      budget: BUDGET_LABEL[p.budget] || null,
      fits: price !== null && cap !== null ? price <= cap : null,
    };
  }

  function wordCount(s) { var t = String(s || "").trim(); return t ? t.split(/\s+/).length : 0; }

  function isUc(c) {
    var slug = norm(c && c.slug);
    return slug.indexOf("university-of-california-") === 0 || slug === "ucla" || norm(c && (c.name || c.short)).indexOf("university of california") !== -1;
  }

  /**
   * The school's supplement prompts with how far each one is: final, draft (has text) or not started.
   * UC campuses share the UC Application's prompts. `skipped` when the student isn't writing for the school.
   */
  function supplementsFor(data, college) {
    var ws = data || {};
    var keys = [college.slug].concat(isUc(college) ? ["uc-application"] : []);
    var schools = ws.essaySchools || {};
    var skipped = keys.some(function (k) { return schools[k] === false; });
    var all = (ws.essays && ws.essays.supplements) || {};
    var hidden = ws.essayHidden || {};
    var status = ws.essayStatus || {};
    var drafts = ws.essayDrafts || {};
    var items = [];
    keys.forEach(function (key) {
      (all[key] || []).forEach(function (e) {
        if (!e || !e.id || hidden[e.id]) return;
        var text = drafts[e.id] || "";
        var count = /character/i.test(e.unit || "") ? Array.from(text).length : wordCount(text);
        items.push({
          id: e.id, label: e.label, prompt: e.prompt, limit: e.limit, unit: e.unit || "words", count: count,
          required: e.required !== false && !/optional/i.test(e.label || ""),
          status: status[e.id] === "final" ? "final" : count > 0 ? "draft" : "not started",
        });
      });
    });
    return { skipped: skipped, items: items };
  }

  /** The school a "#shortlist/<slug>" hash opens; null on the plain list or any other view. */
  function slugFromHash(hash) {
    var parts = String(hash || "").replace(/^#/, "").split("/");
    if (parts[0] !== "shortlist" || !parts[1]) return null;
    try { return decodeURIComponent(parts[1]); } catch (e) { return null; }
  }

  /** The hash that opens a school's page. */
  function hashFor(slug) { return "#shortlist/" + encodeURIComponent(slug); }

  var api = {
    CURRENT_CYCLE: CURRENT_CYCLE, RESEARCH_GROUPS: RESEARCH_GROUPS,
    chosenRound: chosenRound, roundText: roundText, cycleTag: cycleTag, researchGroups: researchGroups,
    factFor: factFor, dollars: dollars, slugFromHash: slugFromHash, hashFor: hashFor, costForYou: costForYou, supplementsFor: supplementsFor, isUc: isUc,
  };
  root.cfSchoolDetail = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
