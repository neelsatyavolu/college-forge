import Foundation

/// The published lists in /data/official-rankings.json (scripts/fetch-official-rankings.mjs), as the website's Official rankings tab shows them.
struct OfficialRankings: Decodable, Sendable {
    let generated: String
    let editions: [String: String]
    let lists: [String: [OfficialRankingRow]]

    func edition(for list: OfficialRankingList) -> String? {
        editions[list == .lac ? "usn" : list.rawValue]
    }
}

struct OfficialRankingRow: Decodable, Hashable, Sendable {
    let rank: Int
    let name: String
    let city: String?
    let state: String?
    let logo: String?
    let facts: OfficialRankingFacts?
    let elsewhere: [String: Int]?
    let stars: Double?
    let reviews: Int?

    var place: String { [city, state].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ") }
}

struct OfficialRankingFacts: Decodable, Hashable, Sendable {
    let admitRate: Double?
    let sat: String?
    let cost: Double?
    let salary: Double?
    let undergrads: Double?
    let setting: String?
    let website: String?
}

enum OfficialRankingList: String, CaseIterable, Identifiable, Sendable {
    case usn, lac, forbes, niche
    var id: String { rawValue }

    var label: String {
        switch self {
        case .usn: "U.S. News"
        case .lac: "Liberal arts"
        case .forbes: "Forbes"
        case .niche: "Niche"
        }
    }

    var title: String {
        switch self {
        case .usn: "U.S. News National Universities"
        case .lac: "U.S. News National Liberal Arts Colleges"
        case .forbes: "Forbes America’s Top Colleges"
        case .niche: "Niche Best Colleges in America"
        }
    }

    var top: Int { self == .lac ? 50 : 100 }

    /// The name used when another list's rank is shown on a school.
    static func otherLabel(_ key: String) -> String {
        key == "lac" ? "U.S. News liberal arts" : OfficialRankingList(rawValue: key)?.label ?? key
    }
}

/// Opens one school from an official list.
struct OfficialRankingRoute: Hashable {
    let row: OfficialRankingRow
    let list: String
}

/// Pushes the Official rankings screen.
struct OfficialRankingsRoute: Hashable {}

extension APIClient {
    func officialRankings() async throws -> OfficialRankings {
        try await get("/data/official-rankings.json")
    }
}
