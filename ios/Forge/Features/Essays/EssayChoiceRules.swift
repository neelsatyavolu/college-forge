import Foundation

/// A choose-N set where the student picks more than one prompt (UC: 4 of 8), in prompt order.
struct EssayPickSet: Hashable, Sendable, Identifiable {
    let group: String
    let choose: Int
    let essays: [Essay]

    var id: String { group }
}

/// A school whose prompts belong to different colleges or programs (Cornell's colleges, Tufts' schools).
struct EssayAudienceSet: Hashable, Sendable {
    /// The audiences in prompt order.
    let audiences: [String]
    /// Some prompts are for everyone.
    let shared: Bool
    /// One program beside prompts for everyone (an honors college): the student opts in or out.
    let single: Bool
}

/// The prompt text split the way lib/supplement-prompts.ts joins it: intro, "Option N:" lines, then notes.
struct EssayPromptParts: Equatable, Sendable {
    let intro: [String]
    let options: [String]
    let notes: [String]
}

/// Choose-N sets, per-college prompts and choose-one options. Mirrors public/hub/essay-archetypes.js
/// (`pickSets`, `pickPatch`, `audienceSet`, `audiencePatch`, `chosenAudience`, `withChosenOption`) and
/// `promptParts` in public/hub/EssayChoice.jsx.
enum EssayChoiceRules {
    /// The set an essay belongs to. Common App and UC prompts saved before sets carried chooseGroup go by id.
    static func choice(of essay: Essay, rule: EssayPromptRule? = nil) -> (group: String, choose: Int)? {
        let group = essay.chooseGroup ?? rule?.chooseGroup
        let choose = essay.choose ?? rule?.choose
        if let group, !group.isEmpty, let choose, choose > 0 { return (group, choose) }
        if essay.id.hasPrefix("ca-ps-") { return ("common", 1) }
        if essay.id.hasPrefix("uc-piq-") { return ("uc", 4) }
        return nil
    }

    static func pickSets(_ essays: [Essay]) -> [EssayPickSet] {
        var order: [String] = []
        var byGroup: [String: (choose: Int, essays: [Essay])] = [:]
        for essay in essays {
            guard let choice = choice(of: essay), choice.choose >= 2 else { continue }
            if byGroup[choice.group] == nil { order.append(choice.group) }
            byGroup[choice.group, default: (choice.choose, [])].essays.append(essay)
        }
        return order.compactMap { key in
            byGroup[key].map { EssayPickSet(group: key, choose: $0.choose, essays: $0.essays) }
        }
    }

    /// `essayHidden` patch for a set: the picked prompts shown, every other one hidden.
    static func pickPatch(_ set: EssayPickSet, picked: Set<String>) -> [String: Bool?] {
        Dictionary(set.essays.map { ($0.id, picked.contains($0.id) ? Bool?.none : true) }, uniquingKeysWith: { first, _ in first })
    }

    static func audienceSet(_ essays: [Essay]) -> EssayAudienceSet? {
        var audiences: [String] = []
        var shared = false
        for essay in essays {
            guard let audience = essay.audience else { shared = true; continue }
            if !audiences.contains(audience) { audiences.append(audience) }
        }
        if audiences.count >= 2 { return EssayAudienceSet(audiences: audiences, shared: shared, single: false) }
        return audiences.count == 1 && shared ? EssayAudienceSet(audiences: audiences, shared: true, single: true) : nil
    }

    /// `essayHidden` patch for choosing `audience` ("" for none of them): its prompts shown, other programs' hidden.
    static func audiencePatch(_ essays: [Essay], audience: String) -> [String: Bool?] {
        var patch: [String: Bool?] = [:]
        for essay in essays {
            guard let own = essay.audience else { continue }
            patch[essay.id] = own == audience ? Bool?.none : true
        }
        return patch
    }

    /// The audience the student chose, "" for none of them, or nil while nothing is chosen.
    static func chosenAudience(_ essays: [Essay], hidden: [String: Bool]) -> String? {
        var shown: [String] = []
        var anyHidden = false
        for essay in essays {
            guard let audience = essay.audience else { continue }
            if hidden[essay.id] == true {
                anyHidden = true
            } else if !shown.contains(audience) {
                shown.append(audience)
            }
        }
        guard anyHidden else { return nil }
        return shown.count == 1 ? shown[0] : shown.isEmpty ? "" : nil
    }

    /// The essay as the student answers it: a picked option that states its own total limit ("(150 word limit)",
    /// "250 characters maximum") sets the limit. A per-line or per-title limit isn't a total, so the prompt's stays.
    static func withChosenOption(_ essay: Essay, choice: Int?) -> Essay {
        guard let choice, let options = essay.options, options.indices.contains(choice) else { return essay }
        let text = options[choice]
        let range = NSRange(text.startIndex..., in: text)
        guard let match = optionLimit.firstMatch(in: text, range: range),
              let numberRange = Range(match.range(at: 1), in: text),
              let unitRange = Range(match.range(at: 2), in: text),
              let fullRange = Range(match.range, in: text) else { return essay }
        let tail = Range(match.range(at: 3), in: text).map { String(text[$0]) } ?? ""
        if tail.range(of: #"\bper\b"#, options: [.regularExpression, .caseInsensitive]) != nil { return essay }
        let rest = text[fullRange.lowerBound...]
        if rest.range(of: #"\bper\s+(line|title|item|book|answer|entry)\b"#, options: [.regularExpression, .caseInsensitive]) != nil {
            return essay
        }
        guard let limit = Int(text[numberRange]), limit > 0 else { return essay }
        let unit = text[unitRange].lowercased().hasPrefix("char") ? "characters" : "words"
        if limit == essay.limit && unit == essay.unit { return essay }
        var out = essay
        out.limit = limit
        out.unit = unit
        return out
    }

    // Same pattern as withChosenOption in public/hub/essay-archetypes.js; a literal, so it always compiles.
    private nonisolated(unsafe) static let optionLimit = try! NSRegularExpression(
        pattern: #"(\d{2,5})[-\s]*(word|character)s?\b(?:\s*(?:limit|max(?:imum)?))?(?!\s*per\b)([^)]*)"#,
        options: [.caseInsensitive]
    )

    static func promptParts(_ essay: Essay) -> EssayPromptParts {
        let parts = essay.prompt.components(separatedBy: "\n\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        func isOption(_ part: String) -> Bool { part.range(of: #"^Option \d+:"#, options: .regularExpression) != nil }
        func isNote(_ part: String) -> Bool { part.range(of: #"^\(.*\)$"#, options: .regularExpression) != nil }
        let firstOption = parts.firstIndex(where: isOption)
        var intro: [String] = []
        var notes: [String] = []
        for (index, part) in parts.enumerated() where !isOption(part) {
            let afterOptions = firstOption.map { index > $0 } ?? false
            if isNote(part) || afterOptions {
                notes.append(part)
            } else {
                intro.append(part)
            }
        }
        let options = essay.options ?? parts.filter(isOption).map {
            $0.replacingOccurrences(of: #"^Option \d+:\s*"#, with: "", options: .regularExpression)
        }
        return EssayPromptParts(intro: intro, options: options, notes: notes)
    }
}
