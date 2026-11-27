import Foundation

/// One school's testing plan (lib/testing-plan.ts `TestingPlanView`): the sourced SAT/ACT policy, Forge's
/// suggestion from the student's scores and the school's middle 50%, and the student's own choice.
struct TestingPlanView: Codable, Hashable, Sendable {
    var policy: TestPolicy
    var recommendation: TestingRecommendation
    var choice: TestingChoice
    var hasAps: Bool
    /// Planned to send official scores but no order recorded yet.
    var needsScoreSend: Bool
}

extension TestingPlanView {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        policy = c.value(.policy, TestPolicy())
        recommendation = c.value(.recommendation, TestingRecommendation())
        choice = c.value(.choice, TestingChoice())
        hasAps = c.bool(.hasAps)
        needsScoreSend = c.bool(.needsScoreSend)
    }
}

struct TestPolicy: Codable, Hashable, Sendable {
    /// "required", "optional", "blind", "flexible" or "unknown".
    var kind = "unknown"
    var selfReport: Bool?
    var superscore: Bool?
    var text = ""
    var sourceUrl = ""

    var label: String {
        switch kind {
        case "required": "Test-required"
        case "optional": "Test-optional"
        case "blind": "Test-blind"
        case "flexible": "Varies by program"
        default: "Policy not on file"
        }
    }

    /// "Test-optional · self-reported scores accepted · superscores".
    var summary: String {
        var bits = [label]
        if selfReport == true { bits.append("self-reported scores accepted") }
        if selfReport == false { bits.append("official scores only") }
        if superscore == true { bits.append("superscores") }
        if superscore == false { bits.append("no superscoring") }
        return bits.joined(separator: " · ")
    }
}

extension TestPolicy {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = c.string(.kind, "unknown")
        selfReport = c.optionalBool(.selfReport)
        superscore = c.optionalBool(.superscore)
        text = c.string(.text)
        sourceUrl = c.string(.sourceUrl)
    }
}

struct TestingRecommendation: Codable, Hashable, Sendable {
    /// "send", "your_call", "consider_withholding", "dont_send", "no_score" or "check_site".
    var advice = "check_site"
    var label = "Check the school's site"
    var reason = ""
    var sourceUrl = ""
}

extension TestingRecommendation {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        advice = c.string(.advice, "check_site")
        label = c.string(.label, "Check the school's site")
        reason = c.string(.reason)
        sourceUrl = c.string(.sourceUrl)
    }
}

enum TestPlanChoice: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case undecided, send, withhold
    var id: String { rawValue }
    var label: String {
        switch self {
        case .undecided: "Not decided"
        case .send: "Send scores"
        case .withhold: "Apply without scores"
        }
    }
}

enum TestMethod: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case selfReport = "self_report"
    case official
    var id: String { rawValue }
    var label: String {
        switch self {
        case .selfReport: "Self-report"
        case .official: "Official report"
        }
    }
}

/// The student's saved choice for one school.
struct TestingChoice: Codable, Hashable, Sendable {
    var plan: TestPlanChoice = .undecided
    var method: TestMethod?
    /// yyyy-mm-dd the official report was ordered.
    var officialSent: String?
    var apSelfReported: Bool?
}

extension TestingChoice {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        plan = c.value(.plan, .undecided)
        method = c.optional(TestMethod.self, .method)
        officialSent = c.optionalString(.officialSent)
        apSelfReported = c.optionalBool(.apSelfReported)
    }
}

/// A testing-plan edit sent inside `ApplicationEdit.testing`. Nil fields are left alone; "" clears
/// `method` or `officialSent`.
struct TestingEdit: Encodable, Hashable, Sendable {
    var plan: TestPlanChoice?
    var method: String?
    var officialSent: String?
    var apSelfReported: Bool?
}

extension TestingChoice {
    /// The choice after `edit`, mirroring the server's merge (lib/testing-plan.ts `applyTestingEdit`).
    func applying(_ edit: TestingEdit) -> TestingChoice {
        var next = self
        if let plan = edit.plan { next.plan = plan }
        if let method = edit.method { next.method = TestMethod(rawValue: method) }
        if let sent = edit.officialSent { next.officialSent = sent.isEmpty ? nil : sent }
        if let ap = edit.apSelfReported { next.apSelfReported = ap }
        return next
    }
}
