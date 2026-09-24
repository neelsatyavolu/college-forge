// Which school deadlines belong on the student's plan, and how to flag them.
// Plain script so Timeline/Overview and the node tests share it.
(function (root) {
  // Checked in order: a scholarship deadline for ED applicants is still a
  // scholarship deadline, not an ED application.
  var KINDS = [
    ["aid", /financial aid|fafsa|css profile|\bcss\b|\baid\b/i],
    ["scholarship", /scholarship|merit|fellow/i],
    ["program", /honors|program|interview|portfolio|audition/i],
    ["docs", /materials|supplement|documents|transcript|mid-?year/i],
  ];
  var ROUND_TOKEN = /\b(ED|EA|REA|SCEA|RD)(?:\s?(II|I|2|1))?\b/gi;

  function kindOf(plan) {
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i][1].test(plan)) return KINDS[i][0];
    return "round";
  }

  // "ED I" and "ED" are the same round; "ED II" is not.
  function roundTokens(plan) {
    var out = [];
    String(plan || "").replace(ROUND_TOKEN, function (_, round, n) {
      var suffix = n === "II" || n === "ii" || n === "2" ? " II" : "";
      out.push(round.toUpperCase() + suffix);
      return _;
    });
    return out;
  }

  function roundTone(plan) {
    if (/early decision/i.test(plan) || roundTokens(plan).some(function (t) { return t.indexOf("ED") === 0; })) return { label: "ED", bg: "var(--coral)", fg: "var(--on-primary)" };
    if (/restrictive/i.test(plan) || roundTokens(plan).some(function (t) { return t === "REA" || t === "SCEA"; })) return { label: "REA", bg: "var(--accent-amber)", fg: "var(--ink)" };
    if (/early action/i.test(plan) || roundTokens(plan).some(function (t) { return t.indexOf("EA") === 0; })) return { label: "EA", bg: "var(--accent-teal)", fg: "var(--on-primary)" };
    if (/rolling/i.test(plan)) return { label: "Rolling", bg: "var(--surface-cream-strong)", fg: "var(--muted)" };
    if (/priority/i.test(plan)) return { label: "Priority", bg: "var(--surface-cream-strong)", fg: "var(--ink)" };
    return { label: "RD", bg: "var(--surface-cream-strong)", fg: "var(--muted)" };
  }

  var KIND_TONES = {
    aid: { label: "Aid", bg: "var(--warning)", fg: "var(--ink)" },
    scholarship: { label: "$", bg: "var(--warning)", fg: "var(--ink)" },
    program: { label: "Program", bg: "var(--surface-soft)", fg: "var(--ink)" },
    docs: { label: "Docs", bg: "var(--surface-soft)", fg: "var(--muted)" },
  };

  function deadlineTone(plan) {
    return KIND_TONES[kindOf(plan)] || roundTone(plan);
  }

  // The round in the school's "EA · Nov 1" label, or null when none is chosen.
  function chosenRound(college) {
    var label = String((college && college.deadline) || "").split("·")[0].trim();
    if (!label) return null;
    var tokens = roundTokens(label);
    return tokens.length ? { token: tokens[0] } : { name: label.toLowerCase() };
  }

  function belongsToRound(plan, chosen) {
    var tokens = roundTokens(plan);
    if (chosen.token) return tokens.indexOf(chosen.token) >= 0 || (tokens.length === 0 && kindOf(plan) !== "round");
    if (kindOf(plan) === "round") return String(plan).trim().toLowerCase() === chosen.name;
    return tokens.length === 0;
  }

  /** Deadlines for the round the student chose, plus aid/scholarship/program dates that apply to it. */
  function planDeadlines(college) {
    var deadlines = (college && college.deadlines) || [];
    var chosen = chosenRound(college);
    if (!chosen) return deadlines;
    return deadlines.filter(function (d) { return belongsToRound(d.plan, chosen); });
  }

  var api = { deadlineTone: deadlineTone, planDeadlines: planDeadlines };
  root.cfDeadlinePlan = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
