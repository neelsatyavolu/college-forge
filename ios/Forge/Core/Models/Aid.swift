import Foundation

/// A school's financial aid offer as the student entered it (`TrackedApplication.aidOffer`, lib/aid-validate.ts).
/// Whole US dollars per year. Private to the student: never on share links or parent views.
struct AidOffer: Codable, Hashable, Sendable {
    var costOfAttendance: Int?
    /// Grants and scholarships from the school (money not paid back).
    var grants: Int?
    var loans: Int?
    var workStudy: Int?
    var notes: String?
    /// Milliseconds since 1970.
    var updatedAt: Double?
}

extension AidOffer {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        costOfAttendance = c.optionalInt(.costOfAttendance)
        grants = c.optionalInt(.grants)
        loans = c.optionalInt(.loans)
        workStudy = c.optionalInt(.workStudy)
        notes = c.optionalString(.notes)
        updatedAt = c.optionalDouble(.updatedAt)
    }
}

/// GET /api/aid `data` (lib/aid-plan.ts): which aid forms each school on the Applications tab asks for.
struct AidPlan: Decodable, Hashable, Sendable {
    var schools: [AidSchool]
    var totals: AidTotals

    static let empty = AidPlan(schools: [], totals: AidTotals())
}

extension AidPlan {
    private enum CodingKeys: String, CodingKey { case schools, totals }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schools = c.array(.schools)
        totals = c.value(.totals, AidTotals())
    }
}

struct AidTotals: Codable, Hashable, Sendable {
    var cssSchools = 0
    var idocSchools = 0
    var scholarshipsWon = 0
    var wonAmount = 0
}

extension AidTotals {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cssSchools = c.int(.cssSchools)
        idocSchools = c.int(.idocSchools)
        scholarshipsWon = c.int(.scholarshipsWon)
        wonAmount = c.int(.wonAmount)
    }
}

/// "required", "not_required" or "unknown" (check the school's aid page; never read as "not required").
struct CssNeed: OpenEnum {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }
    static let required = Self(rawValue: "required")
    static let notRequired = Self(rawValue: "not_required")
    static let unknown = Self(rawValue: "unknown")

    var label: String {
        switch self {
        case .required: "CSS Profile"
        case .notRequired: "No CSS Profile"
        default: "Check aid page"
        }
    }
}

struct AidSchool: Decodable, Hashable, Sendable, Identifiable {
    var appId: String
    var name: String
    var ignoreAid: Bool
    var css: CssNeed
    var idoc: Bool
    var cssSource: String
    var cssCheckedAt: String
    var deadlines: [AidDeadline]
    var followUps: [AidFollowUp]
    /// Follow-ups "Add to-dos" creates through `.followUpAdd`.
    var todos: [AidTodo]

    var id: String { appId }
}

extension AidSchool {
    private enum CodingKeys: String, CodingKey {
        case appId, name, ignoreAid, css, idoc, cssSource, cssCheckedAt, deadlines, followUps, todos
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        appId = c.string(.appId)
        name = c.string(.name)
        ignoreAid = c.bool(.ignoreAid)
        css = c.value(.css, .unknown)
        idoc = c.bool(.idoc)
        cssSource = c.string(.cssSource)
        cssCheckedAt = c.string(.cssCheckedAt)
        deadlines = c.array(.deadlines)
        followUps = c.array(.followUps)
        todos = c.array(.todos)
    }
}

/// `kind` is "aid" or "scholarship"; `date` is yyyy-mm-dd.
struct AidDeadline: Codable, Hashable, Sendable {
    var plan: String
    var date: String
    var kind: String
}

struct AidFollowUp: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var text: String
    var due: String
}

struct AidTodo: Codable, Hashable, Sendable {
    var text: String
    var due: String
}

extension APIClient {
    /// GET /api/aid: read-only; to-dos are added with the applications `followup-add` action.
    func aidPlan() async throws -> AidPlan {
        try await get("/api/aid", as: DataEnvelope<AidPlan>.self).data
    }
}
