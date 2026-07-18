// College Forge starts empty. The real workspace is loaded from /api/workspace
// and populated by the AI copilot + manual editors. This is the pre-hydration shape.
window.CF_DATA = {
  applicant: { name: "", cycle: "", year: "", gpaWeighted: "—", gpaUnweighted: "—", sat: "—", satNote: "", awards: 0 },
  profile: {
    intended: "", hs: "", gradYear: "", location: "", counselor: "", residency: "",
    testing: { sat: "—", satNote: "", aps: [] },
    coursework: { honors: [], aps: [], senior: [] },
    activities: [],
    honors: [],
  },
  ed: null,
  criticalDates: [],
  colleges: [],
  essays: { commonApp: [], supplements: {} },
  essayDrafts: {},
  plannerDone: {},
  applications: {},
  recommendations: [],
  scholarships: [],
  financialAid: { fafsaStatus: "not_started", cssStatus: "not_started" },
  advisorNotes: [],
  shares: [],
  uploads: [],
  onboarding: { completed: false },
};
