import Foundation

/// Six measures the career ranking weighs, in the server's order.
typealias RankingsWeights = [String: Double]

struct RankingsFlags: Codable, Hashable, Sendable {
    /// Adjust pay for cost of living.
    var col = true
    /// Adjust for who gets in.
    var va = false
    /// Count competitive switches.
    var stretch = false
}

/// The settings sent to POST /api/rankings/view.
struct RankingsRequest: Codable, Hashable, Sendable {
    var view = "path"
    var weights: RankingsWeights?
    var flags: RankingsFlags?
    var targets: [String]?
}

/// The server's finished ranking (lib/rankings-view.ts).
struct RankingsResponse: Decodable, Sendable {
    let total: Int
    let generated: String
    let signedIn: Bool
    let hasWorkspace: Bool
    let view: String
    let title: String
    let tabs: [RankingsTab]
    let majors: [RankingsMajor]
    let targets: [String]
    let weights: RankingsWeights
    let flags: RankingsFlags
    let defaults: RankingsDefaults
    let pillars: [RankingsPillar]
    let rows: [RankingsRow]
    let missing: [String]
    let ai: RankingsAiList?

    var isPath: Bool { view == "path" || view == "admitted" }
}

struct RankingsTab: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let label: String
}

struct RankingsMajor: Decodable, Hashable, Sendable, Identifiable {
    let key: String
    let label: String
    var id: String { key }
}

struct RankingsDefaults: Decodable, Sendable {
    let weights: RankingsWeights
    let flags: RankingsFlags
}

struct RankingsPillar: Decodable, Hashable, Sendable, Identifiable {
    let key: String
    let label: String
    let sub: String
    let note: String
    var id: String { key }
}

struct RankingsRow: Decodable, Hashable, Sendable, Identifiable {
    let id: Int
    let name: String
    let logo: String?
    let place: String
    let rank: String
    let best: Int
    let worst: Int
    let score: Int
    let admitted: Bool
    let notes: [String]
    let counted: String
    let pay4: Double?
    let top1: Double?
    let top1System: String?
    let usNews: Int?
    let usNewsLac: Bool
    let niche: Int?
    let forbes: Int?
    let measures: [RankingsMeasure]
    let facts: RankingsFacts
    let switches: [RankingsSwitch]

    /// Where the school lands if any one career measure is dropped, when that differs from its rank.
    var range: String? { best == worst ? nil : "\(best)–\(worst)" }
}

struct RankingsMeasure: Decodable, Hashable, Sendable, Identifiable {
    let key: String
    /// Percent of the score.
    let share: Int
    let word: String
    /// Better than about this share of the ranked schools; nil without data.
    let percentile: Int?
    var id: String { key }
}

struct RankingsFacts: Decodable, Hashable, Sendable {
    let topQuarter: Double?
    let bottomQuarter: Double?
    let idle: Double?
    let grad: Double?
    let admit: Double?
    let campus: String?
    let dorms: String?
    let food: String?
}

struct RankingsSwitch: Decodable, Hashable, Sendable {
    let name: String
    let how: String
}

struct RankingsAiList: Decodable, Sendable {
    let about: String
    let made: String
    let list: [RankingsAiItem]
}

struct RankingsAiItem: Decodable, Hashable, Sendable, Identifiable {
    let rank: String
    let school: String
    let why: String
    let id: Int?
    let logo: String?
    let place: String?
    let formula: String?
    let admitted: Bool
}

enum RankingsFormat {
    static func money(_ v: Double?) -> String {
        guard let v else { return "—" }
        return "$\(Int((v / 1000).rounded()))k"
    }

    static func percent(_ v: Double?, digits: Int = 1) -> String {
        guard let v else { return "—" }
        return (v * 100).formatted(.number.precision(.fractionLength(digits))) + "%"
    }

    static func rank(_ v: Int?) -> String {
        v.map { "#\($0)" } ?? "—"
    }
}

extension APIClient {
    func rankingsView(_ request: RankingsRequest) async throws -> RankingsResponse {
        try await post("/api/rankings/view", body: request)
    }
}
