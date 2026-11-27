import Foundation

// Explore's sort and filters, ported from public/hub/ExploreFilters.jsx. Rows carry raw numbers in their
// facets; a filter only matches rows whose data says so, so a school with no data never passes a filter.

enum ExploreSort: String, CaseIterable, Codable, Sendable, Identifiable {
    case rank
    case admitAsc = "admit-asc"
    case admitDesc = "admit-desc"
    case netAsc = "net-asc"
    case earnDesc = "earn-desc"
    case gradDesc = "grad-desc"
    case sizeDesc = "size-desc"
    case sizeAsc = "size-asc"
    case name

    var id: String { rawValue }

    var label: String {
        switch self {
        case .rank: "Rank"
        case .admitAsc: "Most selective"
        case .admitDesc: "Highest admit rate"
        case .netAsc: "Lowest net price"
        case .earnDesc: "Highest earnings"
        case .gradDesc: "Highest graduation rate"
        case .sizeDesc: "Largest"
        case .sizeAsc: "Smallest"
        case .name: "Name A–Z"
        }
    }
}

/// The "only show colleges that…" switches.
enum ExploreToggle: String, CaseIterable, Codable, Sendable, Identifiable {
    case meetsNeed, testOptional, intlAid, nursing, ed, ea, inRange, hbcu, women, notes

    var id: String { rawValue }

    var label: String {
        switch self {
        case .meetsNeed: "Meets full need"
        case .testOptional: "Test-optional"
        case .intlAid: "Aids international students"
        case .nursing: "Direct-entry nursing"
        case .ed: "Early Decision"
        case .ea: "Early Action"
        case .inRange: "In my SAT range"
        case .hbcu: "HBCU"
        case .women: "Women’s college"
        case .notes: "Has Forge notes"
        }
    }
}

/// One dropdown: its key, label and (value, label) options; the first option is "all".
struct ExploreSelect: Sendable, Identifiable {
    let key: WritableKeyPath<ExploreFilterState, String> & Sendable
    let id: String
    let label: String
    let options: [(value: String, label: String)]
}

/// Everything the student picked. Codable so the choice survives relaunches, as the web keeps it in
/// localStorage. Immutable updates: use the `with…` helpers.
struct ExploreFilterState: Codable, Hashable, Sendable {
    var sort: ExploreSort = .rank
    var setting = "all"
    var type = "all"
    var control = "all"
    var region = "all"
    var state = ""
    var size = "all"
    var admit = "all"
    var net = "all"
    var on: Set<ExploreToggle> = []
    var favoritesOnly = false

    static let defaults = ExploreFilterState()

    init() {}

    private enum CodingKeys: String, CodingKey { case sort, setting, type, control, region, state, size, admit, net, on, favoritesOnly }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sort = c.optionalString(.sort).flatMap(ExploreSort.init(rawValue:)) ?? .rank
        setting = c.string(.setting, "all")
        type = c.string(.type, "all")
        control = c.string(.control, "all")
        region = c.string(.region, "all")
        state = c.string(.state)
        size = c.string(.size, "all")
        admit = c.string(.admit, "all")
        net = c.string(.net, "all")
        on = Set(c.array(.on, of: String.self).compactMap(ExploreToggle.init(rawValue:)))
        favoritesOnly = c.bool(.favoritesOnly)
    }

    func with<T>(_ key: WritableKeyPath<ExploreFilterState, T>, _ value: T) -> ExploreFilterState {
        var copy = self
        copy[keyPath: key] = value
        return copy
    }

    func toggling(_ toggle: ExploreToggle) -> ExploreFilterState {
        with(\.on, on.contains(toggle) ? on.subtracting([toggle]) : on.union([toggle]))
    }

    /// Every filter back to its default; the sort stays, as on the web.
    func cleared() -> ExploreFilterState { ExploreFilterState.defaults.with(\.sort, sort) }
}

/// A removable chip for one active filter.
struct ExploreChip: Identifiable, Hashable, Sendable {
    let id: String
    let label: String
    let cleared: ExploreFilterState
}

/// The SAT-range filter and favorites need context the rows don't carry.
struct ExploreFilterContext: Sendable {
    var favorites: Set<String> = []
    /// Search results keep their relevance order unless a sort is picked.
    var searchMode = false
}

enum ExploreFilters {
    static let settings: [(value: String, label: String)] = [
        ("all", "Any setting"), ("urban", "Urban"), ("suburban", "Suburban"), ("town", "Town"), ("rural", "Rural"),
    ]

