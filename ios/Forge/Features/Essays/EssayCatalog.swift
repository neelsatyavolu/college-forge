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
    var due: EssayDeadline?
    /// Essays the student hid in this group (`Workspace.essayHidden`), listed apart under "Hidden".
    var hiddenEssays: [Essay] = []

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

    /// `hidden` and `commonAppPrompt` filter like the web's `visibleItems` (public/hub/essay-archetypes.js):
    /// hidden essays move to `hiddenEssays`, and a chosen Common App prompt drops the other prompts of its set.
    /// `essaySchools` drops the groups of schools the student isn't writing for (`Workspace.essaySchools`).
    static func groups(colleges: [College], essays: EssaySet, today: String = ForgeDates.today(),
                       hidden: [String: Bool] = [:], commonAppPrompt: String? = nil,
                       essaySchools: [String: Bool] = [:]) -> [EssayGroup] {
        let all = allGroups(colleges: colleges, essays: essays, today: today)
            .filter { $0.kind == .orphan || !isSkipped($0.key, essaySchools: essaySchools) }
        return visible(all, hidden: hidden, commonAppPrompt: commonAppPrompt)
    }

    /// The Essays group a list school writes in (essayGroupKey in lib/essay-supplements.ts).
    static func groupKey(for college: College) -> String? {
        if isUCCampus(college) { return ucKey }
        return college.slug.isEmpty ? nil : college.slug
    }

    /// True when the student opted this group's school out of supplements. The Common App is always written.
    static func isSkipped(_ key: String, essaySchools: [String: Bool]) -> Bool {
        key != commonKey && essaySchools[key] == false
    }

    /// One row per Essays group a school writes in, in list order: each non-UC school and one UC Application
    /// row for every UC campus. Mirrors `essaySchools` in public/hub/essay-archetypes.js.
    static func schools(colleges: [College], essaySchools: [String: Bool]) -> [EssaySchool] {
        var rows: [EssaySchool] = []
        var campuses: [String] = []
        var seen: Set<String> = []
        for college in colleges {
            guard let key = groupKey(for: college) else { continue }
            // Two list rows on one slug share one Essays group, so they share one row here.
            if key != ucKey && !seen.insert(key).inserted { continue }
            if key == ucKey {
                if campuses.isEmpty { rows.append(EssaySchool(key: ucKey, title: "UC Application", subtitle: "", writing: true)) }
                campuses.append(displayName(college))
            } else {
                rows.append(EssaySchool(key: key, title: displayName(college), subtitle: "", writing: true))
            }
        }
        return rows.map { row in
            var out = row
            out.writing = !isSkipped(row.key, essaySchools: essaySchools)
            if row.key == ucKey { out.subtitle = campuses.joined(separator: " · ") }
            return out
        }
    }

    /// True when the student hid this essay, or it is a Common App prompt other than the chosen one.
    static func isHidden(_ essay: Essay, hidden: [String: Bool], commonAppPrompt: String?) -> Bool {
        if hidden[essay.id] == true { return true }
        guard let chosen = commonAppPrompt, !chosen.isEmpty else { return false }
        // The Common App choose-one set is the ca-ps-* prompts (lib/common-app-prompts.ts).
        return essay.id.hasPrefix("ca-ps-") && essay.id != chosen
    }

    private static func visible(_ groups: [EssayGroup], hidden: [String: Bool], commonAppPrompt: String?) -> [EssayGroup] {
        guard !hidden.isEmpty || commonAppPrompt != nil else { return groups }
        return groups.map { group in
            var out = group
            out.essays = group.essays.filter { !isHidden($0, hidden: hidden, commonAppPrompt: commonAppPrompt) }
            out.hiddenEssays = group.essays.filter { hidden[$0.id] == true }
            return out
        }
    }

    private static func allGroups(colleges: [College], essays: EssaySet, today: String) -> [EssayGroup] {
        var groups = [EssayGroup(key: commonKey, title: "Common App", subtitle: "Personal statement — pick one",
                                 kind: .common, essays: essays.commonApp)]
        let supplements = essays.supplements
        let ucs = colleges.filter(isUCCampus)
        let others = colleges.filter { !isUCCampus($0) }
        groups[0].due = EssayDeadline.next(for: others, today: today)
        let listed = Set(colleges.map(\.slug).filter { !$0.isEmpty })

        if !ucs.isEmpty {
            groups.append(EssayGroup(key: ucKey, title: "UC Application",
                                     subtitle: ucs.map(displayName).joined(separator: " · "),
                                     kind: .uc, essays: supplements[ucKey] ?? [],
                                     due: EssayDeadline.next(for: ucs, today: today)))
        }
        for college in others where !college.slug.isEmpty {
            let subtitle = (!college.name.isEmpty && !college.short.isEmpty && college.name != college.short) ? college.name : nil
            groups.append(EssayGroup(key: college.slug, title: displayName(college), subtitle: subtitle,
                                     kind: .school, essays: supplements[college.slug] ?? [],
                                     due: EssayDeadline.next(for: [college], today: today)))
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
        // Stable sort preserves shortlist order for equal or unknown deadlines.
        return groups.sorted { lhs, rhs in
            if lhs.kind == .common || rhs.kind == .common { return lhs.kind == .common && rhs.kind != .common }
            if lhs.kind == .orphan || rhs.kind == .orphan { return rhs.kind == .orphan && lhs.kind != .orphan }
            return (lhs.due?.date ?? "~") < (rhs.due?.date ?? "~")
        }
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

/// A school the student can write supplements for, in the "Pick essay schools" sheet.
struct EssaySchool: Hashable, Sendable, Identifiable {
    var key: String
    var title: String
    var subtitle: String
    var writing: Bool

    var id: String { key }
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
