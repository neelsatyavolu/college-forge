import Foundation
import Observation

/// Load state for data the Colleges tab fetches itself.
enum CollegesLoad<Value> {
    case idle
    case loading
    case loaded(Value)
    case failed(APIError)

    var value: Value? {
        if case .loaded(let value) = self { return value }
        return nil
    }
}

/// Explore: the catalog browse list, live search, filters and sort. Owned by `CollegesView` so it survives
/// switching segments. The filters persist across launches, as the web keeps them in localStorage.
@MainActor
@Observable
final class CollegesExploreModel {
    private static let filtersKey = "forge.colleges.exploreFilters"

    private(set) var browse: CollegesLoad<CollegesSearchResponse> = .idle
    private(set) var results: [ExploreItem]?
    private(set) var isSearching = false
    private(set) var searchError: APIError?
    var query = ""
    var filters: ExploreFilterState {
        didSet { save() }
    }

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        filters = defaults.data(forKey: Self.filtersKey)
            .flatMap { try? JSONDecoder().decode(ExploreFilterState.self, from: $0) } ?? .defaults
    }

    var edition: String { browse.value?.edition ?? "" }
    var catalogDate: String { browse.value?.catalogDate ?? "" }
    var isSearchMode: Bool { CollegesExplore.searchTerm(query) != nil }
    var rankingName: String { "U.S. News \(edition.isEmpty ? "" : edition + " ")National Universities" }
    var isFiltered: Bool { !ExploreFilters.chips(filters).isEmpty }
    var browseItems: [ExploreItem] { browse.value?.items ?? [] }
    var states: [String] { ExploreFilters.states(browseItems) }

    func rows(favorites: Set<String>) -> [ExploreItem] {
        let source = isSearchMode ? (results ?? []) : browseItems
        return ExploreFilters.apply(source, filters, ExploreFilterContext(favorites: favorites, searchMode: isSearchMode))
    }

    func loadBrowse(api: APIClient, force: Bool = false) async {
        if !force, browse.value != nil { return }
        if browse.value == nil { browse = .loading }
        do {
            browse = .loaded(try await api.collegesBrowse())
        } catch {
            let apiError = APIError.wrap(error)
            if apiError != .cancelled, browse.value == nil { browse = .failed(apiError) }
        }
    }

    /// Debounced search. Call from `.task(id: query)` so typing cancels the previous run.
    func search(api: APIClient) async {
        guard let term = CollegesExplore.searchTerm(query) else {
            results = nil
            isSearching = false
            searchError = nil
            return
        }
        isSearching = true
        do {
            try await Task.sleep(for: .milliseconds(280))
            let found = try await api.collegesSearch(term)
            results = found.items
            searchError = nil
            isSearching = false
        } catch {
            let apiError = APIError.wrap(error)
            guard apiError != .cancelled, !(error is CancellationError) else { return }
            searchError = apiError
            results = []
            isSearching = false
        }
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(filters) else { return }
        defaults.set(data, forKey: Self.filtersKey)
    }
}

/// "For you": recommendations from the ranking evidence.
@MainActor
@Observable
final class CollegesPicksModel {
    private(set) var state: CollegesLoad<CollegesRecommendationSet> = .idle

    func load(api: APIClient) async {
        if state.value == nil { state = .loading }
        do {
            state = .loaded(try await api.collegeRecommendations())
        } catch {
            let apiError = APIError.wrap(error)
            if apiError != .cancelled { state = .failed(apiError) }
        }
    }
}

/// Inputs that change the recommendations; reloading is keyed on this.
struct CollegesPicksKey: Hashable {
    var gpa: String
    var sat: String
    var satNote: String
    var intended: String
    var testing: TestScores
    var prefs: ListPrefs?

    init(_ ws: Workspace) {
        gpa = ws.applicant.gpaUnweighted
        sat = ws.applicant.sat
        satNote = ws.applicant.satNote
        intended = ws.profile.intended
        testing = ws.profile.testing
        prefs = ws.onboarding.listPrefs
    }
}

/// Favorites are per device, like the web (which keeps them in the browser).
@MainActor
@Observable
final class CollegesFavorites {
    private static let key = "forge.colleges.favorites"
    private let defaults: UserDefaults
    private(set) var slugs: Set<String>

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        slugs = Set(defaults.stringArray(forKey: Self.key) ?? [])
    }

    func contains(_ slug: String) -> Bool { slugs.contains(slug) }

    func toggle(_ slug: String) {
        if slugs.contains(slug) { slugs.remove(slug) } else { slugs.insert(slug) }
        defaults.set(slugs.sorted(), forKey: Self.key)
    }
}
