import Foundation

/// One essay with the group it was listed under.
struct EssayItem: Hashable, Sendable, Identifiable {
    var essay: Essay
    var groupKey: String
    var groupTitle: String

    var id: String { essay.id }
    /// The badge text: the essay's own group, else the section it sits in.
    var badge: String { essay.group.flatMap { $0.isEmpty ? nil : $0 } ?? groupTitle }
}

/// A section of the essays list, built the way the web hub builds its sidebar.
struct EssayGroup: Hashable, Sendable, Identifiable {
    enum Kind: Hashable, Sendable { case common, uc, school, orphan }

    var key: String
    var title: String
    var subtitle: String?
    var kind: Kind
    var essays: [Essay]

    var id: String { key }
    /// True for a school on the list that has no prompts yet.
    var isPlaceholder: Bool { essays.isEmpty && (kind == .school || kind == .uc) }
}

/// Groups `Workspace.essays` for display. Mirrors `buildGroups` in public/hub/Essays.jsx:
/// Common App, then one shared UC Application group, one group per other listed school, then
/// supplements for schools no longer on the list (so their drafts stay reachable).
enum EssayCatalog {
    static let commonKey = "common"
    static let ucKey = "uc-application"

    static func groups(colleges: [College], essays: EssaySet) -> [EssayGroup] {
        var groups = [EssayGroup(key: commonKey, title: "Common App", subtitle: "Personal statement: pick one",
                                 kind: .common, essays: essays.commonApp)]
        let supplements = essays.supplements
        let ucs = colleges.filter(isUCCampus)
        let others = colleges.filter { !isUCCampus($0) }
        let listed = Set(colleges.map(\.slug).filter { !$0.isEmpty })

        if !ucs.isEmpty {
            groups.append(EssayGroup(key: ucKey, title: "UC Application",
                                     subtitle: ucs.map(displayName).joined(separator: " · "),
                                     kind: .uc, essays: supplements[ucKey] ?? []))
        }
        for college in others where !college.slug.isEmpty {
            let subtitle = (!college.name.isEmpty && !college.short.isEmpty && college.name != college.short) ? college.name : nil
            groups.append(EssayGroup(key: college.slug, title: displayName(college), subtitle: subtitle,
                                     kind: .school, essays: supplements[college.slug] ?? []))
        }
        for slug in supplements.keys.sorted() {
            let items = supplements[slug] ?? []
            guard !items.isEmpty else { continue }
            if slug == ucKey {
                if ucs.isEmpty {
                    groups.append(EssayGroup(key: slug, title: "UC Application", subtitle: "Not on your list", kind: .orphan, essays: items))
                }
                continue
            }
            if listed.contains(slug) { continue }
            if !ucs.isEmpty && isUCCampus(College(slug: slug, name: slug)) { continue }
            groups.append(EssayGroup(key: slug, title: slug.replacingOccurrences(of: "-", with: " "),
                                     subtitle: "Removed from list", kind: .orphan, essays: items))
        }
        return groups
    }

    static func items(in groups: [EssayGroup]) -> [EssayItem] {
        groups.flatMap { group in
            group.essays.map { EssayItem(essay: $0, groupKey: group.key, groupTitle: group.title) }
        }
    }

    /// Groups open by default: Common App, any group with writing in it, and the first school.
    static func initiallyExpanded(_ groups: [EssayGroup], drafts: [String: String]) -> Set<String> {
        var open: Set<String> = [commonKey]
        for (index, group) in groups.enumerated() where group.key != commonKey {
            let hasDraft = group.essays.contains { EssayMetrics.wordCount(drafts[$0.id] ?? $0.starter ?? "") > 0 }
            if hasDraft || index == 1 { open.insert(group.key) }
        }
        return open
    }

    static func isUCCampus(_ college: College) -> Bool {
        let slug = college.slug.lowercased()
        let name = "\(college.name) \(college.short)".lowercased()
        if slug.hasPrefix("university-of-california-") { return true }
        if ["ucla", "ucb", "ucsd", "uc-berkeley"].contains(slug) { return true }
        if name.contains("university of california") { return true }
        let campuses = ["berkeley", "los angeles", "san diego", "davis", "irvine", "santa barbara", "santa cruz", "riverside", "merced"]
        if campuses.contains(where: { name.range(of: "\\buc\\s+\($0)\\b", options: .regularExpression) != nil }) { return true }
        return name.trimmingCharacters(in: .whitespaces) == "ucla"
    }

    private static func displayName(_ college: College) -> String {
        college.short.isEmpty ? (college.name.isEmpty ? college.slug : college.name) : college.short
    }
}

/// Length rules, matching the web editor exactly.
enum EssayMetrics {
    /// The Common App personal statement minimum.
    static let personalStatementMinimum = 250

    /// Whitespace-separated words, like `s.trim().split(/\s+/)`.
    static func wordCount(_ text: String) -> Int {
        text.split(whereSeparator: { $0.isWhitespace }).count
    }

    /// Words, or Unicode code points for character limits (`Array.from(text).length`).
    static func count(_ text: String, for essay: Essay) -> Int {
        essay.unit.range(of: "character", options: .caseInsensitive) != nil ? text.unicodeScalars.count : wordCount(text)
    }

    static func isPersonalStatement(_ essay: Essay) -> Bool { essay.id.hasPrefix("ca-ps-") }

    static func isOver(_ count: Int, _ essay: Essay) -> Bool { count > essay.limit }

    static func isUnderMinimum(_ count: Int, _ essay: Essay) -> Bool {
        isPersonalStatement(essay) && count > 0 && count < personalStatementMinimum
    }

    /// 0...1 share of the limit used.
    static func progress(_ count: Int, _ essay: Essay) -> Double {
        guard essay.limit > 0 else { return 0 }
        return min(1, Double(count) / Double(essay.limit))
    }

    static func unitLabel(_ essay: Essay) -> String {
        essay.unit.isEmpty ? "words" : essay.unit
    }
}
