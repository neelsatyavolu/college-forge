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
    }
}
