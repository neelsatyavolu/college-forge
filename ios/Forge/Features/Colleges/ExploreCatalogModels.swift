import Foundation

// Explore's catalog fields (lib/explore-catalog.ts). They ride along on browse/search rows and the detail
// record but are kept off `College`, so adding a school to the shortlist never writes them to the workspace.

/// The raw numbers and flags Explore filters and sorts on: a row's `f` (`Facets`). The server drops
/// `false` and missing values, so an absent flag means "no data", never "no".
struct ExploreFacets: Decodable, Hashable, Sendable {
    var admit: Double?
    var net: Double?
    var size: Double?
    var sat: Double?
    var earn: Double?
    var grad: Double?
    /// "research" / "liberal-arts" / other Carnegie kinds.
    var kind: String?
    /// "public" / "private".
    var control: String?
    /// "northeast" / "midwest" / "south" / "west".
    var region: String?
    var state: String?
    /// "aid" or "none".
    var intl: String?
    /// "direct" / "both" / "competitive" / "none".
    var nursing: String?
    /// "required" / "optional" / "blind".
    var testPolicy: String?
    var meetsNeed = false
    var ed = false
    var ea = false
    var hbcu = false
    var women = false
    var notes = false

    init() {}

    private enum CodingKeys: String, CodingKey {
        case admit, net, size, sat, earn, grad, kind, control, region, state, intl, nursing, testPolicy
        case meetsNeed, ed, ea, hbcu, women, notes
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        admit = c.optionalDouble(.admit)
        net = c.optionalDouble(.net)
        size = c.optionalDouble(.size)
        sat = c.optionalDouble(.sat)
        earn = c.optionalDouble(.earn)
        grad = c.optionalDouble(.grad)
        kind = c.optionalString(.kind)
        control = c.optionalString(.control)
        region = c.optionalString(.region)
        state = c.optionalString(.state)
        intl = c.optionalString(.intl)
        nursing = c.optionalString(.nursing)
        testPolicy = c.optionalString(.testPolicy)
        meetsNeed = c.bool(.meetsNeed)
        ed = c.bool(.ed)
        ea = c.bool(.ea)
        hbcu = c.bool(.hbcu)
        women = c.bool(.women)
        notes = c.bool(.notes)
    }
}

/// What a browse or search row carries beyond `College`.
struct ExploreRowExtras: Decodable, Hashable, Sendable {
    var slug = ""
    var lacRank: Int?
    /// A 500px Wikimedia thumbnail, lighter than `photo` for list rows.
    var thumb: String?
    var facets = ExploreFacets()

    init(slug: String = "", lacRank: Int? = nil, thumb: String? = nil, facets: ExploreFacets = ExploreFacets()) {
        self.slug = slug
        self.lacRank = lacRank
        self.thumb = thumb
        self.facets = facets
    }

    private enum CodingKeys: String, CodingKey { case slug, lacRank, thumb, f }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        slug = c.string(.slug)
        lacRank = c.optionalInt(.lacRank)
        thumb = c.optionalString(.thumb)
        facets = c.value(.f, ExploreFacets())
    }
}

/// One Explore row: the College record plus its catalog extras.
struct ExploreItem: Identifiable, Hashable, Sendable {
    var college: College
    var extras: ExploreRowExtras

    var id: String { college.slug }
    var facets: ExploreFacets { extras.facets }
}

enum ExploreLinks {
    /// Only http(s) links with a host are opened; anything else is dropped.
    static func safeURL(_ string: String?) -> URL? {
        guard let string, let url = URL(string: string.trimmingCharacters(in: .whitespaces)),
              let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              url.host() != nil else { return nil }
        return url
    }

    /// "cds.yale.edu" from a source link, for the small source label under a note.
    static func host(_ string: String?) -> String {
        guard let host = safeURL(string)?.host() else { return "source" }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }
}
