import Foundation

// What GET /api/colleges/detail adds from Forge's own sourced data (lib/explore-catalog.ts `exploreExtras`):
// the photo credit, other publications' ranks, research notes, international aid, nursing entry,
// Niche grades and major-switching rules. Every field is optional; a school without notes has none.

/// Attribution for a Wikimedia Commons photo. The license requires the author, license and a link.
struct ExplorePhotoCredit: Decodable, Hashable, Sendable {
    var by = ""
    var license = ""
    var page = ""

    private enum CodingKeys: String, CodingKey { case by, license, page }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        by = c.string(.by)
        license = c.string(.license)
        page = c.string(.page)
    }
}

/// One sourced fact ("Need-based aid": "Meets full need…").
struct ExploreNote: Decodable, Hashable, Sendable {
    var label = ""
    var value = ""
    var sourceUrl: String?
    var checkedAt: String?
    var thirdParty = false

    private enum CodingKeys: String, CodingKey { case label, value, sourceUrl, checkedAt, thirdParty }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        label = c.string(.label)
        value = c.string(.value)
        sourceUrl = c.optionalString(.sourceUrl)
        checkedAt = c.optionalString(.checkedAt)
        thirdParty = c.bool(.thirdParty)
    }
}

struct ExploreIncomeBand: Decodable, Hashable, Sendable {
    var band = ""
    var value = ""
    var sourceUrl: String?

    private enum CodingKeys: String, CodingKey { case band, value, sourceUrl }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        band = c.string(.band)
        value = c.string(.value)
        sourceUrl = c.optionalString(.sourceUrl)
    }
}

struct ExploreDeadline: Decodable, Hashable, Sendable {
    var plan = ""
    var date = ""
    var note: String?

    private enum CodingKeys: String, CodingKey { case plan, date, note }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        plan = c.string(.plan)
        date = c.string(.date)
        note = c.optionalString(.note)
    }
}

struct ExploreEssay: Decodable, Hashable, Sendable {
    var label: String?
    var prompt = ""
    var limit: Int?
    var unit: String?
    var required: Bool?

    private enum CodingKeys: String, CodingKey { case label, prompt, limit, unit, required }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        label = c.optionalString(.label)
        prompt = c.string(.prompt)
        limit = c.optionalInt(.limit)
        unit = c.optionalString(.unit)
        required = c.optionalBool(.required)
    }
}

/// Forge's audited research on one school (lib/explore-notes.ts `exploreNotes`).
struct ExploreResearch: Decodable, Hashable, Sendable {
    var checkedAt = ""
    var notes: [ExploreNote] = []
    var byIncome: [ExploreIncomeBand] = []
    var deadlines: [ExploreDeadline] = []
    var essays: [ExploreEssay] = []

    private enum CodingKeys: String, CodingKey { case checkedAt, notes, byIncome, deadlines, essays }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        checkedAt = c.string(.checkedAt)
        notes = c.array(.notes, of: ExploreNote.self).filter { !$0.value.isEmpty }
        byIncome = c.array(.byIncome)
        deadlines = c.array(.deadlines)
        essays = c.array(.essays, of: ExploreEssay.self).filter { !$0.prompt.isEmpty }
    }
}

struct ExploreIntlAid: Decodable, Hashable, Sendable {
    var label = ""
    var source: String?

    private enum CodingKeys: String, CodingKey { case label, source }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        label = c.string(.label)
        source = c.optionalString(.source)
    }
}

struct ExploreNursing: Decodable, Hashable, Sendable {
    var entry = ""
    var note: String?
    var sourceUrl: String?

    private enum CodingKeys: String, CodingKey { case entry, note, sourceUrl }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        entry = c.string(.entry)
        note = c.optionalString(.note)
        sourceUrl = c.optionalString(.sourceUrl)
    }
}

struct ExploreNiche: Decodable, Hashable, Sendable {
    var overall: String?
    var campus: String?
    var dorms: String?
    var food: String?

    private enum CodingKeys: String, CodingKey { case overall, campus, dorms, food }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        overall = c.optionalString(.overall)
        campus = c.optionalString(.campus)
        dorms = c.optionalString(.dorms)
        food = c.optionalString(.food)
    }
}

/// How hard it is to switch into one major (lib/career-ranking.ts `SWITCH_LABELS`).
struct ExploreSwitch: Decodable, Hashable, Sendable {
    var major = ""
    var level: Double = 0
    var label = ""

    private enum CodingKeys: String, CodingKey { case major, level, label }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        major = c.string(.major)
        level = c.double(.level)
        label = c.string(.label)
    }
}

struct ExploreEarningsRange: Decodable, Hashable, Sendable {
    var p25: Int
    var p75: Int

    private enum CodingKeys: String, CodingKey { case p25, p75 }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        p25 = c.int(.p25)
        p75 = c.int(.p75)
    }
}

/// Everything the detail record adds on top of `College`.
struct ExploreDetailExtras: Decodable, Hashable, Sendable {
    var credit: ExplorePhotoCredit?
    var lacRank: Int?
    /// Publication key ("usn", "forbes", …) to rank.
    var rankings: [String: Int] = [:]
    var research: ExploreResearch?
    var intlAid: ExploreIntlAid?
    var nursing: ExploreNursing?
    var niche: ExploreNiche?
    var switching: [ExploreSwitch] = []
    var earningsRange: ExploreEarningsRange?
    var hbcu = false
    var women = false
    var facets = ExploreFacets()

    init() {}

    private enum CodingKeys: String, CodingKey {
        case credit, lacRank, rankings, research, intlAid, nursing, niche, switching, earningsRange, hbcu, women, f
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        credit = c.optional(ExplorePhotoCredit.self, .credit)
        lacRank = c.optionalInt(.lacRank)
        rankings = c.dictionary(.rankings)
        research = c.optional(ExploreResearch.self, .research)
        intlAid = c.optional(ExploreIntlAid.self, .intlAid)
        nursing = c.optional(ExploreNursing.self, .nursing)
        niche = c.optional(ExploreNiche.self, .niche)
        switching = c.array(.switching)
        earningsRange = c.optional(ExploreEarningsRange.self, .earningsRange)
        hbcu = c.bool(.hbcu)
        women = c.bool(.women)
        facets = c.value(.f, ExploreFacets())
    }
}
