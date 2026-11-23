import SwiftUI

/// "For you": a starting list from graduate-outcome evidence, the student's academics and preferences.
struct RecommendationsView: View {
    @Binding var segment: CollegesSegment

    @Environment(WorkspaceStore.self) private var store
    @Environment(CollegesPicksModel.self) private var picks
    @State private var showsPreferences = false

    // One ScrollView for every state: swapping the root view (loading -> loaded) left the large
    // "Colleges" title bound to the old view, so it vanished and left an empty band.
    var body: some View {
        ScrollView {
            switch picks.state {
            case .idle, .loading:
                LoadingView(label: "Finding colleges in the ranking data…")
                    .containerRelativeFrame(.vertical) { height, _ in height * 0.7 }
            case .failed(let apiError):
                ErrorStateView(error: apiError) { await picks.load(api: store.api) }
                    .containerRelativeFrame(.vertical) { height, _ in height * 0.7 }
            case .loaded(let set):
                content(set)
            }
        }
        .refreshable { await picks.load(api: store.api) }
        .task(id: CollegesPicksKey(store.workspace)) { await picks.load(api: store.api) }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showsPreferences = true } label: { Label("Adjust preferences", systemImage: "slider.horizontal.3") }
            }
        }
        .sheet(isPresented: $showsPreferences) { RecommendationPreferencesSheet() }
    }

    private func content(_ set: CollegesRecommendationSet) -> some View {
        LazyVStack(alignment: .leading, spacing: Theme.Spacing.md) {
            RecommendationsIntro(showPreferences: { showsPreferences = true })
            if !set.profileGaps.isEmpty { RecommendationGaps(gaps: set.profileGaps) }
            SectionHeader(
                title: "\(set.recommendations.count) starting point\(set.recommendations.count == 1 ? "" : "s")",
                detail: "250-college snapshot\(set.generatedAt.isEmpty ? "" : " · \(set.generatedAt)")"
            )
            .padding(.top, Theme.Spacing.xs)
            if set.recommendations.isEmpty {
                EmptyStateView(
                    systemImage: "magnifyingglass",
                    title: "No matches in this snapshot",
                    message: "Try another region or campus setting, or explore the wider college search.",
                    actionTitle: "Explore all colleges"
                ) { segment = .explore }
            }
            ForEach(set.recommendations) { RecommendationCard(recommendation: $0) }
            RecommendationMethodology(set: set)
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.bottom, Theme.Spacing.lg)
    }
}

private struct RecommendationsIntro: View {
    let showPreferences: () -> Void
    @Environment(WorkspaceStore.self) private var store
    @Environment(Router.self) private var router

    var body: some View {
        let intended = store.workspace.profile.intended.trimmingCharacters(in: .whitespaces)
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Eyebrow(text: "Evidence first. Your priorities always.")
            Text(intended.isEmpty ? "Exploring your options" : intended)
                .font(.forgeDisplay(.title2))
                .foregroundStyle(Theme.ink)
            Text(intended.isEmpty
                 ? "Add your major and academics to make this list more personal."
                 : "A starting list grounded in graduate outcomes, your academics and what matters to you. Major evidence appears where published data exists.")
                .font(.subheadline)
                .foregroundStyle(Theme.body)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: Theme.Spacing.md) {
                Button("Adjust preferences", action: showPreferences)
                Button("Edit profile") { router.selectedTab = .profile }
                Button("Discuss with AI") {
                    router.openChat(prompt: "Review my recommended colleges using the ranking evidence. Explain the best fits, compare the source evidence, flag missing information, and help me build a balanced list. Do not change my saved list until I ask.")
                }
            }
            .font(.subheadline.weight(.medium))
            .tint(Theme.accent)
            .padding(.top, 2)
        }
        .padding(.top, Theme.Spacing.sm)
    }
}

private struct RecommendationGaps: View {
    let gaps: [String]
    @State private var isExpanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                ForEach(gaps, id: \.self) { CollegesBullet(text: $0, tone: Theme.amber) }
            }
            .padding(.top, Theme.Spacing.xs)
        } label: {
            Label("Make this list more useful · \(gaps.count) to check", systemImage: "lightbulb")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.ink)
        }
        .tint(Theme.muted)
        .forgeCard(padding: Theme.Spacing.sm)
    }
}

/// How the list is made, its limits and sources.
private struct RecommendationMethodology: View {
    let set: CollegesRecommendationSet
    @Environment(WorkspaceStore.self) private var store
    @State private var isExpanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                Text(set.methodology).font(.subheadline).foregroundStyle(Theme.body)
                ForEach(set.limitations, id: \.self) { CollegesBullet(text: $0) }
                ForEach(set.sources, id: \.url) { source in
                    if let url = store.config.resolve(source.url) {
                        Link(destination: url) { Label(source.label, systemImage: "arrow.up.right.square") }
                            .font(.subheadline)
                    }
                }
            }
            .padding(.top, Theme.Spacing.xs)
        } label: {
            Text("How this list is made · sources and limits")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.ink)
        }
        .tint(Theme.muted)
        .forgeCard(padding: Theme.Spacing.sm)
        .padding(.top, Theme.Spacing.xs)
    }
}
