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

    /// True while the onboarding wizard should cover the app (mirrors `needsOnboarding` in lib/store.ts).
    var needsOnboarding: Bool {
        if onboarding.completed { return false }
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
    }
}

extension String {
    /// Forge writes "—" for an unset stat. True when the value carries real content.
    var isPresentStat: Bool {
        let t = trimmingCharacters(in: .whitespaces)
        return !t.isEmpty && t != "—"
    }
}
