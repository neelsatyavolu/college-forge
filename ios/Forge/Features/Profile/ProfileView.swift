import SwiftUI

/// The Profile tab: a progress overview on top, then everything on file. Editors push from here.
struct ProfileView: View {
    @Environment(Router.self) private var router

    var body: some View {
        @Bindable var router = router
        NavigationStack(path: $router.profilePath) {
            WorkspaceGate { ProfileHome() }
                .navigationTitle("Profile")
                .forgeScreenBackground()
                .navigationDestination(for: ProfileRoute.self) { ProfileDestination(route: $0) }
        }
    }
}

private struct ProfileDestination: View {
    let route: ProfileRoute

    var body: some View {
        switch route {
        case .about: IdentityEditorView(section: .about)
        case .academics: IdentityEditorView(section: .academics)
        case .apScores: APScoresView()
        case .coursework: CourseworkView()
        case .activities: ActivitiesView()
        case .honors: HonorsView()
        case .deadlines: DeadlinesView()
        case .readiness: ReadinessView()
        }
    }
}

/// The tab's root list.
private struct ProfileHome: View {
    @Environment(WorkspaceStore.self) private var store
    @State private var showSetup = false

    var body: some View {
        List {
            if let error = store.refreshError {
                ErrorBanner(message: error.message, retry: { Task { await store.refresh() } }, dismiss: { store.refreshError = nil })
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
            ProgressOverviewSections()
            ProfileSummarySections()
            Section {
                Button {
                    showSetup = true
                } label: {
                    Label("Redo setup", systemImage: "arrow.counterclockwise")
                }
            } footer: {
                Text("Go through the setup interview again with your AI. Your saved answers count as given, and your list, edits and drafts are kept.")
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await store.refresh() }
        .fullScreenCover(isPresented: $showSetup) {
            SetupChatView(canCancel: true)
        }
    }
}

#Preview {
    ProfileView().previewEnvironment()
}
