import Foundation

/// A school on the student's shortlist (`Workspace.colleges`). Every field the web keeps is modeled here so
/// that sending a whole `colleges` array back never drops data. Prefer `WorkspacePatch.collegePatch` anyway.
struct College: Codable, Hashable, Sendable, Identifiable {
    var slug: String
    var name: String
    var short: String
    var location: String?
    var setting: String?
    var rank: Int?
    var admit: String?
    var satRange: String?
    var gpa: String?
    var photo: String?
    var tier: CollegeTier?
    var verdict: Verdict?
    var priority: Bool?
    var major: String?
    var deadline: String?
    var supp: String?
    var tags: [Tag]?
    var size: String?
    var act: String?
    var netPrice: String?
    var grad6: String?
    var earnings: String?
    var plans: [PlanRate]?
    var deadlines: [PlanDeadline]?
    var fee: String?
    var transfer: String?
    var scorecardId: Int?
    var coa: String?
    var tuitionIn: String?
    var tuitionOut: String?
    var grad4: String?
    var retention: String?
    var ownership: String?
    var testPolicy: String?
    var pellRate: String?
    var url: String?
    var priceCalcUrl: String?

    var id: String { slug }

    init(slug: String, name: String, short: String = "") {
        self.slug = slug
        self.name = name
        self.short = short.isEmpty ? name : short
    }
}

extension College {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        slug = c.string(.slug)
        name = c.string(.name)
        short = c.string(.short, name)
        location = c.optionalString(.location)
        setting = c.optionalString(.setting)
        rank = c.optionalInt(.rank)
        admit = c.optionalString(.admit)
        satRange = c.optionalString(.satRange)
        gpa = c.optionalString(.gpa)
        photo = c.optionalString(.photo)
        tier = c.optional(CollegeTier.self, .tier)
        verdict = c.optional(Verdict.self, .verdict)
        priority = c.optionalBool(.priority)
        major = c.optionalString(.major)
        deadline = c.optionalString(.deadline)
        supp = c.optionalString(.supp)
        tags = c.optional([Lossy<Tag>].self, .tags)?.compactMap(\.value)
        size = c.optionalString(.size)
        act = c.optionalString(.act)
        netPrice = c.optionalString(.netPrice)
        grad6 = c.optionalString(.grad6)
        earnings = c.optionalString(.earnings)
        plans = c.optional([Lossy<PlanRate>].self, .plans)?.compactMap(\.value)
        deadlines = c.optional([Lossy<PlanDeadline>].self, .deadlines)?.compactMap(\.value)
        fee = c.optionalString(.fee)
        transfer = c.optionalString(.transfer)
        scorecardId = c.optionalInt(.scorecardId)
        coa = c.optionalString(.coa)
        tuitionIn = c.optionalString(.tuitionIn)
        tuitionOut = c.optionalString(.tuitionOut)
        grad4 = c.optionalString(.grad4)
        retention = c.optionalString(.retention)
        ownership = c.optionalString(.ownership)
        testPolicy = c.optionalString(.testPolicy)
        pellRate = c.optionalString(.pellRate)
        url = c.optionalString(.url)
        priceCalcUrl = c.optionalString(.priceCalcUrl)
    }
}

/// reach / target / safety; unknown values are kept.
struct CollegeTier: OpenEnum {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }

    static let reach = CollegeTier(rawValue: "reach")
    static let target = CollegeTier(rawValue: "target")
    static let safety = CollegeTier(rawValue: "safety")

    var label: String { rawValue.isEmpty ? "" : rawValue.prefix(1).uppercased() + rawValue.dropFirst() }
}

/// A short judgement with a tone name from the web CSS ("good", "warn", ...).
struct Verdict: Codable, Hashable, Sendable {
    var tone = ""
    var label = ""
}

extension Verdict {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tone = c.string(.tone)
        label = c.string(.label)
    }
}

struct Tag: Codable, Hashable, Sendable {
    var label = ""
    var tone = ""
}

extension Tag {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        label = c.string(.label)
        tone = c.string(.tone)
    }
}

/// Admit rate for one round ("ED", "18%").
struct PlanRate: Codable, Hashable, Sendable {
    var plan = ""
    var rate = ""
}

extension PlanRate {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        plan = c.string(.plan)
        rate = c.string(.rate)
    }
}

/// Deadline for one round ("EA", "Nov 1").
struct PlanDeadline: Codable, Hashable, Sendable {
    var plan = ""
    var date = ""
}

extension PlanDeadline {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        plan = c.string(.plan)
        date = c.string(.date)
    }
}
