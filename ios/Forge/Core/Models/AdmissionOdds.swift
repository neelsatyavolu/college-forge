import Foundation

/// An AI chance estimate for one school (lib/admission-odds.ts).
struct AdmissionOdds: Codable, Hashable, Sendable {
    /// The estimate, a whole percent, with its range.
    var percent: Int
    var low: Int
    var high: Int
    /// The published admit rate the estimate started from.
    var baseline: Int
    var baselineSource: String
    var summary: String
    var factors: [OddsFactor]
    /// https links the research used.
    var sources: [String]
    /// ISO-8601 timestamp.
    var estimatedAt: String
}

extension AdmissionOdds {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        percent = c.int(.percent)
        low = c.int(.low)
        high = c.int(.high)
        baseline = c.int(.baseline)
        baselineSource = c.string(.baselineSource)
        summary = c.string(.summary)
        factors = c.array(.factors)
        sources = c.array(.sources)
        estimatedAt = c.string(.estimatedAt)
    }
}

struct OddsFactor: Codable, Hashable, Sendable {
    var label: String
    /// "up", "down" or "neutral".
    var effect: String
    var detail: String
}

extension OddsFactor {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        label = c.string(.label)
        effect = c.string(.effect, "neutral")
        detail = c.string(.detail)
    }
}

/// What the AI took from the student's whole application on the last estimate run.
struct ApplicationRead: Codable, Hashable, Sendable {
    var summary: String
    var academics: String
    var activities: String
    var essays: String
    var context: String
    var strengths: [String]
    var concerns: [String]
    var readAt: String
}

extension ApplicationRead {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        summary = c.string(.summary)
        academics = c.string(.academics)
        activities = c.string(.activities)
        essays = c.string(.essays)
        context = c.string(.context)
        strengths = c.array(.strengths)
        concerns = c.array(.concerns)
        readAt = c.string(.readAt)
    }
}
