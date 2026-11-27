import Foundation
import Testing
@testable import Forge

// Synthetic schools only. Mirrors public/hub/ExploreFilters.jsx and the facet shapes that
// tests/explore-catalog.test.cjs checks on the server.

private func item(
    _ slug: String, name: String? = nil, rank: Int? = nil, lacRank: Int? = nil, setting: String? = nil,
    tags: [Forge.Tag] = [], _ configure: (inout ExploreFacets) -> Void = { _ in }
) -> ExploreItem {
    var college = College(slug: slug, name: name ?? slug.capitalized)
    college.rank = rank
    college.setting = setting
    college.tags = tags
    var facets = ExploreFacets()
    configure(&facets)
    return ExploreItem(college: college, extras: ExploreRowExtras(slug: slug, lacRank: lacRank, facets: facets))
}

private let browse = ExploreFilterContext()

private func ids(_ items: [ExploreItem], _ state: ExploreFilterState, _ ctx: ExploreFilterContext = browse) -> [String] {
    ExploreFilters.apply(items, state, ctx).map(\.id)
}

@Suite("Explore filters")
struct ExploreFiltersTests {
    @Test func rankSortPutsNationalAndLiberalArtsSideBySideThenSize() {
        let items = [
            item("big", { $0.size = 40_000 }),
            item("lac3", lacRank: 3),
            item("nat3", rank: 3),
            item("small", { $0.size = 900 }),
            item("nat1", rank: 1),
        ]
        #expect(ids(items, .defaults) == ["nat1", "nat3", "lac3", "big", "small"])
    }

    @Test func liberalArtsTypeSortsByItsOwnList() {
        let items = [item("lac2", lacRank: 2), item("lac1", lacRank: 1), item("nat1", rank: 1), item("plain", { $0.kind = "liberal-arts" })]
        let state = ExploreFilterState.defaults.with(\.type, "liberal-arts")
        #expect(ids(items, state) == ["lac1", "lac2", "plain"])
    }

    @Test func kindUsesRanksThenCarnegieKind() {
        #expect(ExploreFilters.kind(item("a", rank: 5)) == "national")
        #expect(ExploreFilters.kind(item("b", rank: 5, lacRank: 9)) == "liberal-arts")
        #expect(ExploreFilters.kind(item("c", { $0.kind = "research" })) == "national")
        #expect(ExploreFilters.kind(item("d")) == "other")
    }

    @Test func numericSortsPutUnknownsLastEitherWay() {
        let items = [item("none"), item("high", { $0.admit = 0.8 }), item("low", { $0.admit = 0.05 })]
        #expect(ids(items, ExploreFilterState.defaults.with(\.sort, .admitAsc)) == ["low", "high", "none"])
        #expect(ids(items, ExploreFilterState.defaults.with(\.sort, .admitDesc)) == ["high", "low", "none"])
    }

    @Test func nameSortAndStableTies() {
        let items = [item("b", name: "Beta College"), item("a", name: "Alpha College"), item("x"), item("y")]
        #expect(ids(items, ExploreFilterState.defaults.with(\.sort, .name)).prefix(2) == ["a", "b"])
        // Equal sizes keep the incoming order.
        #expect(ids([item("x"), item("y")], ExploreFilterState.defaults.with(\.sort, .sizeDesc)) == ["x", "y"])
    }

    @Test func searchKeepsRelevanceUnlessASortIsPicked() {
        let items = [item("second", rank: 2), item("first", rank: 1)]
        let search = ExploreFilterContext(searchMode: true)
        #expect(ids(items, .defaults, search) == ["second", "first"])
        #expect(ids(items, ExploreFilterState.defaults.with(\.sort, .name), search) == ["first", "second"])
    }

    @Test func bandsAreHalfOpenAndNeedData() {
        let items = [
            item("edge", { $0.admit = 0.15; $0.size = 5000; $0.net = 15000 }),
            item("under", { $0.admit = 0.1; $0.size = 4999; $0.net = 14999 }),
            item("unknown"),
        ]
        #expect(ids(items, ExploreFilterState.defaults.with(\.admit, "lt15")) == ["under"])
        #expect(ids(items, ExploreFilterState.defaults.with(\.admit, "15-40")) == ["edge"])
        #expect(ids(items, ExploreFilterState.defaults.with(\.size, "medium")) == ["edge"])
        #expect(ids(items, ExploreFilterState.defaults.with(\.net, "lt25")).sorted() == ["edge", "under"])
    }

