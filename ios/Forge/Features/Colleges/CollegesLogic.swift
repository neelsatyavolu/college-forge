import Foundation

// Pure rules behind the Colleges tab, kept out of the views so they can be tested.

extension CollegeTier {
    /// The web calls the safety tier "Likely".
    var displayLabel: String { self == .safety ? "Likely" : label }

    /// Section titles: "Reaches", "Targets", "Likely".
    var pluralLabel: String {
        switch self {
        case .reach: "Reaches"
        case .target: "Targets"
        case .safety: "Likely"
        default: label
        }
    }

    static let planning: [CollegeTier] = [.reach, .target, .safety]
    var isPlanning: Bool { Self.planning.contains(self) }
}

enum CollegesTierFilter: String, CaseIterable, Identifiable, Sendable {
    case all, reach, target, safety
    var id: String { rawValue }

    var label: String {
        switch self {
        case .all: "All"
        case .reach: "Reaches"
        case .target: "Targets"
        case .safety: "Likely"
        }
    }

    var tier: CollegeTier? {
        switch self {
        case .all: nil
        case .reach: .reach
        case .target: .target
        case .safety: .safety
        }
    }
}

/// A group of shortlist schools: one tier, or "Not assessed yet".
struct CollegesTierSection: Identifiable, Equatable, Sendable {
    var tier: CollegeTier?
    var colleges: [College]

    var id: String { tier?.rawValue ?? "unassessed" }
    var title: String { tier?.pluralLabel ?? "Not assessed yet" }
}

enum CollegesShortlist {
    /// Same school: matching slug, or matching College Scorecard id.
    static func same(_ a: College, _ b: College) -> Bool {
        if !a.slug.isEmpty, a.slug == b.slug { return true }
        if let x = a.scorecardId, let y = b.scorecardId, x == y { return true }
        return false
    }

    static func contains(_ college: College, in list: [College]) -> Bool {
        list.contains { same($0, college) }
    }

    /// Adds a school at the end, or merges it into the saved copy.
    static func adding(_ college: College, to list: [College]) -> [College] {
        guard let index = list.firstIndex(where: { same($0, college) }) else { return list + [college] }
        var merged = list
        merged[index] = merge(list[index], with: college)
        return merged
    }

    /// Like the server's upsert: fields the incoming row has replace the saved ones; the rest are kept.
    static func merge(_ saved: College, with incoming: College) -> College {
        guard let savedData = try? JSONEncoder().encode(saved),
              let incomingData = try? JSONEncoder().encode(incoming),
              var base = try? JSONSerialization.jsonObject(with: savedData) as? [String: Any],
              let fresh = try? JSONSerialization.jsonObject(with: incomingData) as? [String: Any] else { return saved }
        base.merge(fresh) { _, new in new }
        guard let data = try? JSONSerialization.data(withJSONObject: base),
              let college = try? JSONDecoder().decode(College.self, from: data) else { return saved }
        return college
    }

    static func removing(slug: String, from list: [College]) -> [College] {
        list.filter { $0.slug != slug }
    }

    /// UC campuses share one UC Application.
    static func isUCCampus(_ college: College) -> Bool {
        let slug = college.slug.lowercased()
        let name = (college.name.isEmpty ? college.short : college.name).lowercased()
        return slug.hasPrefix("university-of-california-") || slug == "ucla" || name.contains("university of california")
    }

    /// Application count with every UC campus counted once.
    static func applicationSlots(_ list: [College]) -> Int {
        let others = list.filter { !isUCCampus($0) }.count
        return others + (list.contains(where: isUCCampus) ? 1 : 0)
    }

    static func withSupplements(_ list: [College]) -> Int {
        list.filter { ($0.supp ?? "").isEmpty == false && $0.supp != "No supps" }.count
    }

    /// Reach, target and likely sections in that order, then unassessed schools (only under "All").
    /// Empty sections are left out.
    static func sections(_ list: [College], filter: CollegesTierFilter) -> [CollegesTierSection] {
        var result: [CollegesTierSection] = []
        for tier in CollegeTier.planning where filter == .all || filter.tier == tier {
            let schools = list.filter { $0.tier == tier }
            if !schools.isEmpty { result.append(CollegesTierSection(tier: tier, colleges: schools)) }
        }
        if filter == .all {
            let rest = list.filter { !($0.tier?.isPlanning ?? false) }
            if !rest.isEmpty { result.append(CollegesTierSection(tier: nil, colleges: rest)) }
        }
        return result
    }

    /// Moves schools within one section and returns the whole list in its new order. Schools outside the
    /// section keep their positions.
    static func moving(_ list: [College], section: [College], from source: IndexSet, to destination: Int) -> [College] {
        var reordered = section
        reordered.move(fromOffsets: source, toOffset: destination)
        let slugs = Set(section.map(\.slug))
        var queue = reordered.makeIterator()
        return list.map { slugs.contains($0.slug) ? (queue.next() ?? $0) : $0 }
    }

