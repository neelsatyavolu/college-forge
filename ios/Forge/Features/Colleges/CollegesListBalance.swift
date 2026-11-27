import Foundation

enum CollegesAmbition: String, CaseIterable, Sendable {
    case conservative, balanced, ambitious

    var label: String {
        switch self {
        case .conservative: "More likely options"
        case .balanced: "Balanced mix"
        case .ambitious: "More reaches"
        }
    }

    var moreAmbitious: Self? {
        switch self {
        case .conservative: .balanced
        case .balanced: .ambitious
        case .ambitious: nil
        }
    }

    var safer: Self? {
        switch self {
        case .conservative: nil
        case .balanced: .conservative
        case .ambitious: .balanced
        }
    }
}

extension CollegesShortlist {
    static func balanceWarnings(_ colleges: [College]) -> [String] {
        let likely = applicationSlots(colleges.filter { $0.tier == .safety })
        let reaches = applicationSlots(colleges.filter { $0.tier == .reach })
        let total = applicationSlots(colleges)
        var warnings: [String] = []
        if likely < 2 {
            warnings.append("Your list has \(likely) likely \(likely == 1 ? "school" : "schools"). Add at least two you would be glad to attend.")
        }
        if reaches > total / 2 {
            warnings.append("\(reaches) of your \(total) applications are reaches. Keeping reaches to half the list or fewer leaves room for schools you are likely to get into.")
        }
        return warnings
    }
}

struct CollegesListGap: Decodable, Hashable, Sendable {
    var tier: CollegeTier
    var missing: Int
    var goal: Int?

    func message(for colleges: [College]) -> String? {
        let count = goal.map { $0 - colleges.filter { $0.tier == tier }.count } ?? missing
        guard count > 0 else { return nil }
        let word = tier == .safety ? "likely" : tier.rawValue
        return "Rebalancing could not find \(count) more \(word) \(count == 1 ? "school" : "schools") that fit your preferences. Add your own from Explore."
    }
}

struct CollegesRebalanceResponse: Decodable, Sendable {
    let data: Workspace
    let added: [String]
    let removed: [String]
    let gaps: [CollegesListGap]

    func summary(shiftedTo ambition: CollegesAmbition?) -> String {
        var sentences = ambition.map { ["List balance set to \($0.label.lowercased())."] } ?? []
        if !added.isEmpty { sentences.append("Added \(added.joined(separator: ", ")).") }
        if !removed.isEmpty { sentences.append("Removed \(removed.joined(separator: ", ")).") }
        if added.isEmpty && removed.isEmpty {
            sentences.append("Nothing changed. Every school on your list is one you or the copilot added, or the list already matches this balance.")
        }
        return sentences.joined(separator: " ")
    }
}

extension APIClient {
    func rebalanceCollegeList() async throws -> CollegesRebalanceResponse {
        try await post("/api/workspace", body: ["action": "rebalance"])
    }
}
