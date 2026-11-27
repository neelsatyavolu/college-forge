import Foundation

/// Body for PATCH /api/workspace (lib/workspace-patch.ts `WorkspacePatch`). Set only the fields you change;
/// nil fields are not sent. Whole-array fields (`colleges`, `criticalDates`, ...) replace the server's array,
/// so build them from the store's current workspace. Prefer the single-item fields where they exist.
struct WorkspacePatch: Encodable, Sendable {
    var listPrefs: ListPrefs?
    var applicant: ApplicantPatch?
    var profile: ProfilePatch?
    /// `.some(nil)` clears the Early Decision choice.
    var ed: EarlyDecision??
    var criticalDates: [CriticalDate]?
    /// Replaces the shortlist and re-syncs supplement essays for it.
    var colleges: [College]?
    var essays: EssaysPatch?
    /// Merged into the existing drafts.
    var essayDrafts: [String: String]?
    var plannerDone: [String: Bool]?
    var recommendations: [Recommendation]?
    var scholarships: [Scholarship]?
    var financialAid: FinancialAid?
    /// Save one essay draft.
    var essayDraft: EssayDraft?
    var plannerToggle: PlannerToggle?
    /// Upsert one recommender by id (a new id is assigned when `id` is empty).
    var recommendation: Recommendation?
    var removeRecommendationId: String?
    /// Upsert one scholarship by id.
    var scholarship: Scholarship?
    var removeScholarshipId: String?
    var removeAdvisorNoteId: String?
    /// Merge into one shortlist college by slug: pass the current college with your changes.
    var collegePatch: College?
    /// Hide essays by id (`true`); a `nil` value is sent as null and shows the essay again. Never send `false`.
    var essayHidden: [String: Bool?]?
    /// The chosen Common App prompt id; `.some(nil)` clears the choice.
    var commonAppPrompt: String??
    /// Opt schools out of supplements by Essays group key (`false`); a `nil` value is sent as null and makes the
    /// school an essay school again. Never send `true`.
    var essaySchools: [String: Bool?]?
    /// Which option (0-based) of a choose-one prompt the student answers, by essay id; a `nil` value is sent as
    /// null and clears the choice.
    var essayOption: [String: Int?]?

    init() {}

    struct ApplicantPatch: Encodable, Sendable {
        var name: String?
        var cycle: String?
        var year: String?
        var gpaWeighted: String?
        var gpaUnweighted: String?
        var sat: String?
        var satNote: String?
        /// Merged per year on the server; "—" clears a year.
        var gpaByYear: [String: String]?
    }

    struct ProfilePatch: Encodable, Sendable {
        var intended: String?
        var hs: String?
        var gradYear: String?
        var location: String?
        var counselor: String?
        var residency: String?
        var testing: TestScores?
        var coursework: Coursework?
        var activities: [Activity]?
        var honors: [Honor]?
    }

    struct EssaysPatch: Encodable, Sendable {
        var commonApp: [Essay]?
        /// Merged per group key on the server.
        var supplements: [String: [Essay]]?
    }

    struct EssayDraft: Encodable, Sendable {
        var id: String
        var text: String
    }

    struct PlannerToggle: Encodable, Sendable {
        var key: String
        var done: Bool
    }

    private enum CodingKeys: String, CodingKey {
        case listPrefs, applicant, profile, ed, criticalDates, colleges, essays, essayDrafts, plannerDone
        case recommendations, scholarships, financialAid, essayDraft, plannerToggle, recommendation
        case removeRecommendationId, scholarship, removeScholarshipId, removeAdvisorNoteId, collegePatch
        case essayHidden, commonAppPrompt, essaySchools, essayOption
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(listPrefs, forKey: .listPrefs)
        try c.encodeIfPresent(applicant, forKey: .applicant)
        try c.encodeIfPresent(profile, forKey: .profile)
        if case .some(let value) = ed { try c.encode(value, forKey: .ed) }
        try c.encodeIfPresent(criticalDates, forKey: .criticalDates)
        try c.encodeIfPresent(colleges, forKey: .colleges)
        try c.encodeIfPresent(essays, forKey: .essays)
        try c.encodeIfPresent(essayDrafts, forKey: .essayDrafts)
        try c.encodeIfPresent(plannerDone, forKey: .plannerDone)
        try c.encodeIfPresent(recommendations, forKey: .recommendations)
        try c.encodeIfPresent(scholarships, forKey: .scholarships)
        try c.encodeIfPresent(financialAid, forKey: .financialAid)
        try c.encodeIfPresent(essayDraft, forKey: .essayDraft)
        try c.encodeIfPresent(plannerToggle, forKey: .plannerToggle)
        try c.encodeIfPresent(recommendation, forKey: .recommendation)
        try c.encodeIfPresent(removeRecommendationId, forKey: .removeRecommendationId)
        try c.encodeIfPresent(scholarship, forKey: .scholarship)
        try c.encodeIfPresent(removeScholarshipId, forKey: .removeScholarshipId)
        try c.encodeIfPresent(removeAdvisorNoteId, forKey: .removeAdvisorNoteId)
        try c.encodeIfPresent(collegePatch, forKey: .collegePatch)
        try c.encodeIfPresent(essayHidden, forKey: .essayHidden)
        if case .some(let value) = commonAppPrompt { try c.encode(value, forKey: .commonAppPrompt) }
        try c.encodeIfPresent(essaySchools, forKey: .essaySchools)
        try c.encodeIfPresent(essayOption, forKey: .essayOption)
    }
}

extension WorkspacePatch {
    /// Builds a patch inline: `.with { $0.essayDraft = .init(id: id, text: text) }`.
    static func with(_ build: (inout WorkspacePatch) -> Void) -> WorkspacePatch {
        var patch = WorkspacePatch()
        build(&patch)
        return patch
    }
}
