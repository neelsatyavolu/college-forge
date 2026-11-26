import Foundation

/// One student a parent follows (GET /api/parent).
struct ParentStudent: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var name: String
    var cycle: String
    var level: String
    var levelLabel: String
    var applications: Int
}

extension ParentStudent {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.string(.id)
        name = c.string(.name)
        cycle = c.string(.cycle)
        level = c.string(.level, "basic")
        levelLabel = c.string(.levelLabel)
        applications = c.int(.applications)
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

/// A student's dashboard as a parent sees it (GET /api/parent/:id, lib/parent-view.ts). Sections the
/// student's chosen level leaves out are nil.
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

    private enum CodingKeys: String, CodingKey {
        case level, levelLabel, levelSummary, student, progress, criticalDates, colleges, recommendations, scholarships
        case financialAid, applicant, profile, essays, essayDrafts
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

/// A parent link as the student sees it (GET/POST /api/parents).
struct ParentLinkInfo: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var email: String
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

    func parentDashboard(id: String) async throws -> ParentDashboardData {
        let safe = id.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-_"))) ?? ""
        return try await get("/api/parent/\(safe)", as: DataEnvelope<ParentDashboardData>.self).data
    }

    func parents() async throws -> [ParentLinkInfo] {
        try await get("/api/parents", as: DataEnvelope<[ParentLinkInfo]>.self).data
    }

    func parentsAction(_ fields: [String: JSONValue]) async throws -> ParentsReply {
        try await post("/api/parents", body: fields)
    }
}