    /// The tracked application for a shortlist school: by slug, then by name.
    static func trackedApplication(for college: College, in apps: [TrackedApplication]) -> TrackedApplication? {
        if let match = apps.first(where: { $0.slug == college.slug && !college.slug.isEmpty }) { return match }
        let name = college.name.lowercased()
        return apps.first { $0.name.lowercased() == name }
    }

    /// The remove confirm, matching the web List tab: an untouched application leaves with the school
    /// (lib/list-sync.ts); any other stays on Applications, unlinked from the list.
    static func removalMessage(for app: TrackedApplication?) -> String {
        guard let app else { return "Saved essay drafts will remain." }
        let fate = app.untouched
            ? "Its Not started application leaves Applications and Progress too."
            : "Its application (\(app.statusLabel)) stays on Applications and Progress, no longer linked to the list."
        return "\(fate) Saved essay drafts will remain."
    }
}

/// Filters and sort live in `ExploreFilters`.
enum CollegesExplore {
    /// Search runs once the trimmed query has two or more characters.
    static func searchTerm(_ query: String) -> String? {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return term.count >= 2 ? term : nil
    }
}

enum CollegesPrograms {
    struct Area: Identifiable, Equatable, Sendable {
        var area: String
        var programs: [CollegesProgram]
        var awards: Int
        var id: String { area }
    }

    /// Programs grouped by field, the most-awarded field first.
    static func areas(_ programs: [CollegesProgram]) -> [Area] {
        var order: [String] = []
        var groups: [String: [CollegesProgram]] = [:]
        for program in programs {
            if groups[program.area] == nil { order.append(program.area) }
            groups[program.area, default: []].append(program)
        }
        let areas = order.map { name in
            let items = groups[name] ?? []
            return Area(area: name, programs: items, awards: items.reduce(0) { $0 + ($1.awards ?? 0) })
        }
        // Stable: ties keep first-seen order.
        return areas.enumerated().sorted { a, b in
            a.element.awards != b.element.awards ? a.element.awards > b.element.awards : a.offset < b.offset
        }.map(\.element)
    }

    /// Programs with published earnings, highest first.
    static func topEarnings(_ programs: [CollegesProgram], limit: Int = 12) -> [CollegesProgram] {
        Array(programs.filter { $0.earnings4 != nil }.sorted { ($0.earnings4 ?? 0) > ($1.earnings4 ?? 0) }.prefix(limit))
    }

    /// Percent above (+) or below (−) the national median, rounded.
    static func versusNational(_ program: CollegesProgram) -> Int? {
        guard let mine = program.earnings4, let national = program.national4, national > 0 else { return nil }
        return Int(((mine - national) / national * 100).rounded())
    }
}

enum CollegesOdds {
    /// Keys this run should have saved but didn't: missing afterwards, or unchanged since before.
    static func missedKeys(_ keys: [String], before: [String: AdmissionOdds], after: [String: AdmissionOdds]) -> [String] {
        keys.filter { key in
            guard let stamp = after[key]?.estimatedAt, !stamp.isEmpty else { return true }
            return stamp == before[key]?.estimatedAt
        }
    }

    /// A readable name for an odds key.
    static func name(for key: String, in workspace: Workspace, apps: [TrackedApplication]) -> String {
        if key.hasPrefix("app:") {
            let id = String(key.dropFirst(4))
            return apps.first { $0.id == id }?.name ?? key
        }
        guard let college = workspace.colleges.first(where: { $0.slug == key }) else { return key }
        return college.short.isEmpty ? college.name : college.short
    }
}

enum CollegesFormat {
    /// "$12,345", or "Not reported".
    static func money(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "Not reported" }
        return value.formatted(.currency(code: "USD").precision(.fractionLength(0)).locale(Locale(identifier: "en_US")))
    }

    /// Missing values read as an em dash.
    static func dash(_ value: String?) -> String {
        guard let value, !value.trimmingCharacters(in: .whitespaces).isEmpty else { return "—" }
        return value
    }

    static func capitalized(_ value: String?) -> String? {
        guard let value, let first = value.first else { return nil }
        return first.uppercased() + value.dropFirst()
    }

    /// "Houston, TX · Urban campus · Private, nonprofit".
    static func place(_ college: College) -> String {
        let city = college.location?.components(separatedBy: " · ").first
        let setting = capitalized(college.setting).map { "\($0) campus" }
        return [city, setting, college.ownership].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · ")
    }

    /// "www.example.edu" → "example.edu".
    static func host(_ link: String) -> String {
        guard let host = URL(string: link)?.host() else { return link }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }
}
