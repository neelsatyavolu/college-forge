import Foundation

/// The student's Early Decision choice (`Workspace.ed`), or nil.
struct EarlyDecision: Codable, Hashable, Sendable {
    var school = ""
    var deadline = ""
    var daysLeft = ""
    var reason = ""
}

extension EarlyDecision {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        school = c.string(.school)
        deadline = c.string(.deadline)
        daysLeft = c.string(.daysLeft)
        reason = c.string(.reason)
    }
}

/// A timeline date. `source == "student"` marks one the student added; AI rewrites keep those.
struct CriticalDate: Codable, Hashable, Sendable {
    var date = ""
    var label = ""
    var detail = ""
    var source: String?
}

extension CriticalDate {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = c.string(.date)
        label = c.string(.label)
        detail = c.string(.detail)
        source = c.optionalString(.source)
    }
}

struct Recommendation: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var name: String
    var type: RecommenderType
    var subject: String?
    var status: RecommendationStatus
    var deadline: String?
    var notes: String?
}

extension Recommendation {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.string(.id)
        name = c.string(.name)
        type = c.value(.type, .teacher)
        subject = c.optionalString(.subject)
        status = c.value(.status, .notAsked)
        deadline = c.optionalString(.deadline)
        notes = c.optionalString(.notes)
    }
}

struct RecommenderType: OpenEnum {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }
    static let counselor = Self(rawValue: "counselor")
    static let teacher = Self(rawValue: "teacher")
    static let other = Self(rawValue: "other")
    static let all: [Self] = [.counselor, .teacher, .other]

    var label: String {
        switch self {
        case .counselor: "Counselor"
        case .teacher: "Teacher"
        default: "Other"
        }
    }
}

struct RecommendationStatus: OpenEnum {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }
    static let notAsked = Self(rawValue: "not_asked")
    static let asked = Self(rawValue: "asked")
    static let inProgress = Self(rawValue: "in_progress")
    static let submitted = Self(rawValue: "submitted")
    static let waived = Self(rawValue: "waived")
    static let all: [Self] = [.notAsked, .asked, .inProgress, .submitted, .waived]

    var label: String {
        switch self {
        case .notAsked: "Not asked"
        case .asked: "Asked"
        case .inProgress: "Writing"
        case .submitted: "Submitted"
        case .waived: "Waived"
        default: rawValue.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
}

struct Scholarship: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var name: String
    var amount: String?
    var deadline: String?
    var status: ScholarshipStatus
    var url: String?
    var notes: String?
}

extension Scholarship {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.string(.id)
        name = c.string(.name)
        amount = c.optionalString(.amount)
        deadline = c.optionalString(.deadline)
        status = c.value(.status, .researching)
        url = c.optionalString(.url)
        notes = c.optionalString(.notes)
    }
}

struct ScholarshipStatus: OpenEnum {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }
    static let researching = Self(rawValue: "researching")
    static let inProgress = Self(rawValue: "in_progress")
    static let submitted = Self(rawValue: "submitted")
    static let won = Self(rawValue: "won")
    static let lost = Self(rawValue: "lost")
    static let skipped = Self(rawValue: "skipped")
    static let all: [Self] = [.researching, .inProgress, .submitted, .won, .lost, .skipped]

    var label: String {
        switch self {
        case .inProgress: "In progress"
        default: rawValue.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
}

struct FinancialAid: Codable, Hashable, Sendable {
    var fafsaStatus: AidFormStatus = .notStarted
    var cssStatus: AidFormStatus = .notStarted
    var fafsaOpenDate: String?
    var notes: String?
}

extension FinancialAid {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        fafsaStatus = c.value(.fafsaStatus, .notStarted)
        cssStatus = c.value(.cssStatus, .notStarted)
        fafsaOpenDate = c.optionalString(.fafsaOpenDate)
        notes = c.optionalString(.notes)
    }
}

/// FAFSA / CSS Profile status. `notApplicable` is only valid for the CSS Profile.
struct AidFormStatus: OpenEnum {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }
    static let notStarted = Self(rawValue: "not_started")
    static let inProgress = Self(rawValue: "in_progress")
    static let submitted = Self(rawValue: "submitted")
    static let processed = Self(rawValue: "processed")
    static let notApplicable = Self(rawValue: "n_a")

    var label: String {
        switch self {
        case .notStarted: "Not started"
        case .inProgress: "In progress"
        case .submitted: "Submitted"
        case .processed: "Processed"
        case .notApplicable: "Not needed"
        default: rawValue
        }
    }
}

/// A comment left by a counselor or parent through a share link.
struct AdvisorNote: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var body: String
    var author: String
    /// Milliseconds since 1970.
    var createdAt: Double
    var essayId: String?
    /// "progress" or "full": which kind of share link it came through.
    var via: String?

    var createdDate: Date { Date(milliseconds: createdAt) }
}

extension AdvisorNote {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.string(.id)
        body = c.string(.body)
        author = c.string(.author, "Advisor")
        createdAt = c.double(.createdAt)
        essayId = c.optionalString(.essayId)
        via = c.optionalString(.via)
    }
}

/// A share link. Its URL is `<base>/hub/share.html?t=<token>` (`AppConfig.shareURL(token:)`).
struct ShareMeta: Codable, Hashable, Sendable, Identifiable {
    var token: String
    var label: String
    /// "progress" (parents, counselors) or "full" (advisors).
    var scope: String?
    var createdAt: Double
    var revokedAt: Double?

    var id: String { token }
    var isActive: Bool { revokedAt == nil }
}

extension ShareMeta {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        token = c.string(.token)
        label = c.string(.label)
        scope = c.optionalString(.scope)
        createdAt = c.double(.createdAt)
        revokedAt = c.optionalDouble(.revokedAt)
    }
}

struct UploadMeta: Codable, Hashable, Sendable {
    var name = ""
    var chars = 0
    var uploadedAt: Double = 0
}

extension UploadMeta {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.string(.name)
        chars = c.int(.chars)
        uploadedAt = c.double(.uploadedAt)
    }
}
