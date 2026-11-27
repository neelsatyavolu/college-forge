import Foundation

/// Parent or counselor (lib/parents.ts). Counselors can also leave notes.
enum FollowerRole: String, Sendable, Hashable, CaseIterable, Identifiable {
    case parent, counselor

    var id: String { rawValue }
    var label: String { rawValue.capitalized }
    var defaultLevel: ParentLevel { self == .counselor ? .full : .basic }

    init(_ raw: String) { self = raw == "counselor" ? .counselor : .parent }
}

/// A dated item on a roster summary.
struct DatedItem: Codable, Hashable, Sendable {
    var date: String
    var title: String

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = c.string(.date)
        title = c.string(.title)
    }
}

/// One student's line on the roster (lib/follower-summary.ts), cut to what their level shows.
struct FollowerSummary: Codable, Hashable, Sendable {
    var applications = 0
    var submitted = 0
    var decisions = 0
    var overdue = 0
    var dueSoon = 0
    var flags = 0
    var next: DatedItem?
    var upcoming: [DatedItem] = []
    var attention = 0

    init() {}

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        applications = c.int(.applications)
        submitted = c.int(.submitted)
        decisions = c.int(.decisions)
        overdue = c.int(.overdue)
        dueSoon = c.int(.dueSoon)
        flags = c.int(.flags)
        next = c.optional(DatedItem.self, .next)
        upcoming = c.array(.upcoming)
        attention = c.int(.attention)
    }
}

/// One student a parent or counselor follows (GET /api/parent).
struct ParentStudent: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var name: String
    var cycle: String
    var role: String
    var level: String
    var levelLabel: String
    var applications: Int
    var summary: FollowerSummary

    var followerRole: FollowerRole { FollowerRole(role) }
}

extension ParentStudent {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.string(.id)
        name = c.string(.name)
        cycle = c.string(.cycle)
        role = c.string(.role, "parent")
        level = c.string(.level, "basic")
        levelLabel = c.string(.levelLabel)
        applications = c.int(.applications)
        summary = c.value(.summary, FollowerSummary())
    }
}

/// A note a counselor left (lib/parent-view.ts counselorNotes). `mine`: this counselor wrote it.
struct CounselorNote: Decodable, Sendable, Identifiable, Hashable {
    var id: String
    var body: String
    var author: String
    var createdAt: Double
    var essayId: String?
    var mine: Bool

    private enum CodingKeys: String, CodingKey { case id, body, author, createdAt, essayId, mine }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.string(.id)
        body = c.string(.body)
        author = c.string(.author)
        createdAt = c.double(.createdAt)
        essayId = c.optionalString(.essayId)
        mine = c.bool(.mine)
    }
}

struct ParentStudentList: Decodable, Sendable {
    var students: [ParentStudent]

    private enum CodingKeys: String, CodingKey { case students }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        students = c.array(.students)
    }
}

/// A student's dashboard as a parent or counselor sees it (GET /api/parent/:id, lib/parent-view.ts). Sections
/// the student's chosen level leaves out are nil; `notes` is nil for a parent.
struct ParentDashboardData: Decodable, Sendable {
    struct Student: Decodable, Sendable {
        var name: String
        var cycle: String

        private enum CodingKeys: String, CodingKey { case name, cycle }

        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            name = c.string(.name)
            cycle = c.string(.cycle)
        }
    }

    /// A college on the student's list (a few fields of `College`).
    struct ListedCollege: Decodable, Sendable, Identifiable {
        var slug: String
        var name: String
        var location: String?
        var tier: CollegeTier?
        var admit: String?
        var netPrice: String?
        var id: String { slug }

        private enum CodingKeys: String, CodingKey { case slug, name, short, location, tier, admit, netPrice }

        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            slug = c.string(.slug)
            let name = c.string(.name)
            self.name = name.isEmpty ? c.string(.short) : name
            location = c.optionalString(.location)
            tier = c.optional(CollegeTier.self, .tier)
            admit = c.optionalString(.admit)
            netPrice = c.optionalString(.netPrice)
        }
    }

    var level: String
    var levelLabel: String
    var levelSummary: String
    var student: Student
    var progress: TrackerView
    var criticalDates: [CriticalDate]
    var colleges: [ListedCollege]?
    var recommendations: [Recommendation]?
    var scholarships: [Scholarship]?
    var financialAid: FinancialAid?
    var applicant: Applicant?
    var profile: Profile?
    var essays: EssaySet?
    var essayDrafts: [String: String]
    var role: FollowerRole
    var notes: [CounselorNote]?

    private enum CodingKeys: String, CodingKey {
        case level, levelLabel, levelSummary, student, progress, criticalDates, colleges, recommendations, scholarships
        case financialAid, applicant, profile, essays, essayDrafts, role, notes
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        level = c.string(.level, "basic")
        levelLabel = c.string(.levelLabel)
        levelSummary = c.string(.levelSummary)
        student = try c.decode(Student.self, forKey: .student)
        progress = try c.decode(TrackerView.self, forKey: .progress)
        criticalDates = c.array(.criticalDates)
        colleges = c.contains(.colleges) ? c.array(.colleges) : nil
        recommendations = c.contains(.recommendations) ? c.array(.recommendations) : nil
        scholarships = c.contains(.scholarships) ? c.array(.scholarships) : nil
        financialAid = c.optional(FinancialAid.self, .financialAid)
        applicant = c.optional(Applicant.self, .applicant)
        profile = c.optional(Profile.self, .profile)
        essays = c.optional(EssaySet.self, .essays)
        essayDrafts = c.dictionary(.essayDrafts)
        role = FollowerRole(c.string(.role, "parent"))
        notes = c.contains(.notes) ? c.array(.notes) : nil
    }

    var firstName: String {
        student.name.split(separator: " ").first.map(String.init) ?? "Your student"
    }

    /// Dated items across the dashboard, soonest first.
    var deadlines: [(date: String, title: String, detail: String)] {
        var rows = criticalDates.map { (date: $0.date, title: $0.label, detail: $0.detail) }
        rows += progress.apps.filter { !$0.deadline.isEmpty && $0.submittedAt.isEmpty }
            .map { (date: $0.deadline, title: $0.round == .none ? $0.name : "\($0.name) · \($0.round.rawValue)", detail: "") }
        rows += (scholarships ?? []).compactMap { s in s.deadline.map { (date: $0, title: "Scholarship: \(s.name)", detail: "") } }
        rows += (recommendations ?? []).compactMap { r in r.deadline.map { (date: $0, title: "Letter: \(r.name)", detail: "") } }
        return rows.filter { !$0.date.isEmpty }.sorted { $0.date < $1.date }
    }
}

