import SwiftUI

/// Root of the Applications tab: every school by status or by date, decisions, and the add/import flows.
struct ApplicationsView: View {
    @Environment(Router.self) private var router
    @State private var checks = PortalCheckModel()

    var body: some View {
        @Bindable var router = router
        NavigationStack(path: $router.applicationsPath) {
            WorkspaceGate { ApplicationsHome() }
                .navigationTitle("Applications")
                .forgeScreenBackground()
                .navigationDestination(for: ApplicationRoute.self) { route in
                    ApplicationDetailView(id: route.id)
                }
                .navigationDestination(for: ApplicationsDestination.self) { destination in
                    switch destination {
                    case .lettersAid: LettersAidView()
                    case .decisionBoard: DecisionBoardView()
                    }
                }
        }
        .environment(checks)
        .applicationsToast($checks.notice)
        .errorAlert($checks.error, title: "Couldn't check portals")
    }
}

/// Screens inside the Applications tab other than one application.
enum ApplicationsDestination: Hashable {
    case lettersAid
    case decisionBoard
}

/// Which presentation of the list is showing.
enum ApplicationsMode: String, CaseIterable, Identifiable {
    case status, dates, decisions, list
    var id: String { rawValue }
    var title: String {
        switch self {
        case .status: "Status"
        case .dates: "Dates"
        case .decisions: "Decisions"
        case .list: "List"
        }
    }
}

/// Sheets the Applications screen can present.
enum ApplicationsSheet: String, Identifiable {
    case add, importCollegeApps, forwardEmails, masterLogin
    var id: String { rawValue }
}

private struct ApplicationsHome: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(Router.self) private var router
    @SceneStorage("applications.mode") private var mode: ApplicationsMode = .status
    @State private var sheet: ApplicationsSheet?

    var body: some View {
        Group {
            if store.applications.isEmpty {
                ApplicationsEmptyView(sheet: $sheet)
            } else {
                content
            }
        }
        .toolbar { ApplicationsToolbar(sheet: $sheet) }
        .sheet(item: $sheet) { sheet in
            switch sheet {
            case .add: AddSchoolSheet { id in router.applicationsPath.append(ApplicationRoute(id: id)) }
            case .importCollegeApps: ImportCollegeAppsSheet()
            case .forwardEmails: ForwardEmailsSheet()
            case .masterLogin: MasterLoginSheet()
            }
        }
    }

    @ViewBuilder private var content: some View {
        switch mode {
        case .status: ApplicationsStatusList(picker: picker, sheet: $sheet)
        case .dates: ApplicationsDatesList(picker: picker)
        case .decisions: DecisionsList(picker: picker)
        case .list: ApplicationsRankList(picker: picker)
        }
    }

    private var picker: ApplicationsModePicker {
        ApplicationsModePicker(mode: $mode, hiddenDecisions: store.applications.filter { $0.decision.state == .hidden }.count)
    }
}

/// Status / Dates / Decisions / List. Sits in the first list row so the large title stays visible.
struct ApplicationsModePicker: View {
    @Binding var mode: ApplicationsMode
    var hiddenDecisions = 0

    var body: some View {
        Picker("View", selection: $mode.animation(.snappy)) {
            ForEach(ApplicationsMode.allCases) { mode in
                Text(mode == .decisions && hiddenDecisions > 0 ? "\(mode.title) (\(hiddenDecisions))" : mode.title).tag(mode)
            }
        }
        .pickerStyle(.segmented)
        .sensoryFeedback(.selection, trigger: mode)
        .listRowInsets(EdgeInsets())
        .listRowBackground(Color.clear)
    }
}

private struct ApplicationsEmptyView: View {
    @Binding var sheet: ApplicationsSheet?
    @Environment(WorkspaceStore.self) private var store

    var body: some View {
        ScrollView {
            ContentUnavailableView {
                Label {
                    Text("No applications yet").font(.forgeDisplay(.title2))
                } icon: {
                    Image(systemName: "tray").foregroundStyle(Theme.accent)
                }
            } description: {
                Text("Add each school you apply to and save its portal login. Forge checks the portal on your schedule and tells you what changed.")
                    .foregroundStyle(Theme.muted)
            } actions: {
                VStack(spacing: Theme.Spacing.sm) {
                    Button("Add a school") { sheet = .add }
                        .buttonStyle(.forgePrimary)
                    Button("Bring schools from College Apps") { sheet = .importCollegeApps }
                        .buttonStyle(.forgeSecondary)
                    Button("Forward a portal setup email") { sheet = .forwardEmails }
                        .font(.subheadline.weight(.medium))
                        .padding(.top, Theme.Spacing.xxs)
                }
                .fixedSize(horizontal: true, vertical: false)
            }
            .padding(.top, Theme.Spacing.xl)
        }
        .refreshable { await store.refresh() }
    }
}

#Preview {
    ApplicationsView().previewEnvironment()
}
