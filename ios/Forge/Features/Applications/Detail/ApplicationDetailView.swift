import SwiftUI

/// One application: status, decision, what the portal says, dates, follow-ups, portal login.
/// Also the target of push taps and collegeforge://application/<id> links.
struct ApplicationDetailView: View {
    let id: String
    @Environment(WorkspaceStore.self) private var store
    @State private var lookedUp = false

    var body: some View {
        Group {
            if let app = store.application(id: id) {
                ApplicationDetailContent(app: app)
            } else if !store.hasLoaded || !lookedUp {
                LoadingView()
            } else {
                EmptyStateView(systemImage: "questionmark.folder", title: "Not found", message: "This application may have been removed.")
            }
        }
        .forgeScreenBackground()
        .task(id: id) {
            // A push can name a school added since the last load.
            if store.application(id: id) == nil {
                await store.loadIfNeeded()
                if store.application(id: id) == nil { await store.refreshApplications() }
            }
            lookedUp = true
        }
    }
}

private struct ApplicationDetailContent: View {
    let app: TrackedApplication
    @Environment(WorkspaceStore.self) private var store
    @Environment(Router.self) private var router
    @State private var editing = false
    @State private var confirmRemove = false
    @State private var justRevealed: Set<String> = []
    @State private var error: APIError?

    var body: some View {
        List {
            Section { ApplicationDetailHeader(app: app) }
            if app.decision.state != .none {
                Section("Decision") { DecisionPanel(app: app, justRevealed: $justRevealed) }
            }
            PortalStatusSection(app: app)
            datesSection
            TestingPlanSection(app: app)
            if !app.notes.isEmpty {
                Section("Notes") {
                    Text(app.notes).foregroundStyle(Theme.body).textSelection(.enabled)
                }
            }
            FollowUpsSection(app: app)
            InterestLogSection(app: app)
            PortalLoginSection(app: app)
            Section {
                Button("Remove \(app.name)", role: .destructive) { confirmRemove = true }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(app.name)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await store.refreshApplications() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Edit") { editing = true }
            }
        }
        .sheet(isPresented: $editing) { EditApplicationSheet(app: app) }
        .confirmationDialog("Remove \(app.name)?", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Remove", role: .destructive, action: remove)
            Button("Keep it", role: .cancel) {}
        } message: {
            Text("This removes the school and its saved login.")
        }
        .errorAlert($error)
    }

    private var datesSection: some View {
        Section {
            LabeledValueRow(label: "Round", value: app.round == .none ? "" : app.round.label + (app.roundFromPortal ? " (portal)" : ""), systemImage: "flag")
            LabeledValueRow(label: "Deadline", value: dateText(app.deadline), systemImage: "calendar")
            LabeledValueRow(label: "Submitted", value: ForgeDates.short(app.submittedAt), systemImage: "paperplane")
            LabeledValueRow(label: "Decision", value: decisionDateText, systemImage: "envelope")
        } header: {
            Text("Dates")
        } footer: {
            if app.decisionDate?.estimated == true {
                Text("Decision date estimated from last year's release.")
            }
        }
    }

    private var decisionDateText: String {
        guard let date = app.decisionDate, !date.date.isEmpty else { return "" }
        return date.estimated ? "~\(ForgeDates.short(date.date))" : dateText(date.date)
    }

    private func dateText(_ iso: String) -> String {
        guard !iso.isEmpty else { return "" }
        let relative = ForgeDates.relative(iso)
        return relative.isEmpty ? ForgeDates.short(iso) : "\(ForgeDates.short(iso)), \(relative)"
    }

    private func remove() {
        Task {
            do {
                try await store.removeApplication(id: app.id)
                Haptics.success()
                router.popToRoot(.applications)
            } catch {
                self.error = APIError.wrap(error)
                Haptics.error()
            }
        }
    }
}

/// Logo, name, round and portal, with the status picker.
private struct ApplicationDetailHeader: View {
    let app: TrackedApplication
    @Environment(WorkspaceStore.self) private var store
    @State private var error: APIError?

    var body: some View {
        HStack(alignment: .center, spacing: Theme.Spacing.md) {
            SchoolLogo(name: app.name, path: app.logo, config: store.config, size: 56)
            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Text(app.name)
                    .font(.forgeDisplay(.title2))
                    .foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(app.portalName).font(.subheadline).foregroundStyle(Theme.muted)
                statusMenu.padding(.top, 2)
            }
        }
        .padding(.vertical, Theme.Spacing.xxs)
        .errorAlert($error)
    }

    private var statusMenu: some View {
        Menu {
            Picker("Status", selection: Binding(get: { app.status }, set: setStatus)) {
                ForEach(AppStatus.all) { Label($0.label, systemImage: $0.systemImage).tag($0) }
            }
        } label: {
            HStack(spacing: 4) {
                StatusBadge(status: app.status)
                Image(systemName: "chevron.up.chevron.down").font(.caption2.weight(.semibold)).foregroundStyle(Theme.muted)
            }
        }
        .accessibilityLabel("Status: \(app.status.label). Change status")
    }

    private func setStatus(_ status: AppStatus) {
        guard status != app.status else { return }
        Task {
            do {
                try await store.setStatus(status, forApplication: app.id)
                Haptics.success()
            } catch {
                self.error = APIError.wrap(error)
                Haptics.error()
            }
        }
    }
}

#Preview {
    NavigationStack { ApplicationDetailView(id: "a1") }
        .environment(PortalCheckModel())
        .previewEnvironment()
}
