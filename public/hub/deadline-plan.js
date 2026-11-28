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

  /**
   * "aid" (FAFSA, CSS Profile, a school's aid form), "scholarship" (merit, fellows) or null for anything else.
   * Same words as lib/aid-plan.ts deadlineKind (tests/aid.test.cjs keeps them in step).
   */
  function aidKind(plan) {
    var k = kindOf(String(plan || ""));
    return k === "aid" || k === "scholarship" ? k : null;
  }

  /**
   * Whether to show this deadline, from what the student told Forge: need-based aid dates go when
   * listPrefs.needAid is false, scholarship dates when interview.meritInterest is "no". Unknown keeps both.
   * Mirrors lib/aid-plan.ts showsDeadline.
   */
  function showsDeadline(plan, data) {
    var kind = aidKind(plan);
    var ob = (data && data.onboarding) || {};
    if (kind === "aid") return !(ob.listPrefs && ob.listPrefs.needAid === false);
    if (kind === "scholarship") return !(ob.interview && ob.interview.meritInterest === "no");
    return true;
  }

  /** The deadlines left after the student's aid choices (showsDeadline). */
  function visibleDeadlines(deadlines, data) {
    return (deadlines || []).filter(function (d) { return d && showsDeadline(d.plan, data); });
  }

  // Which aid form an aid deadline is for, with a line on what it is. Checked in order.
  var AID_FORMS = [
    { id: "fafsa", test: /fafsa/i, form: "FAFSA", note: "The federal form for grants, loans and work-study. Free at studentaid.gov." },
    { id: "css", test: /css/i, form: "CSS Profile", note: "The College Board form many private colleges use for their own grants. Fee waivers for many families." },
    { id: "school", test: /./, form: "School aid form", note: "The school's own date for need-based aid. Filing by it keeps you in line for its grant money." },
  ];
  var SCHOLARSHIP_FORM = { id: "scholarship", form: "Scholarship", note: "Merit money. Some schools need a separate application, or an early round, to be considered." };

  /** { id, form, note } for an aid or scholarship deadline, or null for an admission round. */
  function aidForm(plan) {
    var kind = aidKind(plan);
    if (!kind) return null;
    var hit = kind === "scholarship" ? SCHOLARSHIP_FORM : AID_FORMS.find(function (f) { return f.test.test(plan); });
    return { id: hit.id, form: hit.form, note: hit.note };
  }

  var api = {
    deadlineTone: deadlineTone, planDeadlines: planDeadlines,
    aidKind: aidKind, aidForm: aidForm, showsDeadline: showsDeadline, visibleDeadlines: visibleDeadlines,
    AID_FORMS: AID_FORMS, SCHOLARSHIP_FORM: SCHOLARSHIP_FORM,
  };
  root.cfDeadlinePlan = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
