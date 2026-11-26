import Foundation

/// The published lists in /data/official-rankings.json (scripts/fetch-official-rankings.mjs), as the website's Official rankings tab shows them.
struct OfficialRankings: Decodable, Sendable {
    let generated: String
    let editions: [String: String]
    let lists: [String: [OfficialRankingRow]]

    func edition(for list: OfficialRankingList) -> String? {
        switch list {
        case .forge: nil
        case .lac: editions["usn"]
        case .prPublic, .prPrivate: editions["pr"]
        default: editions[list.rawValue]
        }
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
    /// The Forge ranking's weighted average rank.
    let avg: Double?

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
    case forge, usn, lac, forbes, niche, wsj, prPublic, prPrivate
    var id: String { rawValue }

    var label: String {
        switch self {
        case .forge: "Forge"
        case .usn: "U.S. News"
        case .lac: "Liberal arts"
        case .forbes: "Forbes"
        case .niche: "Niche"
        case .wsj: "WSJ"
        case .prPublic: "Best value public"
        case .prPrivate: "Best value private"
        }
    }

    var title: String {
        switch self {
        case .forge: "Forge ranking"
        case .usn: "U.S. News National Universities"
        case .lac: "U.S. News National Liberal Arts Colleges"
        case .forbes: "Forbes America’s Top Colleges"
        case .niche: "Niche Best Colleges in America"
        case .wsj: "WSJ/College Pulse Best Colleges in the U.S."
        case .prPublic: "Princeton Review Top 50 Best Value Colleges (Public)"
        case .prPrivate: "Princeton Review Top 50 Best Value Colleges (Private)"
        }
    }

    var top: Int {
        switch self {
        case .lac, .prPublic, .prPrivate: 50
        default: 100
        }
    }

    /// The name used when another list's rank is shown on a school.
    static func otherLabel(_ key: String) -> String {
        switch key {
        case "lac": "U.S. News liberal arts"
        case "prPublic": "Princeton Review Best Value (public)"
        case "prPrivate": "Princeton Review Best Value (private)"
        default: OfficialRankingList(rawValue: key)?.label ?? key
        }
    }

    /// How the Forge ranking is built (public/hub/rank-list.js).
    static let forgeAbout = "Each school’s ranks averaged with fixed weights: U.S. News and Forbes count fully, Niche ¾, WSJ ½ and the Princeton Review ¼. Liberal arts and Princeton Review ranks count at the national rank of the same standing. A school needs U.S. News plus Niche’s worth of weight or more to be ranked, so one list alone can’t place it."
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