/// A parent or counselor link as the student sees it (GET/POST /api/parents).
struct ParentLinkInfo: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var email: String
    var role: String
    var level: String
    var status: String
    var invitedAt: Double
    var acceptedAt: Double?
    var parentName: String?
    var parentEmail: String?
    var expired: Bool

    var isActive: Bool { status == "active" }
    var displayName: String {
        guard isActive else { return email }
        return [parentName, parentEmail].compactMap { $0 }.first { !$0.isEmpty } ?? email
    }
}

extension ParentLinkInfo {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.string(.id)
        email = c.string(.email)
        role = c.string(.role, "parent")
        level = c.string(.level, "basic")
        status = c.string(.status)
        invitedAt = c.double(.invitedAt)
        acceptedAt = c.optionalDouble(.acceptedAt)
        parentName = c.optionalString(.parentName)
        parentEmail = c.optionalString(.parentEmail)
        expired = c.bool(.expired)
    }
}

/// Reply to POST /api/parents.
struct ParentsReply: Decodable, Sendable {
    var data: [ParentLinkInfo]
    var url: String?
    var emailed: Bool

    private enum CodingKeys: String, CodingKey { case data, url, emailed }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        data = c.array(.data)
        url = c.optionalString(.url)
        emailed = c.bool(.emailed)
    }
}

/// The three levels a student can choose (lib/parent-view.ts PARENT_LEVEL_INFO).
enum ParentLevel: String, CaseIterable, Identifiable, Sendable {
    case basic, standard, full

    var id: String { rawValue }
    var label: String { rawValue.capitalized }
    var summary: String {
        switch self {
        case .basic: "Applications, statuses, deadlines and decisions you've opened."
        case .standard: "Basic, plus to-dos, your college list, letters, scholarships and financial aid."
        case .full: "Standard, plus your profile (GPA, scores, activities) and essay drafts. Read-only."
        }
    }
}

extension APIClient {
    func parentStudents() async throws -> [ParentStudent] {
        try await get("/api/parent", as: DataEnvelope<ParentStudentList>.self).data.students
    }

    private func parentPath(_ id: String) -> String {
        "/api/parent/" + (id.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-_"))) ?? "")
    }

    func parentDashboard(id: String) async throws -> ParentDashboardData {
        try await get(parentPath(id), as: DataEnvelope<ParentDashboardData>.self).data
    }

    /// Counselors only: leave a note, on an essay or in general. Returns the refreshed dashboard.
    func leaveCounselorNote(studentID: String, body: String, essayID: String?) async throws -> ParentDashboardData {
        var fields: [String: JSONValue] = ["action": .string("note"), "body": .string(body)]
        if let essayID { fields["essayId"] = .string(essayID) }
        let reply: DataEnvelope<ParentDashboardData> = try await post(parentPath(studentID), body: fields)
        return reply.data
    }

    func deleteCounselorNote(studentID: String, noteID: String) async throws -> ParentDashboardData {
        let fields: [String: JSONValue] = ["action": .string("delete-note"), "noteId": .string(noteID)]
        let reply: DataEnvelope<ParentDashboardData> = try await post(parentPath(studentID), body: fields)
        return reply.data
    }

    func parents() async throws -> [ParentLinkInfo] {
        try await get("/api/parents", as: DataEnvelope<[ParentLinkInfo]>.self).data
    }

    func parentsAction(_ fields: [String: JSONValue]) async throws -> ParentsReply {
        try await post("/api/parents", body: fields)
    }
}
