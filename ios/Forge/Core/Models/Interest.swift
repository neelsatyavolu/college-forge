import Foundation

/// Kinds of contact a student logs with a school (lib/interest-log.ts `INTEREST_KINDS`).
struct InterestKind: OpenEnum {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }
    static let visit = Self(rawValue: "visit")
    static let virtualSession = Self(rawValue: "virtual_session")
    static let infoSession = Self(rawValue: "info_session")
    static let fair = Self(rawValue: "fair")
    static let interview = Self(rawValue: "interview")
    static let aoContact = Self(rawValue: "ao_contact")
    static let emailOpened = Self(rawValue: "email_opened")
    static let other = Self(rawValue: "other")

    static let all: [InterestKind] = [.visit, .infoSession, .virtualSession, .fair, .interview, .aoContact, .emailOpened, .other]

    var label: String {
        switch self {
        case .visit: "Campus visit"
        case .virtualSession: "Virtual session"
        case .infoSession: "Info session"
        case .fair: "College fair"
        case .interview: "Interview"
        case .aoContact: "Admissions officer contact"
        case .emailOpened: "Opened their emails"
        default: "Other"
        }
    }
}

/// One logged visit, session, interview or contact. `time` is "HH:MM" (24-hour) or nil.
struct InterestEvent: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var kind: InterestKind
    /// yyyy-mm-dd.
    var date: String
    var time: String?
    var who: String?
    var notes: String?
    /// Interview prep the copilot drafted.
    var prep: String?
    /// Interviews only.
    var thankYouSent: Bool?
    var done: Bool
    var createdAt: Double

    var isInterview: Bool { kind == .interview }
    var owesThankYou: Bool { isInterview && done && thankYouSent != true }
}

extension InterestEvent {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.string(.id)
        kind = c.value(.kind, .other)
        date = c.string(.date)
        time = c.optionalString(.time)
        who = c.optionalString(.who)
        notes = c.optionalString(.notes)
        prep = c.optionalString(.prep)
        thankYouSent = c.optionalBool(.thankYouSent)
        done = c.bool(.done)
        createdAt = c.double(.createdAt)
    }
}

/// A sourced research quote and the page it came from.
struct InterestFact: Codable, Hashable, Sendable {
    var text: String
    var sourceUrl: String
}

extension InterestFact {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        text = c.string(.text)
        sourceUrl = c.string(.sourceUrl)
    }
}

/// What the school says about demonstrated interest and interviews, and a nudge when one is due (`interestSignal`).
struct InterestSignal: Codable, Hashable, Sendable {
    /// "important", "considered", "not_considered" or "unknown".
    var counts: String = "unknown"
    /// "evaluative", "informational", "by_invitation", "not_offered" or "unknown".
    var interview: String = "unknown"
    var countsFact: InterestFact?
    var interviewFact: InterestFact?
    var logged: Int = 0
    var thankYouOwed: Int = 0
    var nudge: String?

    var countsLabel: String? {
        switch counts {
        case "important": "Interest counts a lot"
        case "considered": "Interest is considered"
        case "not_considered": "Interest not tracked"
        default: nil
        }
    }

    var interviewLabel: String? {
        switch interview {
        case "evaluative": "Interviews count"
        case "informational": "Interviews are informational"
        case "by_invitation": "Interviews by invitation"
        case "not_offered": "No interviews"
        default: nil
        }
    }
}

extension InterestSignal {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        counts = c.string(.counts, "unknown")
        interview = c.string(.interview, "unknown")
        countsFact = c.optional(InterestFact.self, .countsFact)
        interviewFact = c.optional(InterestFact.self, .interviewFact)
        logged = c.int(.logged)
        thankYouOwed = c.int(.thankYouOwed)
        nudge = c.optionalString(.nudge)
    }
}

/// Fields `.interestAdd` / `.interestSet` send. Nil fields are left alone.
struct InterestEdit: Encodable, Hashable, Sendable {
    var kind: InterestKind?
    var date: String?
    var time: String?
    var who: String?
    var notes: String?
    var thankYouSent: Bool?
    var done: Bool?
    var remove: Bool?
}
