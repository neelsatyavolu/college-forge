import Foundation

/// `Workspace.essays`: the Common App personal statement prompts plus supplements grouped by college slug.
struct EssaySet: Codable, Hashable, Sendable {
    var commonApp: [Essay] = []
    /// Supplement essays keyed by college slug (or a group key such as "uc").
    var supplements: [String: [Essay]] = [:]

    /// Every essay, Common App first, supplements in key order.
    var all: [Essay] {
        commonApp + supplements.keys.sorted().flatMap { supplements[$0] ?? [] }
    }
}

extension EssaySet {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        commonApp = c.array(.commonApp)
        let raw = (try? c.decodeIfPresent([String: [Lossy<Essay>]].self, forKey: .supplements)) ?? nil
        supplements = (raw ?? [:]).mapValues { $0.compactMap(\.value) }
    }
}

struct Essay: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var group: String?
    var label: String
    var prompt: String
    /// Length limit in `unit`s.
    var limit: Int
    /// "words" or "characters".
    var unit: String
    var starter: String?
    /// false: optional, or only for some applicants (see `audience`). Missing counts as required unless the label says optional.
    var required: Bool?
    /// Prompts sharing a chooseGroup form a set where the student answers `choose` of them (UC PIQs: 4 of 8).
    var chooseGroup: String?
    var choose: Int?
    /// A choose-one prompt's options; `Workspace.essayOption` says which one the student answers.
    var options: [String]?
    /// The school, program or degree inside the university the prompt is for.
    var audience: String?

    init(id: String, label: String, prompt: String, limit: Int = 650, unit: String = "words") {
        self.id = id
        self.label = label
        self.prompt = prompt
        self.limit = limit
        self.unit = unit
    }

    var countsCharacters: Bool { unit.lowercased().hasPrefix("char") }

    /// Length of `text` in this essay's unit.
    func length(of text: String) -> Int {
        countsCharacters ? text.count : text.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).count
    }
}

extension Essay {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.string(.id)
        group = c.optionalString(.group)
        label = c.string(.label)
        prompt = c.string(.prompt)
        limit = c.int(.limit, 650)
        unit = c.string(.unit, "words")
        starter = c.optionalString(.starter)
        required = c.optionalBool(.required)
        chooseGroup = c.optionalString(.chooseGroup)
        choose = c.optionalInt(.choose)
        let options: [String] = c.array(.options)
        self.options = options.isEmpty ? nil : options
        audience = c.optionalString(.audience).flatMap { $0.isEmpty ? nil : $0 }
    }
}