    static let selects: [ExploreSelect] = [
        ExploreSelect(key: \.type, id: "type", label: "Type", options: [("all", "Any type"), ("national", "Research universities"), ("liberal-arts", "Liberal arts colleges"), ("other", "Other four-year colleges")]),
        ExploreSelect(key: \.control, id: "control", label: "Public or private", options: [("all", "Public or private"), ("public", "Public"), ("private", "Private")]),
        ExploreSelect(key: \.region, id: "region", label: "Region", options: [("all", "Any region"), ("northeast", "Northeast"), ("midwest", "Midwest"), ("south", "South"), ("west", "West")]),
        ExploreSelect(key: \.size, id: "size", label: "Size", options: [("all", "Any size"), ("small", "Under 5,000 students"), ("medium", "5,000–15,000"), ("large", "Over 15,000")]),
        ExploreSelect(key: \.admit, id: "admit", label: "Admit rate", options: [("all", "Any admit rate"), ("lt15", "Under 15%"), ("15-40", "15–40%"), ("40-70", "40–70%"), ("gt70", "Over 70%")]),
        ExploreSelect(key: \.net, id: "net", label: "Net price", options: [("all", "Any net price"), ("lt15", "Under $15,000"), ("lt25", "Under $25,000"), ("lt35", "Under $35,000")]),
    ]

    /// Half-open [low, high) bands.
    static let bands: [String: [String: (Double, Double)]] = [
        "size": ["small": (0, 5000), "medium": (5000, 15000), "large": (15000, .infinity)],
        "admit": ["lt15": (0, 0.15), "15-40": (0.15, 0.4), "40-70": (0.4, 0.7), "gt70": (0.7, 1.01)],
        "net": ["lt15": (0, 15000), "lt25": (0, 25000), "lt35": (0, 35000)],
    ]

    /// "liberal-arts", "national" or "other".
    static func kind(_ item: ExploreItem) -> String {
        if (item.extras.lacRank ?? 0) != 0 || item.facets.kind == "liberal-arts" { return "liberal-arts" }
        if (item.college.rank ?? 0) != 0 || item.facets.kind == "research" { return "national" }
        return "other"
    }

    static func inBand(_ value: Double?, _ group: String, _ id: String) -> Bool {
        guard let value, let band = bands[group]?[id] else { return false }
        return value >= band.0 && value < band.1
    }

    static func passes(_ toggle: ExploreToggle, _ item: ExploreItem) -> Bool {
        let f = item.facets
        switch toggle {
        case .meetsNeed: return f.meetsNeed
        case .testOptional: return f.testPolicy == "optional" || f.testPolicy == "blind"
        case .intlAid: return f.intl == "aid"
        case .nursing: return f.nursing == "direct" || f.nursing == "both"
        case .ed: return f.ed
        case .ea: return f.ea
        case .inRange: return (item.college.tags ?? []).contains { $0.tone == "close" || $0.tone == "strong" }
        case .hbcu: return f.hbcu
        case .women: return f.women
        case .notes: return f.notes
        }
    }

    static func matches(_ item: ExploreItem, _ s: ExploreFilterState, _ ctx: ExploreFilterContext) -> Bool {
        let f = item.facets
        if s.setting != "all", item.college.setting != s.setting { return false }
        if s.type != "all", kind(item) != s.type { return false }
        if s.control != "all", f.control != s.control { return false }
        if s.region != "all", f.region != s.region { return false }
        if !s.state.isEmpty, f.state != s.state { return false }
        if s.size != "all", !inBand(f.size, "size", s.size) { return false }
        if s.admit != "all", !inBand(f.admit, "admit", s.admit) { return false }
        if s.net != "all", !inBand(f.net, "net", s.net) { return false }
        if s.favoritesOnly, !ctx.favorites.contains(item.college.slug) { return false }
        return s.on.allSatisfy { passes($0, item) }
    }

    /// Filtered and sorted copy of `items`. Ties keep their incoming order.
    static func apply(_ items: [ExploreItem], _ s: ExploreFilterState, _ ctx: ExploreFilterContext) -> [ExploreItem] {
        let kept = items.filter { matches($0, s, ctx) }
        if ctx.searchMode, s.sort == .rank { return kept }
        let order = comparator(s)
        return kept.enumerated()
            .sorted { a, b in order(a.element, b.element) ?? (a.offset < b.offset) }
            .map(\.element)
    }

    /// true when `a` goes first, false when `b` does, nil on a tie.
    typealias Order = (ExploreItem, ExploreItem) -> Bool?

