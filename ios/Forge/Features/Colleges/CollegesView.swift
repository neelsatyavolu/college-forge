import SwiftUI

enum CollegesSegment: String, CaseIterable, Identifiable {
    case forYou, explore, shortlist
    var id: String { rawValue }

    var title: String {
        switch self {
        case .forYou: "For you"
        case .explore: "Explore"
        case .shortlist: "Shortlist"
        }
    }
}

/// Opens one school's detail page. `college` is the row that was tapped, shown while the full record loads.
struct CollegesDetailRoute: Hashable {
    let college: College
}

/// The Colleges tab: recommendations, the ranking and search, and the student's shortlist.
struct CollegesView: View {
    @Environment(Router.self) private var router
    @AppStorage("forge.colleges.segment") private var segment: CollegesSegment = .forYou
    @State private var explore = CollegesExploreModel()
    @State private var picks = CollegesPicksModel()
    @State private var chances = CollegesChancesModel()
    @State private var favorites = CollegesFavorites()

    var body: some View {
        @Bindable var router = router
        NavigationStack(path: $router.collegesPath) {
            WorkspaceGate {
                pinnedPicker(content)
            }
            .navigationTitle("Colleges")
            // The pinned picker and a collapsing large title fight on first appearance (the title vanished
            // and left an empty band), so the title sits in the bar at large size instead.
            .toolbarTitleDisplayMode(.inlineLarge)
            .forgeScreenBackground()
            .navigationDestination(for: CollegesDetailRoute.self) { route in
                CollegeDetailView(college: route.college)
            }
        }
        .environment(explore)
        .environment(picks)
        .environment(chances)
        .environment(favorites)
    }

    @ViewBuilder private var content: some View {
        switch segment {
        case .forYou: RecommendationsView(segment: $segment)
        case .explore: ExploreView()
        case .shortlist: ShortlistView(segment: $segment)
        }
    }

    /// iOS 26's safeAreaBar joins the navigation bar's scroll-edge effect, so the large title stays put
    /// when the segment changes; older systems use a plain inset.
    @ViewBuilder private func pinnedPicker(_ content: some View) -> some View {
        if #available(iOS 26, *) {
            content.safeAreaBar(edge: .top, spacing: 0) { picker }
        } else {
            content.safeAreaInset(edge: .top, spacing: 0) { picker }
        }
    }

    private var picker: some View {
        Picker("Section", selection: $segment) {
            ForEach(CollegesSegment.allCases) { Text($0.title).tag($0) }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, Theme.Spacing.xs)
        .background(Theme.canvas)
        .sensoryFeedback(.selection, trigger: segment)
    }
}

#Preview {
    CollegesView().previewEnvironment()
}
