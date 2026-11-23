import Foundation

/// `Workspace.profile`.
struct Profile: Codable, Hashable, Sendable {
    var intended = ""
    var hs = ""
    /// A year ("2027") or empty. The server accepts either a number or a string.
    var gradYear = ""
    var location = ""
    var counselor = ""
    var residency = ""
    var testing = TestScores()
    var coursework = Coursework()
    var activities: [Activity] = []
    var honors: [Honor] = []
}

extension Profile {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        intended = c.string(.intended)
        hs = c.string(.hs)
        gradYear = c.string(.gradYear)
        location = c.string(.location)
        counselor = c.string(.counselor)
        residency = c.string(.residency)
        testing = c.value(.testing, TestScores())
        coursework = c.value(.coursework, Coursework())
        activities = c.array(.activities)
        honors = c.array(.honors)
    }
}

struct TestScores: Codable, Hashable, Sendable {
    var sat = "—"
    var satNote = ""
    var aps: [APScore] = []
}

extension TestScores {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sat = c.string(.sat, "—")
        satNote = c.string(.satNote)
        aps = c.array(.aps)
    }
}

struct APScore: Codable, Hashable, Sendable {
    var course = ""
    var score = ""
}

extension APScore {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        course = c.string(.course)
        score = c.string(.score)
    }
}

struct Coursework: Codable, Hashable, Sendable {
    var honors: [String] = []
    var aps: [String] = []
    var senior: [String] = []
}

extension Coursework {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        honors = c.array(.honors)
        aps = c.array(.aps)
        senior = c.array(.senior)
    }
}

/// One activity, in Common App order (`rank` 1 is first).
struct Activity: Codable, Hashable, Sendable {
    var rank = 0
    var name = ""
    var type = ""
    var org: String?
    var years: String?
    var role: String?
    /// Hours per week and weeks per year, as typed.
    var hpw: String?
    var wpy: String?
    /// Continuing in college.
    var college: Bool?
    var desc: String?
    var bullets: [String]?
}

extension Activity {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        rank = c.int(.rank)
        name = c.string(.name)
        type = c.string(.type)
        org = c.optionalString(.org)
        years = c.optionalString(.years)
        role = c.optionalString(.role)
        hpw = c.optionalString(.hpw)
        wpy = c.optionalString(.wpy)
        college = c.optionalBool(.college)
        desc = c.optionalString(.desc)
        bullets = c.optional([String].self, .bullets)
    }
}

struct Honor: Codable, Hashable, Sendable {
    var title = ""
    /// "School", "State", "National", "International", as written.
    var level = ""
    var year: String?
    var top: Bool?
}

extension Honor {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = c.string(.title)
        level = c.string(.level)
        year = c.optionalString(.year)
        top = c.optionalBool(.top)
    }
}
