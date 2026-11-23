import SwiftUI

/// Add button plus a menu for portal checks, automatic checking and the import flows.
struct ApplicationsToolbar: ToolbarContent {
    @Binding var sheet: ApplicationsSheet?
    @Environment(WorkspaceStore.self) private var store
    @Environment(PortalCheckModel.self) private var checks
    @Environment(Router.self) private var router
    @State private var error: APIError?

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                let withLogin = store.applications.filter(\.hasSavedPassword)
                if !withLogin.isEmpty {
                    Button {
                        Task { await checks.check(withLogin, store: store) }
                    } label: {
                        Label(checks.isChecking ? "Checking portals…" : "Check portals now", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .disabled(checks.isChecking)
                }
                Section("Automatic checks") {
                    Toggle("Check every 12 hours", isOn: binding(\.autocheck, action: { .autocheck(on: $0) }))
                    Toggle("Email me when a portal changes", isOn: binding(\.emails, action: { .emails(on: $0) }))
                        .disabled(!store.tracker.autocheck)
                }
                Section {
                    Button { sheet = .importCollegeApps } label: { Label("Bring schools from College Apps", systemImage: "square.and.arrow.down") }
                    Button { sheet = .forwardEmails } label: { Label("Forward portal emails", systemImage: "envelope.arrow.triangle.branch") }
                    Button { router.applicationsPath.append(ApplicationsDestination.lettersAid) } label: {
                        Label("Letters & financial aid", systemImage: "envelope.open")
                    }
                }
            } label: {
                Label("More", systemImage: "ellipsis.circle")
            }
            .errorAlert($error)
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button { sheet = .add } label: { Label("Add a school", systemImage: "plus") }
        }
        if let progress = checks.progress {
            ToolbarItem(placement: .bottomBar) {
                HStack(spacing: Theme.Spacing.xs) {
                    ProgressView().controlSize(.small)
                    Text(progress).font(.footnote).foregroundStyle(Theme.muted)
                }
            }
        }
    }

    /// A toggle bound to a tracker setting that saves through the given action.
    private func binding(_ key: WritableKeyPath<TrackerView, Bool>, action: @escaping (Bool) -> ApplicationAction) -> Binding<Bool> {
        Binding {
            store.tracker[keyPath: key]
        } set: { on in
            Task {
                do {
                    try await store.perform(action(on)) { $0[keyPath: key] = on }
                    Haptics.selection()
                } catch {
                    self.error = APIError.wrap(error)
                }
            }
        }
    }
}
