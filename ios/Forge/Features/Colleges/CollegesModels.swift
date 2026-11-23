import Foundation

// Response shapes for the college routes (app/api/colleges/*, app/api/ai/odds-plan). Rows from search and
// browse are `College` records, so adding one to the shortlist keeps every field the web keeps.

/// GET /api/colleges/search: `{success, data: [College], edition?}`.
struct CollegesSearchResponse: Decodable, Sendable {
    var colleges: [College]
    /// U.S. News edition year ("2027"), only on browse.
    var edition: String

    private enum CodingKeys: String, CodingKey { case data, edition }

    init(colleges: [College], edition: String = "") {
        self.colleges = colleges
        self.edition = edition
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        colleges = c.array(.data)
        edition = c.string(.edition)
    }
}

/// One bachelor's program from GET /api/colleges/detail (lib/colleges.ts `ProgramRow`).
struct CollegesProgram: Decodable, Hashable, Sendable, Identifiable {
    var code: String
    var title: String
    var area: String
    var awards: Int?
    /// This school's median earnings four years after completing the program.
    var earnings4: Double?
    /// The national median for the same field.
    var national4: Double?

    var id: String { code }

    init(code: String, title: String, area: String, awards: Int? = nil, earnings4: Double? = nil, national4: Double? = nil) {
        self.code = code
        self.title = title
        self.area = area
        self.awards = awards
        self.earnings4 = earnings4
        self.national4 = national4
    }

    private enum CodingKeys: String, CodingKey { case code, title, area, awards, earnings4, national4 }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = c.string(.code)
        title = c.string(.title)
        area = c.string(.area, "Other")
        awards = c.optionalInt(.awards)
        earnings4 = c.optionalDouble(.earnings4)
        national4 = c.optionalDouble(.national4)
    }
}

/// GET /api/colleges/detail `data`: the full college record plus its programs.
struct CollegesDetail: Decodable, Sendable {
    var college: College
    var programs: [CollegesProgram]

    private enum CodingKeys: String, CodingKey { case programs }

    init(college: College, programs: [CollegesProgram] = []) {
        self.college = college
        self.programs = programs
    }

    init(from decoder: any Decoder) throws {
        college = try College(from: decoder)
        programs = try decoder.container(keyedBy: CodingKeys.self).array(.programs)
    }
}

// MARK: Recommendations (lib/college-recommendations.ts)

struct CollegesRecommendationSet: Decodable, Sendable {
    var generatedAt: String
    var methodology: String
    var sources: [CollegesSource]
    var limitations: [String]
    var profileGaps: [String]
    var recommendations: [CollegesRecommendation]

    private enum CodingKeys: String, CodingKey { case generatedAt, methodology, sources, limitations, profileGaps, recommendations }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        generatedAt = c.string(.generatedAt)
        methodology = c.string(.methodology)
        sources = c.array(.sources)
        limitations = c.array(.limitations)
        profileGaps = c.array(.profileGaps)
        recommendations = c.array(.recommendations)
    }
}

struct CollegesSource: Decodable, Hashable, Sendable {
    var label: String
    /// Absolute, or site-relative ("/data/rankings/sources.md").
    var url: String

    private enum CodingKeys: String, CodingKey { case label, url }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        label = c.string(.label)
        url = c.string(.url)
    }
}

struct CollegesRecommendation: Decodable, Hashable, Sendable, Identifiable {
    var college: College
    var fit: CollegesFit
    var evidence: CollegesEvidence

    var id: String { college.slug }

    private enum CodingKeys: String, CodingKey { case college, fit, evidence }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        college = try c.decode(College.self, forKey: .college)
        fit = c.value(.fit, CollegesFit())
        evidence = c.value(.evidence, CollegesEvidence())
    }
}

/// A provisional planning category, never an admission probability.
struct CollegesFit: Decodable, Hashable, Sendable {
    var tier: CollegeTier?
    var label = "Research"
    var reasons: [String] = []
    var cautions: [String] = []

    init() {}

    private enum CodingKeys: String, CodingKey { case tier, label, reasons, cautions }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tier = c.optionalString(.tier).map(CollegeTier.init(rawValue:))
        label = c.string(.label, "Research")
        reasons = c.array(.reasons)
        cautions = c.array(.cautions)
    }
}

struct CollegesEvidence: Decodable, Hashable, Sendable {
    var fairRank: Int?
    var rankLow: Int?
    var rankHigh: Int?
    /// Earnings adjusted for where graduates live, in 2024 dollars.
    var adjustedEarnings: Double?
    var netPrice: Double?
    var scorecardUrl = ""

    init() {}

    private enum CodingKeys: String, CodingKey { case fairRank, rankLow, rankHigh, adjustedEarnings, netPrice, scorecardUrl }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        fairRank = c.optionalInt(.fairRank)
        rankLow = c.optionalInt(.rankLow)
        rankHigh = c.optionalInt(.rankHigh)
        adjustedEarnings = c.optionalDouble(.adjustedEarnings)
        netPrice = c.optionalDouble(.netPrice)
        scorecardUrl = c.string(.scorecardUrl)
    }
}

// MARK: Chance estimates (lib/odds-plan.ts)

/// GET /api/ai/odds-plan: one prompt to read the application, then one per batch of schools.
struct CollegesOddsPlan: Decodable, Sendable {
    struct Step: Decodable, Sendable {
        var label: String
        var prompt: String
        /// `admissionOdds` keys this step should save: a shortlist slug or "app:<tracked id>".
        var keys: [String]

        private enum CodingKeys: String, CodingKey { case label, prompt, keys }

        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            label = c.string(.label)
            prompt = c.string(.prompt)
            keys = c.array(.keys)
        }
    }

    var read: Step?
    var schools: [Step]

    private enum CodingKeys: String, CodingKey { case read, schools }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        read = c.optional(Step.self, .read)
        schools = c.array(.schools)
    }
}

/// One line of the NDJSON stream from POST /api/ai/chat.
struct CollegesChatEvent: Decodable, Sendable {
    var type: String
    var message: String

    private enum CodingKeys: String, CodingKey { case type, message }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = c.string(.type)
        message = c.string(.message)
    }
}