    @Test func selectsMatchFacetsExactly() {
        let items = [
            item("pub", setting: "urban", { $0.control = "public"; $0.region = "west"; $0.state = "CA" }),
            item("priv", setting: "rural", { $0.control = "private"; $0.region = "south"; $0.state = "TX" }),
            item("blank"),
        ]
        #expect(ids(items, ExploreFilterState.defaults.with(\.control, "public")) == ["pub"])
        #expect(ids(items, ExploreFilterState.defaults.with(\.region, "south")) == ["priv"])
        #expect(ids(items, ExploreFilterState.defaults.with(\.state, "CA")) == ["pub"])
        #expect(ids(items, ExploreFilterState.defaults.with(\.setting, "rural")) == ["priv"])
        #expect(ExploreFilters.states(items) == ["CA", "TX"])
    }

    @Test func togglesOnlyPassSchoolsWhoseDataSaysSo() {
        let items = [
            item("full", { $0.meetsNeed = true; $0.testPolicy = "blind"; $0.intl = "aid"; $0.nursing = "both"; $0.ed = true; $0.notes = true }),
            item("partial", { $0.testPolicy = "required"; $0.intl = "none"; $0.nursing = "competitive"; $0.ea = true; $0.hbcu = true; $0.women = true }),
            item("fit", tags: [Forge.Tag(label: "In range", tone: "close")]),
        ]
        func on(_ toggle: ExploreToggle) -> [String] { ids(items, ExploreFilterState.defaults.toggling(toggle)) }
        #expect(on(.meetsNeed) == ["full"])
        #expect(on(.testOptional) == ["full"])
        #expect(on(.intlAid) == ["full"])
        #expect(on(.nursing) == ["full"])
        #expect(on(.ed) == ["full"])
        #expect(on(.ea) == ["partial"])
        #expect(on(.hbcu) == ["partial"])
        #expect(on(.women) == ["partial"])
        #expect(on(.notes) == ["full"])
        #expect(on(.inRange) == ["fit"])
        // Toggles combine with AND.
        #expect(ids(items, ExploreFilterState.defaults.toggling(.ed).toggling(.ea)).isEmpty)
    }

    @Test func countChipsAndClearing() {
        let state = ExploreFilterState.defaults
            .with(\.sort, .netAsc).with(\.setting, "town").with(\.favoritesOnly, true)
            .with(\.control, "private").with(\.state, "OH").toggling(.hbcu)
        // Setting and favorites don't count, as on the web.
        #expect(ExploreFilters.activeCount(state) == 3)
        let chips = ExploreFilters.chips(state)
        #expect(chips.map(\.label) == ["Town", "Favorites", "Private", "OH", "HBCU"])
        #expect(chips[2].cleared.control == "all")
        #expect(chips[2].cleared.state == "OH")
        #expect(chips[4].cleared.on.isEmpty)
        let cleared = state.cleared()
        #expect(cleared.sort == .netAsc)
        #expect(ExploreFilters.chips(cleared).isEmpty)
        #expect(state.toggling(.hbcu).toggling(.hbcu) == state)
    }

    @Test func savedFiltersDecodeLeniently() throws {
        let json = #"{"sort":"bogus","type":"national","on":["hbcu","favorites","nope"],"state":"NY"}"#
        let state = try JSONDecoder().decode(ExploreFilterState.self, from: Data(json.utf8))
        #expect(state.sort == .rank)
        #expect(state.type == "national")
        #expect(state.on == [.hbcu])
        #expect(state.control == "all")
        let roundTrip = try JSONDecoder().decode(ExploreFilterState.self, from: JSONEncoder().encode(state))
        #expect(roundTrip == state)
    }

    @MainActor @Test func modelPersistsFilters() throws {
        let defaults = try #require(UserDefaults(suiteName: "explore-filters-test-\(UUID().uuidString)"))
        let model = CollegesExploreModel(defaults: defaults)
        model.filters = model.filters.with(\.region, "west")
        #expect(CollegesExploreModel(defaults: defaults).filters.region == "west")
    }
}

