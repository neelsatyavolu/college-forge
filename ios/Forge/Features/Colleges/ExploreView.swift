import SwiftUI

/// The Explore catalog (1,000+ colleges), live search, sort, filters and favorites.
struct ExploreView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(CollegesExploreModel.self) private var model
    @Environment(CollegesFavorites.self) private var favorites
    @State private var busySlug: String?
    @State private var error: APIError?
    @State private var showsFilters = false

    var body: some View {
        @Bindable var model = model
        content
            .searchable(text: $model.query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search any U.S. college")
            .autocorrectionDisabled()
            .task { await model.loadBrowse(api: store.api) }
            .task(id: model.query) { await model.search(api: store.api) }
            .toolbar { ToolbarItem(placement: .topBarTrailing) { filterButton } }
            .sheet(isPresented: $showsFilters) { ExploreFilterSheet() }
            .errorAlert($error)
    }

    @ViewBuilder private var content: some View {
        if model.isSearchMode {
            list
        } else {
            switch model.browse {
            case .failed(let apiError):
                ErrorStateView(error: apiError) { await model.loadBrowse(api: store.api, force: true) }
            case .idle, .loading:
                LoadingView(label: "Loading colleges…")
            case .loaded:
                list
            }
        }
    }

    private var list: some View {
        let rows = model.rows(favorites: favorites.slugs)
        let chips = ExploreFilters.chips(model.filters)
        return List {
            if !chips.isEmpty {
                ExploreChipsRow(chips: chips) { chip in
                    model.filters = chip.cleared
                    Haptics.selection()
                }
                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                .listRowBackground(Color.clear)
            }
            Section {
                ForEach(rows) { item in
                    let college = item.college
                    NavigationLink(value: CollegesDetailRoute(college: college)) {
                        ExploreRow(
                            item: item,
                            isSaved: store.shortlistContains(college),
                            isFavorite: favorites.contains(college.slug),
                            config: store.config
                        )
                    }
                    .swipeActions(edge: .leading) { favoriteButton(college) }
                    .swipeActions(edge: .trailing) { addButton(college) }
                    .contextMenu { addButton(college); favoriteButton(college) }
                }
            } header: {
                header(count: rows.count)
            } footer: {
                if !rows.isEmpty { aboutFooter }
            }
        }
        .listStyle(.insetGrouped)
        .overlay { emptyState(isEmpty: rows.isEmpty) }
        .refreshable { await model.loadBrowse(api: store.api, force: true) }
    }

    private func header(count: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if model.isSearching {
                Text("Searching…")
            } else if model.isSearchMode {
                Text("\(count) result\(count == 1 ? "" : "s") for “\(model.query.trimmingCharacters(in: .whitespaces))”")
            } else {
                Text("\(count) \(model.isFiltered ? "matching " : "")college\(count == 1 ? "" : "s")")
                Text(model.filters.sort == .rank ? "Ranked by \(model.rankingName), then by size" : "Sorted by \(model.filters.sort.label.lowercased())")
                    .foregroundStyle(Theme.mutedSoft)
            }
        }
        .font(.footnote)
        .textCase(nil)
    }

    @ViewBuilder private func emptyState(isEmpty: Bool) -> some View {
        if let searchError = model.searchError, model.isSearchMode {
            ContentUnavailableView("Search failed", systemImage: "exclamationmark.triangle", description: Text(searchError.message))
        } else if isEmpty, !model.isSearching {
            if model.isSearchMode, !model.isFiltered {
                ContentUnavailableView.search(text: model.query)
            } else {
                ContentUnavailableView(
                    "No colleges match these filters",
                    systemImage: model.filters.favoritesOnly ? "star" : "line.3.horizontal.decrease.circle",
                    description: Text(model.filters.favoritesOnly ? "Swipe right on a college to add it to your favorites." : "Remove a filter or try another one.")
                )
            }
        }
    }

    private var aboutFooter: some View {
        let asOf = model.catalogDate.isEmpty ? "" : " (as of \(model.catalogDate))"
        return Text("The list covers every operating four-year public and nonprofit college with at least 1,000 undergraduates in the U.S. Department of Education’s College Scorecard\(asOf), plus every school on the \(model.rankingName) and Liberal Arts lists. Ranks and average GPA come from U.S. News. Admission rates, SAT/ACT ranges, cost, graduation and earnings come from the College Scorecard. Full-need aid, admission rounds and testing policies come from Forge’s notes, sourced from each college’s own pages and Common Data Set. Campus photos are from Wikimedia Commons, credited on each school’s page, or from U.S. News. A rank is one publication’s judgment, not a measure of fit. Confirm deadlines and requirements with each college.")
            .padding(.top, Theme.Spacing.xs)
    }

    private var filterButton: some View {
        let count = ExploreFilters.activeCount(model.filters)
        return Button { showsFilters = true } label: {
            Label(count > 0 ? "Filters (\(count))" : "Sort and filter",
                  systemImage: model.isFiltered ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
    }

    @ViewBuilder private func addButton(_ college: College) -> some View {
        if !store.shortlistContains(college) {
            Button {
                Task { await add(college) }
            } label: {
                Label("Add to shortlist", systemImage: "plus")
            }
            .tint(Theme.accent)
            .disabled(busySlug == college.slug)
        }
    }

    private func favoriteButton(_ college: College) -> some View {
        let isFavorite = favorites.contains(college.slug)
        return Button {
            favorites.toggle(college.slug)
            Haptics.selection()
        } label: {
            Label(isFavorite ? "Unfavorite" : "Favorite", systemImage: isFavorite ? "star.slash" : "star")
        }
        .tint(Theme.amber)
    }

    private func add(_ college: College) async {
        busySlug = college.slug
        defer { busySlug = nil }
        do {
            try await store.shortlistAdd(college)
            Haptics.success()
        } catch {
            self.error = APIError.wrap(error)
            Haptics.error()
        }
    }
}

/// One college in the ranking or search results.
struct ExploreRow: View {
    let item: ExploreItem
    let isSaved: Bool
    let isFavorite: Bool
    let config: AppConfig

    private var college: College { item.college }

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.sm) {
            CollegePhoto(name: college.name, url: config.resolve(item.extras.thumb ?? college.photo))
                .frame(width: 60, height: 60)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous))
                .overlay(alignment: .bottomLeading) { rankTag }
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(college.name)
                        .font(.body.weight(.medium))
                        .foregroundStyle(Theme.ink)
                    if isFavorite {
                        Image(systemName: "star.fill").font(.caption).foregroundStyle(Theme.amber)
                            .accessibilityLabel("Favorite")
                    }
                }
                Text(college.location?.isEmpty == false ? college.location! : "Location unavailable")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
                Text("Admit \(CollegesFormat.dash(college.admit)) · SAT \(CollegesFormat.dash(college.satRange))")
                    .font(.forgeNumber(.footnote, weight: .regular))
                    .foregroundStyle(Theme.body)
                tags
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var rankTag: some View {
        if let (text, spoken) = rankLabel {
            Text(text)
                .font(.caption2.weight(.bold).monospacedDigit())
                .foregroundStyle(.white)
                .padding(.horizontal, 5)
                .padding(.vertical, 2)
                .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 4))
                .padding(4)
                .accessibilityLabel(spoken)
        }
    }

    /// National rank first, else the liberal arts rank.
    private var rankLabel: (String, String)? {
        if let rank = college.rank, rank > 0 { return ("#\(rank)", "Ranked \(rank)") }
        if let lac = item.extras.lacRank, lac > 0 { return ("#\(lac) LAC", "Ranked \(lac) among liberal arts colleges") }
        return nil
    }

    @ViewBuilder private var tags: some View {
        let fit = college.tags?.first?.label
        if isSaved || fit != nil {
            HStack(spacing: Theme.Spacing.xs) {
                if isSaved { Badge(text: "On your shortlist", tone: Theme.accent) }
                if let fit, !isSaved { Badge(text: fit, tone: ToneName.color(college.tags?.first?.tone ?? ""), showsDot: false) }
            }
            .padding(.top, 2)
        }
    }
}