    static func comparator(_ s: ExploreFilterState) -> Order {
        switch s.sort {
        case .rank: return s.type == "liberal-arts" ? { lacOrder($0, $1) } : { rankOrder($0, $1) }
        case .admitAsc: return byNumber(\.facets.admit, ascending: true)
        case .admitDesc: return byNumber(\.facets.admit, ascending: false)
        case .netAsc: return byNumber(\.facets.net, ascending: true)
        case .earnDesc: return byNumber(\.facets.earn, ascending: false)
        case .gradDesc: return byNumber(\.facets.grad, ascending: false)
        case .sizeDesc: return byNumber(\.facets.size, ascending: false)
        case .sizeAsc: return byNumber(\.facets.size, ascending: true)
        case .name: return nameOrder
        }
    }

    private static func nameOrder(_ a: ExploreItem, _ b: ExploreItem) -> Bool? {
        let result = a.college.name.localizedCompare(b.college.name)
        return result == .orderedSame ? nil : result == .orderedAscending
    }

    /// Ranked schools first, national and liberal arts ranks side by side, then the rest by size.
    static func rankKey(_ item: ExploreItem) -> Double {
        let national = (item.college.rank ?? 0) > 0 ? Double(item.college.rank!) : .infinity
        let lac = (item.extras.lacRank ?? 0) > 0 ? Double(item.extras.lacRank!) + 0.5 : .infinity
        return min(national, lac)
    }

    private static func rankOrder(_ a: ExploreItem, _ b: ExploreItem) -> Bool? {
        compare(rankKey(a), rankKey(b)) ?? largerFirst(a, b)
    }

    /// Liberal arts colleges sort by their own list when that is the type shown.
    private static func lacOrder(_ a: ExploreItem, _ b: ExploreItem) -> Bool? {
        let key = { (i: ExploreItem) in (i.extras.lacRank ?? 0) > 0 ? Double(i.extras.lacRank!) : .infinity }
        return compare(key(a), key(b)) ?? largerFirst(a, b)
    }

    private static func largerFirst(_ a: ExploreItem, _ b: ExploreItem) -> Bool? {
        compare(b.facets.size ?? 0, a.facets.size ?? 0)
    }

    private static func compare(_ x: Double, _ y: Double) -> Bool? {
        x == y ? nil : x < y
    }

    /// Unknown values go last whichever the direction.
    private static func byNumber(_ value: KeyPath<ExploreItem, Double?>, ascending: Bool) -> Order {
        { a, b in
            switch (a[keyPath: value], b[keyPath: value]) {
            case let (x?, y?): return x == y ? nil : (ascending ? x < y : x > y)
            case (.some, nil): return true
            case (nil, .some): return false
            case (nil, nil): return nil
            }
        }
    }

    /// Filters beyond setting and favorites, as the web's "Filters (n)" count.
    static func activeCount(_ s: ExploreFilterState) -> Int {
        selects.filter { s[keyPath: $0.key] != "all" }.count + (s.state.isEmpty ? 0 : 1) + s.on.count
    }

    /// Chips for the active filters, each removable. Setting and favorites get chips too, since the app
    /// has no always-visible pills for them.
    static func chips(_ s: ExploreFilterState) -> [ExploreChip] {
        var chips: [ExploreChip] = []
        if s.setting != "all" {
            let label = settings.first { $0.value == s.setting }?.label ?? s.setting
            chips.append(ExploreChip(id: "setting", label: label, cleared: s.with(\.setting, "all")))
        }
        if s.favoritesOnly { chips.append(ExploreChip(id: "favorites", label: "Favorites", cleared: s.with(\.favoritesOnly, false))) }
        for select in selects where s[keyPath: select.key] != "all" {
            let value = s[keyPath: select.key]
            let label = select.options.first { $0.value == value }?.label ?? value
            chips.append(ExploreChip(id: select.id, label: label, cleared: s.with(select.key, "all")))
        }
        if !s.state.isEmpty { chips.append(ExploreChip(id: "state", label: s.state, cleared: s.with(\.state, ""))) }
        for toggle in ExploreToggle.allCases where s.on.contains(toggle) {
            chips.append(ExploreChip(id: toggle.rawValue, label: toggle.label, cleared: s.toggling(toggle)))
        }
        return chips
    }

    /// States present in the list, for the state picker.
    static func states(_ items: [ExploreItem]) -> [String] {
        Set(items.compactMap(\.facets.state).filter { !$0.isEmpty }).sorted()
    }
}
