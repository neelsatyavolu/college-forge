/**
 * What the copilot knows about Forge itself: every tab in the hub (public/hub/nav.js) and the full pages
 * beside it, what each shows, where its data comes from and which tools read or change it. Students ask
 * about tabs by name ("why is Northwestern first on my Ranked list?"), so the copilot needs this to answer
 * about the page they're looking at. tests/hub-guide.test.cjs fails when a tab has no entry here.
 * When you add or change a tab, update its entry (see AGENTS.md "Keep the copilot informed").
 */
export const HUB_TABS: Record<string, { label: string; what: string; tools: string[] }> = {
  applications: {
    label: "Portals",
    what: "Every applicant portal the student added: what each school's portal says, missing items, and the expected decision date. Forge signs in on the student's check schedule. A posted decision only shows as \"posted\" here.",
    tools: ["list_applications", "get_application", "check_portals", "set_portal_settings"],
  },
  progress: {
    label: "Progress",
    what: "Where every application stands (status and round), with per-school follow-ups and cross-school flags. It is the page parents and counselors see through a share link.",
    tools: ["list_applications", "update_application", "add_application", "remove_application", "add_follow_up", "complete_follow_up", "add_flag", "resolve_flag"],
  },
  timeline: {
    label: "Timeline",
    what: "Every date from now through decision day (school deadlines, milestones, aid deadlines when the student needs aid) and a week-by-week supplement writing plan. For a student in a later cycle, dates are last cycle's moved forward a year and marked est.",
    tools: ["upcoming_dates", "set_critical_dates", "set_application_rounds"],
  },
  decisions: {
    label: "Decisions",
    what: "Posted decisions stay covered until the student opens them; below them, the schools still waiting, soonest expected decision first.",
    tools: ["list_applications", "record_decision", "reveal_decision (only when the student asks to see it)"],
  },
  board: {
    label: "Decision board",
    what: "Shown once a school admits the student: their offers side by side with ranks, a year's cost and their notes, plus the AI's two picks on request.",
    tools: ["list_applications"],
  },
  essays: {
    label: "Essays",
    what: "Common App personal statement prompts and each school's supplements (UC PIQs under uc-application), with drafts, draft/final marks and hidden prompts.",
    tools: ["list_essays", "get_essay", "set_essays", "suggest_essay_edit", "set_essay_status", "set_essay_visibility"],
  },
  track: {
    label: "Recs & aid",
    what: "Recommendation letters (who, which schools, asked date, thank-you), scholarships, FAFSA / CSS Profile / IDOC status, and the aid estimate when the student needs aid.",
    tools: ["set_recommendations", "draft_rec_request", "set_scholarships", "set_financial_aid", "get_aid_estimate", "get_aid_plan", "set_aid_details"],
  },
  recommendations: {
    label: "Colleges for you",
    what: "Forge's suggested colleges by Reach / Target / Likely, grounded in graduate outcomes for the student's majors, their academics and preferences.",
    tools: ["get_college_recommendations", "upsert_college", "rebalance_list", "set_list_preferences"],
  },
  shortlist: {
    label: "Your shortlist",
    what: "The student's saved college list with tier, round, supplements and sourced research; clicking a school opens its detail page (deadlines, essays, cost for them, major notes). Schools here also show on Progress as Not started.",
    tools: ["get_shortlist", "upsert_college", "remove_college", "set_school_research", "set_application_rounds", "set_admission_odds"],
  },
  explore: {
    label: "Explore colleges",
    what: "Every four-year public and nonprofit college with 1,000+ undergraduates plus every ranked school, filterable by cost, aid, testing and rounds; each opens to its facts and rankings.",
    tools: ["web_search", "get_official_rankings", "upsert_college"],
  },
  official: {
    label: "Official rankings",
    what: "The published lists in the publishers' own order (U.S. News national and liberal arts, Forbes, Niche, WSJ, Princeton Review best value) and the Forge ranking, a weighted average of them.",
    tools: ["get_official_rankings"],
  },
  list: {
    label: "Ranked list",
    what: "The student's applications (not the shortlist) ordered by a weighted average of U.S. News, Forbes, Niche, WSJ and Princeton Review ranks and the student's own career ranking (My path). Reputation and outcomes, not admission chances: a school first here can still be a reach.",
    tools: ["get_ranked_list"],
  },
  scattergrams: {
    label: "Scattergrams",
    what: "Shown after a MaiaLearning import: where past applicants from the student's own high school landed by GPA and SAT, per college. Local evidence for chances, never a prediction.",
    tools: ["get_scattergrams"],
  },
  profile: {
    label: "Your profile",
    what: "Grades, GPA scale, testing, coursework, activities, honors, intended major and the application read.",
    tools: ["get_profile", "set_applicant_snapshot", "set_testing", "set_coursework", "set_profile_identity", "upsert_activity", "upsert_honor", "read_application"],
  },
  share: {
    label: "Share & export",
    what: "Read-only share links for parents or a counselor, and exports of the workspace.",
    tools: ["list_share_links", "create_share_link", "revoke_share_link"],
  },
  settings: {
    label: "Settings",
    what: "Theme, the AI provider sign-in, account, and restarting setup. The student changes these themselves.",
    tools: [],
  },
};

/** Full pages outside the hub's tabs (nav.js PAGE_LINKS), keyed by href. */
export const HUB_PAGES: Record<string, { label: string; what: string; tools: string[] }> = {
  "/rankings": {
    label: "Career rankings",
    what: "Colleges ranked by graduate outcomes (federal pay records) in the majors the student picks, with their own weights (My path). Their My path rank is one of the inputs to the Ranked list.",
    tools: ["get_college_recommendations", "get_ranked_list"],
  },
};

/** The prompt section: one line per tab and page. */
export function hubGuide(): string {
  const line = (t: { label: string; what: string; tools: string[] }) => `- **${t.label}**: ${t.what}${t.tools.length ? ` Tools: ${t.tools.join(", ")}.` : ""}`;
  return [
    "## Forge's tabs (what the student sees)",
    "When the student names a tab or something on it, answer about that tab using its tools, not a different measure. If two tabs disagree (the Ranked list vs. a scattergram), say what each one measures.",
    ...Object.values(HUB_TABS).map(line),
    ...Object.values(HUB_PAGES).map(line),
  ].join("\n");
}
