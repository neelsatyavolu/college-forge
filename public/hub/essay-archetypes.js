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

  function wordCount(s) { var t = String(s || "").trim(); return t ? t.split(/\s+/).length : 0; }
  function countOf(it, text) { return isCharacters(it) ? Array.from(String(text || "")).length : wordCount(text); }

  /**
   * The essays the student has to write: required prompts, plus the N picks of each
   * choose-N set. Final prompts are picked first, then started ones, then the longest.
   */
  function requiredItems(groups, drafts, status) {
    var out = [];
    (groups || []).forEach(function (group) {
      if (group.kind === "orphan") return;
      var sets = {};
      (group.items || []).forEach(function (it) {
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
  function writingTotals(groups, drafts, status) {
    drafts = drafts || {};
    status = status || {};
    var items = requiredItems(groups, drafts, status);
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
    writingTotals: writingTotals,
    nextDeadline: nextDeadline,
    byPromptType: byPromptType,
  };
  root.cfEssayArchetypes = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
