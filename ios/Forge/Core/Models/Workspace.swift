import Foundation

/// The student's workspace, as GET /api/workspace returns it (lib/store.ts `Workspace`).
/// The tracker inside the workspace is ignored here; the app reads applications from /api/applications.
struct Workspace: Codable, Hashable, Sendable {
    var revision: Int
    var draftStorageKey: String
    var applicant: Applicant
    var profile: Profile
    var ed: EarlyDecision?
    var criticalDates: [CriticalDate]
    var colleges: [College]
    var essays: EssaySet
    /// Draft text keyed by essay id.
    var essayDrafts: [String: String]
    /// Planner checkbox state keyed by task id.
    var plannerDone: [String: Bool]
    var recommendations: [Recommendation]
    var scholarships: [Scholarship]
    var financialAid: FinancialAid
    var advisorNotes: [AdvisorNote]
    var shares: [ShareMeta]
    var recoveryCode: String?
    var uploads: [UploadMeta]
    var onboarding: OnboardingState
    var applicationRead: ApplicationRead?
    /// Chance estimates keyed by a shortlist slug or "app:<tracked app id>".
    var admissionOdds: [String: AdmissionOdds]
    /// Scorecard numbers for tracked schools, by tracked app id. Passed through uninterpreted.
    var schoolStats: [String: JSONValue]
    /// Essays the student hid, by essay id (always true). Hidden essays keep their drafts and leave every count.
    var essayHidden: [String: Bool] = [:]
    /// The chosen Common App personal essay prompt (a ca-ps-* id); the other prompts of that set are then hidden.
    var commonAppPrompt: String? = nil
    /// Schools the student is not writing supplements for, by Essays group key (a slug or "uc-application"),
    /// always false. Every other school is an essay school.
    var essaySchools: [String: Bool] = [:]
    /// Which option (0-based) of a choose-one prompt the student answers, by essay id.
    var essayOption: [String: Int] = [:]

    /// True while the onboarding wizard should cover the app (mirrors `needsOnboarding` in lib/store.ts).
    var needsOnboarding: Bool {
        if onboarding.completed { return false }
        // An interview in progress reopens by itself, even after the student's name is saved.
        if let interview = onboarding.interview, interview.phase != "done" { return true }
        if !applicant.name.trimmingCharacters(in: .whitespaces).isEmpty { return false }
        return colleges.isEmpty && profile.activities.isEmpty
    }

    static let empty = Workspace(
        revision: 0, draftStorageKey: "", applicant: Applicant(), profile: Profile(), ed: nil, criticalDates: [],
        colleges: [], essays: EssaySet(), essayDrafts: [:], plannerDone: [:], recommendations: [], scholarships: [],
        financialAid: FinancialAid(), advisorNotes: [], shares: [], recoveryCode: nil, uploads: [],
        onboarding: OnboardingState(), applicationRead: nil, admissionOdds: [:], schoolStats: [:]
    )
}

extension Workspace {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        revision = c.int(.revision)
        draftStorageKey = c.string(.draftStorageKey)
        applicant = c.value(.applicant, Applicant())
        profile = c.value(.profile, Profile())
        ed = c.optional(EarlyDecision.self, .ed)
        criticalDates = c.array(.criticalDates)
        colleges = c.array(.colleges)
        essays = c.value(.essays, EssaySet())
        essayDrafts = c.dictionary(.essayDrafts)
        plannerDone = c.dictionary(.plannerDone)
        recommendations = c.array(.recommendations)
        scholarships = c.array(.scholarships)
        financialAid = c.value(.financialAid, FinancialAid())
        advisorNotes = c.array(.advisorNotes)
        shares = c.array(.shares)
        recoveryCode = c.optionalString(.recoveryCode)
        uploads = c.array(.uploads)
        onboarding = c.value(.onboarding, OnboardingState())
        applicationRead = c.optional(ApplicationRead.self, .applicationRead)
        admissionOdds = c.dictionary(.admissionOdds)
        schoolStats = c.dictionary(.schoolStats)
        essayHidden = c.dictionary(.essayHidden)
        commonAppPrompt = c.optionalString(.commonAppPrompt)
        essaySchools = c.dictionary(.essaySchools)
        essayOption = c.dictionary(.essayOption)
    }
}

/// Headline numbers shown on the profile (`Workspace.applicant`). Stats use "—" for "not set".
struct Applicant: Codable, Hashable, Sendable {
    var name = ""
    var cycle = ""
    var year = ""
    var gpaWeighted = "—"
    var gpaUnweighted = "—"
    var sat = "—"
    var satNote = ""
    var awards = 0
    /// Unweighted GPA by school year ("9".."12"), from the transcript. The server derives the two below from it.
    var gpaByYear: [String: String] = [:]
    /// "up", "steady" or "down"; set by the server from `gpaByYear` when two or more years are on file.
    var gpaTrend: String?
    /// The 10th-11th grade unweighted GPA (what the UCs use).
    var gpaRecent: String?
}

extension Applicant {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.string(.name)
        cycle = c.string(.cycle)
        year = c.string(.year)
        gpaWeighted = c.string(.gpaWeighted, "—")
        gpaUnweighted = c.string(.gpaUnweighted, "—")
        sat = c.string(.sat, "—")
        satNote = c.string(.satNote)
        awards = c.int(.awards)
        gpaByYear = c.dictionary(.gpaByYear, of: String.self).filter { $0.value.isPresentStat }
        gpaTrend = c.optionalString(.gpaTrend)
        gpaRecent = c.optionalString(.gpaRecent)
    }
}

extension String {
    /// Forge writes "—" for an unset stat. True when the value carries real content.
    var isPresentStat: Bool {
        let t = trimmingCharacters(in: .whitespaces)
        return !t.isEmpty && t != "—"
    }
}
