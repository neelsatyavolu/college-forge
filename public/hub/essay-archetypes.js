// The Essays tab's writing totals, deadlines and prompt types.
// Plain script so the Essays tab and the node tests share it.
(function (root) {
  var deadlinePlan = root.cfDeadlinePlan || (typeof require === "function" ? require("./deadline-plan.js") : null);

  // Checked in order; the first match wins. The label is read with the prompt
  // because scraped labels often name the type ("Why This Major Short Response").
  var ARCHETYPES = [
    { id: "personal", label: "Personal statement" },
    { id: "additional", label: "Additional information" },
    { id: "why-major", label: "Why this major" },
    { id: "why-us", label: "Why this school" },
    { id: "short", label: "Short takes" },
    { id: "community", label: "Community and identity" },
    { id: "challenge", label: "Challenge or disagreement" },
    { id: "activity", label: "Activity" },
    { id: "curiosity", label: "Intellectual curiosity" },
    { id: "other", label: "Other prompts" },
  ];
  var PATTERNS = {
    additional: /additional info|anything else|special circumstances|change in your grades|context (that )?we should|not (otherwise )?reflected|would like (us|the (admissions )?committee) to know|covid/i,
    "why-major": /why this major|intended (major|program)|(selected|chosen|first[- ]choice|intended) (major|academic program|program of study|area of study)|chosen this major|program of study|why .{0,30}\bstudy\b|educational plans|areas? of study|academic (interest|areas?)|(academic|career|professional) goals|(interest|interested) in (your |the )?[\w-]*\s?(choice )?major|what draws you to the subject|interest in (studying|the major)/i,
    "why-us": /^why\b|why this college|why (are you applying|did you choose|do you want|you want)|good (match|fit)|best fit|attract(s)? you|appeal(s)? to you|interested in attending|motivated you to apply|reasons for (choosing|wishing to enroll)|during your college search|thrive (in|at)|how did you (first )?learn about/i,
    community: /divers|communit|identity|background|culture|belong|difference/i,
    challenge: /challeng|obstacle|setback|failure|disagree|viewpoint|conflict|difficult|harder than you expected|changing beliefs|changed your mind/i,
    activity: /activit|extracurricular|work experience|employment|commitment outside|leadership|service|job you hold|responsibilit/i,
    curiosity: /intellectual|curio|\bideas?\b|track of time|question|problem|excite|learn more|\btexts?\b/i,
  };
  var SHORT_WORDS = 50;
  var SHORT_CHARACTERS = 350;

  function isCharacters(it) { return /character/i.test((it && it.unit) || ""); }

  /** The archetype id for one essay prompt. */
  function archetypeOf(it) {
    if (/^ca-ps-/.test(it.id || "")) return "personal";
    var text = (it.label || "") + "\n" + (it.prompt || "");
    if (PATTERNS.additional.test(text)) return "additional";
    if (PATTERNS["why-major"].test(text)) return "why-major";
    if (PATTERNS["why-us"].test(it.label || "") || PATTERNS["why-us"].test(it.prompt || "")) return "why-us";
    if (it.limit > 0 && it.limit <= (isCharacters(it) ? SHORT_CHARACTERS : SHORT_WORDS)) return "short";
    var kinds = ["community", "challenge", "activity", "curiosity"];
    // A label that names the type ("Intellectual Curiosity Short Response") beats the prompt's wording.
    for (var i = 0; i < kinds.length; i++) if (PATTERNS[kinds[i]].test(it.label || "")) return kinds[i];
    for (var j = 0; j < kinds.length; j++) if (PATTERNS[kinds[j]].test(text)) return kinds[j];
    return "other";
  }

  /** Prompts the student doesn't have to answer: optional ones and ones only for some programs. */
  function isOptional(it) {
    if (it.required === false) return true;
    if (/\(optional\)|only if this applies/i.test(it.label || "")) return true;
    return /^optional\b/i.test(it.prompt || "");
  }

  // Common App: write one personal statement. UC: answer 4 of the 8 PIQs.
  // For prompts saved before these sets carried chooseGroup.
  var DEFAULT_CHOICE = [
    { id: /^ca-ps-/, group: "common", choose: 1 },
    { id: /^uc-piq-/, group: "uc", choose: 4 },
  ];
  function choiceOf(it) {
    if (it.chooseGroup && it.choose > 0) return { group: it.chooseGroup, choose: it.choose };
    for (var i = 0; i < DEFAULT_CHOICE.length; i++) if (DEFAULT_CHOICE[i].id.test(it.id || "")) return DEFAULT_CHOICE[i];
    return null;
  }

  /**
   * Hidden by the student (opts.hidden: id → true), or a Common App personal essay prompt other than the
   * chosen one (opts.commonAppPrompt). Matches isEssayHidden in lib/essay-tools.ts.
   */
  function isHidden(it, opts) {
    opts = opts || {};
    if (opts.hidden && opts.hidden[it.id]) return true;
    var choice = choiceOf(it);
    return !!(opts.commonAppPrompt && choice && choice.group === "common" && it.id !== opts.commonAppPrompt);
  }

  /** The items a group shows and counts, with hidden ones left out. */
  function visibleItems(items, opts) {
    return (items || []).filter(function (it) { return !isHidden(it, opts); });
  }

  /** Choose-N sets where the student picks more than one prompt (UC: 4 of 8), in item order. */
  function pickSets(items) {
    var sets = [];
    var byGroup = {};
    (items || []).forEach(function (it) {
      var choice = choiceOf(it);
      if (!choice || choice.choose < 2) return;
      var set = byGroup[choice.group];
      if (!set) { set = byGroup[choice.group] = { group: choice.group, choose: choice.choose, items: [] }; sets.push(set); }
      set.items.push(it);
    });
    return sets;
  }

  /** essayHidden patch for a set: the picked prompts shown, every other one hidden. */
  function pickPatch(setItems, pickedIds) {
    var patch = {};
    (setItems || []).forEach(function (it) { patch[it.id] = pickedIds.indexOf(it.id) >= 0 ? null : true; });
    return patch;
  }

  /**
   * The draft cut into runs for highlighting: each flagged sentence still found in the text (first match,
   * in order, no overlaps) is a marked run. Sentences the student has since edited away are skipped.
   */
  function markSegments(text, sentences) {
    text = String(text || "");
    if (!text) return [];
    var ranges = [];
    (sentences || []).forEach(function (s) {
      var needle = String(s || "").trim();
      if (!needle) return;
      var from = 0;
      while (from <= text.length) {
        var at = text.indexOf(needle, from);
        if (at < 0) return;
        var end = at + needle.length;
        var overlaps = ranges.some(function (r) { return at < r[1] && end > r[0]; });
        if (!overlaps) { ranges.push([at, end]); return; }
        from = at + 1;
      }
    });
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    var out = [];
    var pos = 0;
    ranges.forEach(function (r) {
      if (r[0] > pos) out.push({ text: text.slice(pos, r[0]), mark: false });
      out.push({ text: text.slice(r[0], r[1]), mark: true });
      pos = r[1];
    });
    if (pos < text.length) out.push({ text: text.slice(pos), mark: false });
    return out;
  }

  /**
   * A school whose prompts belong to different colleges or programs (Cornell's colleges, Tufts' schools): the
   * audiences in prompt order, and whether some prompts are for everyone. Null with fewer than two audiences.
   */
  function audienceSet(items) {
    var audiences = [];
    var shared = false;
    (items || []).forEach(function (it) {
      if (!it.audience) { shared = true; return; }
      if (audiences.indexOf(it.audience) < 0) audiences.push(it.audience);
    });
    return audiences.length >= 2 ? { audiences: audiences, shared: shared } : null;
  }

  /** essayHidden patch for choosing `audience` ("" for none of them): its prompts shown, other programs' hidden. */
  function audiencePatch(items, audience) {
    var patch = {};
    (items || []).forEach(function (it) { if (it.audience) patch[it.id] = it.audience === audience ? null : true; });
    return patch;
  }

  /** The audience the student chose, "" for none of them, or null while nothing is chosen. */
  function chosenAudience(items, hidden) {
    hidden = hidden || {};
    var shown = [];
    var anyHidden = false;
    (items || []).forEach(function (it) {
      if (!it.audience) return;
      if (hidden[it.id]) anyHidden = true;
      else if (shown.indexOf(it.audience) < 0) shown.push(it.audience);
    });
    if (!anyHidden) return null;
    return shown.length === 1 ? shown[0] : shown.length === 0 ? "" : null;
  }

  var UC_APPLICATION_SLUG = "uc-application";

  /** A University of California campus; they share one UC Application essay group. */
  function isUcCampus(c) {
    if (!c) return false;
    var slug = (c.slug || "").toLowerCase();
    var name = ((c.name || "") + " " + (c.short || "")).toLowerCase();
    if (slug.indexOf("university-of-california-") === 0) return true;
    if (slug === "ucla" || slug === "ucb" || slug === "ucsd" || slug === "uc-berkeley") return true;
    if (/\buniversity of california\b/.test(name)) return true;
    if (/\buc\s+(berkeley|los angeles|san diego|davis|irvine|santa barbara|santa cruz|riverside|merced)\b/.test(name)) return true;
    return name.trim() === "ucla";
  }

  /** The Essays group a school writes in (essayGroupKey in lib/essay-supplements.ts): its slug, or the UC Application. */
  function essayGroupKey(c) {
    if (isUcCampus(c)) return UC_APPLICATION_SLUG;
    return (c && c.slug) || null;
  }

  /** True when the student opted this group's school out of supplements (opts.essaySchools: key -> false). */
  function isSchoolSkipped(key, opts) {
    return !!(key && key !== "common" && opts && opts.essaySchools && opts.essaySchools[key] === false);
  }

  /**
   * The schools the student can write supplements for, one row per Essays group: each non-UC list school,
   * and one UC Application row for all UC campuses. `writing` is false for an opted-out school.
   */
  function essaySchools(colleges, opts) {
    var rows = [];
    var uc = null;
    var seen = {};
    (colleges || []).forEach(function (c) {
      var key = essayGroupKey(c);
      if (!key) return;
      // Two list rows on one slug share one Essays group, so they share one row here.
      if (seen[key] && key !== UC_APPLICATION_SLUG) return;
      seen[key] = true;
      if (key === UC_APPLICATION_SLUG) {
        if (!uc) { uc = { key: key, title: "UC Application", campuses: [] }; rows.push(uc); }
        uc.campuses.push(c.short || c.name || c.slug);
        return;
      }
      rows.push({ key: key, title: c.short || c.name || key, campuses: [] });
    });
    return rows.map(function (r) { return { key: r.key, title: r.title, subtitle: r.campuses.join(" · "), writing: !isSchoolSkipped(r.key, opts) }; });
  }

  function wordCount(s) { var t = String(s || "").trim(); return t ? t.split(/\s+/).length : 0; }
  function countOf(it, text) { return isCharacters(it) ? Array.from(String(text || "")).length : wordCount(text); }

  /**
   * The essays the student has to write: required prompts, plus the N picks of each
   * choose-N set. Final prompts are picked first, then started ones, then the longest.
   * Hidden essays and schools the student isn't writing for don't count, and a chosen Common App
   * prompt is the set's one pick.
   */
  function requiredItems(groups, drafts, status, opts) {
    var out = [];
    (groups || []).forEach(function (group) {
      if (group.kind === "orphan" || isSchoolSkipped(group.key, opts)) return;
      var sets = {};
      visibleItems(group.items, opts).forEach(function (it) {
        var choice = choiceOf(it);
        if (choice) {
          var set = sets[choice.group] || (sets[choice.group] = { choose: choice.choose, items: [] });
          set.items.push(it);
        } else if (!isOptional(it)) out.push(it);
      });
      Object.keys(sets).forEach(function (key) {
        var set = sets[key];
        var isFinal = function (it) { return status[it.id] === "final" ? 1 : 0; };
        var picks = set.items.slice().sort(function (a, b) {
          return isFinal(b) - isFinal(a) || countOf(b, drafts[b.id]) - countOf(a, drafts[a.id]) || b.limit - a.limit;
        });
        out = out.concat(picks.slice(0, set.choose));
      });
    });
    return out;
  }

  /** Counts for the summary strip. Words cover word-limit prompts only, each capped at its limit. */
  function writingTotals(groups, drafts, status, opts) {
    drafts = drafts || {};
    status = status || {};
    var items = requiredItems(groups, drafts, status, opts);
    var totals = { required: items.length, drafted: 0, final: 0, wordsWritten: 0, wordsRequired: 0 };
    items.forEach(function (it) {
      var count = countOf(it, drafts[it.id]);
      // Final essays count as drafted too.
      if (status[it.id] === "final") totals.final += 1;
      if (count > 0 || status[it.id] === "final") totals.drafted += 1;
      if (!isCharacters(it)) {
        totals.wordsRequired += it.limit;
        totals.wordsWritten += Math.min(count, it.limit);
      }
    });
    return totals;
  }

  var ROUND_LABELS = { ED: 1, REA: 1, EA: 1, RD: 1, Rolling: 1, Priority: 1 };

  /** The earliest application deadline on or after today across these colleges, for each one's chosen round. */
  function nextDeadline(colleges, todayIso) {
    var best = null;
    (colleges || []).forEach(function (college) {
      var dates = deadlinePlan ? deadlinePlan.planDeadlines(college) : (college.deadlines || []);
      dates.forEach(function (d) {
        if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.date || "") || d.date < todayIso) return;
        var round = deadlinePlan ? deadlinePlan.deadlineTone(d.plan).label : "";
        if (deadlinePlan && !ROUND_LABELS[round]) return;
        if (!best || d.date < best.date) best = { date: d.date, round: round, college: college };
      });
    });
    return best;
  }

  /** Word-equivalent limit for sorting (about six characters a word). */
  function sortLimit(it) { return isCharacters(it) ? it.limit / 6 : it.limit; }

  /** Sections for the "By prompt type" view, in ARCHETYPES order, each sorted longest limit first. */
  function byPromptType(items) {
    return ARCHETYPES.map(function (a) {
      var matching = items.filter(function (it) { return archetypeOf(it) === a.id; });
      return { id: a.id, label: a.label, items: matching.sort(function (x, y) { return sortLimit(y) - sortLimit(x); }) };
    }).filter(function (s) { return s.items.length > 0; });
  }

  var api = {
    ARCHETYPES: ARCHETYPES,
    archetypeOf: archetypeOf,
    isOptional: isOptional,
    isHidden: isHidden,
    visibleItems: visibleItems,
    pickSets: pickSets,
    pickPatch: pickPatch,
    markSegments: markSegments,
    audienceSet: audienceSet,
    audiencePatch: audiencePatch,
    chosenAudience: chosenAudience,
    isUcCampus: isUcCampus,
    essayGroupKey: essayGroupKey,
    isSchoolSkipped: isSchoolSkipped,
    essaySchools: essaySchools,
    writingTotals: writingTotals,
    nextDeadline: nextDeadline,
    byPromptType: byPromptType,
  };
  root.cfEssayArchetypes = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
