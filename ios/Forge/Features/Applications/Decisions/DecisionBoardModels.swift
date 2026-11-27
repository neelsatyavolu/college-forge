import Foundation

/// GET /api/decisions/board (lib/decision-board.ts): the schools that admitted the student, waitlisted and
/// deferred ones marked, plus the AI's saved picks. Only the student sees it.
struct DecisionBoardResponse: Decodable, Sendable {
    struct Cost: Decodable, Sendable, Hashable {
        let amount: Double
        /// "offer", "income", "sticker" or "average".
        let basis: String
        let label: String
    }

    struct Switch: Decodable, Sendable, Hashable {
        let major: String
        let label: String
    }

    struct Award: Decodable, Sendable, Hashable {
        let name: String
        let amount: String
    }

    struct School: Decodable, Sendable, Identifiable, Hashable {
        let id: String
        let name: String
        let logo: String?
        /// "committed", "admitted", "waitlisted" or "deferred".
        let standing: String
        let pickable: Bool
        let average: Double?
        let rankSummary: String
        let careerCovered: Bool
        let pros: [String]
        let cons: [String]
        let `switch`: [Switch]
        let cost: Cost?
        let costNote: String
        let aidOffer: AidOffer?
        let awards: [Award]
        let notes: String
        let decisionNote: String

        var standingLabel: String {
            switch standing {
            case "committed": "Committed"
            case "admitted": "Admitted"
            case "waitlisted": "Waitlisted"
            case "deferred": "Deferred"
            default: standing.capitalized
            }
        }

        var costText: String { cost?.label ?? costNote }
    }

    struct Pick: Decodable, Sendable, Hashable {
        let appId: String
        let headline: String
        let why: String
        let watchOut: String
    }

    struct Row: Decodable, Sendable, Hashable {
        let label: String
        let a: String
        let b: String
    }

    struct Picks: Decodable, Sendable, Hashable {
        let picks: [Pick]
        let rows: [Row]
        let summary: String
        let madeAt: String
    }

    let schools: [School]
    let picks: Picks?
    /// Something the picks read changed since they were made.
    let stale: Bool
    /// The majors the board judges by, switch-to majors first.
    let targets: [String]
}

/// GET /api/ai/decision-plan: the one chat request behind "Get my picks".
struct DecisionPlanResponse: Decodable, Sendable {
    struct Step: Decodable, Sendable {
        let label: String
        let prompt: String
    }

    let step: Step
}

extension AidOffer {
    /// "Grants $58,000 · Loans $5,500 · Work-study $2,000 a year" plus the notes, or nil when there's nothing past the cost line.
    var boardDetails: String? {
        let amounts = [("Grants", grants), ("Loans", loans), ("Work-study", workStudy)].compactMap { label, v in v.map { "\(label) $\($0.formatted())" } }
        let parts = [amounts.isEmpty ? nil : amounts.joined(separator: " · ") + " a year", notes].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}