@Suite("Explore decoding")
struct ExploreDecodingTests {
    @Test func browseRowsCarryFacetsBesideTheCollege() throws {
        let json = """
        {"success":true,"catalogDate":"2026-11-20","data":[
          {"slug":"sample-college","name":"Sample College","lacRank":4,"thumb":"https://upload.wikimedia.org/x/500px-a.jpg",
           "f":{"admit":0.12,"size":"1800","meetsNeed":true,"state":"VT","testPolicy":"optional","lists":{"usn":3}}},
          {"slug":"plain-u","name":"Plain U","f":"junk"}]}
        """
        let response = try JSONDecoder().decode(CollegesSearchResponse.self, from: Data(json.utf8))
        #expect(response.catalogDate == "2026-11-20")
        let items = response.items
        #expect(items.map(\.id) == ["sample-college", "plain-u"])
        #expect(items[0].extras.lacRank == 4)
        #expect(items[0].extras.thumb?.hasSuffix("500px-a.jpg") == true)
        #expect(items[0].facets.admit == 0.12)
        #expect(items[0].facets.size == 1800)
        #expect(items[0].facets.meetsNeed)
        #expect(!items[0].facets.hbcu)
        #expect(items[1].facets == ExploreFacets())
    }

    @Test func detailCarriesNotesCreditAndRanks() throws {
        let json = """
        {"success":true,"data":{"slug":"sample-college","name":"Sample College","partial":true,"programs":[],
          "credit":{"by":"Jane Doe","license":"CC BY-SA 4.0","page":"https://commons.wikimedia.org/wiki/File:Hall.jpg"},
          "lacRank":4,"rankings":{"forbes":20,"niche":31,"bad":"x"},
          "research":{"checkedAt":"2026-09-01",
            "notes":[{"label":"Need-based aid","value":"Meets full need","sourceUrl":"https://example.edu/aid","checkedAt":"2026-09-01","thirdParty":false},{"nope":1}],
            "byIncome":[{"band":"Under $30,000","value":"$4,000","sourceUrl":"https://example.edu/npc"}],
            "deadlines":[{"plan":"ED","date":"Nov 1","note":null}],
            "essays":[{"label":"Why us","prompt":"Why Sample?","limit":250,"unit":"words","required":true}]},
          "intlAid":{"label":"need-based aid for international students","none":false,"source":null},
          "nursing":{"entry":"direct","note":null,"sourceUrl":"https://example.edu/nursing"},
          "niche":{"overall":"A","campus":null},"switching":[{"major":"Computer science","level":3,"label":"Competitive"}],
          "earningsRange":{"p25":40000,"p75":90000},"hbcu":false,"women":true,"f":{"meetsNeed":true}}}
        """
        let detail = try JSONDecoder().decode(DataEnvelope<CollegesDetail>.self, from: Data(json.utf8)).data
        let extras = detail.extras
        #expect(detail.partial)
        #expect(detail.college.name == "Sample College")
        #expect(extras.credit?.by == "Jane Doe")
        #expect(extras.lacRank == 4)
        #expect(extras.rankings == ["forbes": 20, "niche": 31])
        #expect(extras.research?.notes.count == 1)
        #expect(extras.research?.byIncome.first?.value == "$4,000")
        #expect(extras.research?.deadlines.first?.note == nil)
        #expect(extras.research?.essays.first?.limit == 250)
        #expect(extras.intlAid?.source == nil)
        #expect(extras.nursing?.entry == "direct")
        #expect(extras.niche?.overall == "A")
        #expect(extras.switching.first?.level == 3)
        #expect(extras.earningsRange?.p75 == 90000)
        #expect(extras.women)
        #expect(extras.facets.meetsNeed)
    }

    @Test func detailWithoutExtrasStillDecodes() throws {
        let json = #"{"success":true,"data":{"slug":"x","name":"X","research":null,"credit":null}}"#
        let detail = try JSONDecoder().decode(DataEnvelope<CollegesDetail>.self, from: Data(json.utf8)).data
        #expect(detail.extras.research == nil)
        #expect(detail.extras.credit == nil)
        #expect(!detail.partial)
    }

    @Test func onlyHttpLinksOpen() {
        #expect(ExploreLinks.safeURL("https://www.example.edu/a") != nil)
        #expect(ExploreLinks.safeURL("javascript:alert(1)") == nil)
        #expect(ExploreLinks.safeURL("/relative") == nil)
        #expect(ExploreLinks.safeURL(nil) == nil)
        #expect(ExploreLinks.host("https://www.example.edu/a") == "example.edu")
        #expect(ExploreLinks.host("ftp://x") == "source")
        #expect(CollegeSpecialNotesSection.nursingLine("direct")?.hasPrefix("First-years") == true)
        #expect(CollegeSpecialNotesSection.nursingLine("other") == nil)
    }
}
