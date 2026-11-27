import SwiftUI

/// Needs attention, next up, follow-ups and the folded "waiting to hear" list.
struct ApplicationGroupsSections: View {
    @Environment(WorkspaceStore.self) private var store
    let summary: ProgressSummary
    @State private var showAllNext = false
    @State private var showWaiting = false
    @State private var error: APIError?

    private let nextLimit = 5

    var body: some View {
        if !summary.attention.isEmpty {
            Section("Needs attention") {
                ForEach(summary.attention) { ProgressAppRow(app: $0, showsAttention: true) }
            }
        }

        Section {
            if summary.nextUp.isEmpty {
                Text("Every application is in. Decisions and follow-ups show up here as they come.")
                    .foregroundStyle(Theme.muted)
            } else {
                ForEach(showAllNext ? summary.nextUp : Array(summary.nextUp.prefix(nextLimit))) { ProgressAppRow(app: $0) }
                if summary.nextUp.count > nextLimit {
                    Button(showAllNext ? "Show fewer" : "Show all \(summary.nextUp.count)") {
                        withAnimation { showAllNext.toggle() }
                    }
                }
            }
        } header: {
            Text("Next up")
        }

        if !summary.followUps.isEmpty {
            Section("Follow-ups") {
                ForEach(summary.followUps) { FollowUpRow(item: $0, error: $error) }
            }
            .errorAlert($error)
        }

        if !summary.waiting.isEmpty {
            Section {
                DisclosureGroup(isExpanded: $showWaiting) {
                    ForEach(summary.waiting) { ProgressAppRow(app: $0) }
                } label: {
                    Text("Waiting to hear · \(summary.waiting.count)").foregroundStyle(Theme.ink)
                }
            }
        }
    }
}

/// One application: logo, name, round and the date that matters. Tap opens it on Applications.
struct ProgressAppRow: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(Router.self) private var router
    let app: TrackedApplication
    var showsAttention = false
    @State private var error: APIError?

    var body: some View {
        Button {
            router.openApplication(id: app.id)
        } label: {
            ForgeRow(title: app.name, subtitle: subtitle) {
                SchoolLogo(name: app.name, path: app.logo, config: store.config, size: 36)
            } trailing: {
                StatusBadge(status: app.status)
            }
        }
        .tint(Theme.ink)
        .contextMenu {
            Picker("Status", selection: statusBinding) {
                ForEach(AppStatus.all) { Text($0.label).tag($0) }
            }
            .pickerStyle(.menu)
        }
        .errorAlert($error)
    }

    private var subtitle: String {
        let when = ProgressWhen.text(for: app).text
        var parts = [app.round == .none ? nil : app.round.short, when.isEmpty ? nil : when]
        if showsAttention {
            let reasons = ProgressAttention.reasons(for: app).map { $0.text(for: app) }
            let followUps = app.followUps.isEmpty ? [] : ["\(app.followUps.count) follow-up\(app.followUps.count == 1 ? "" : "s")"]
            parts.append((reasons + followUps).joined(separator: ", "))
        }
        // The chance estimate shows beside any alert rather than being hidden by it.
        parts.append(CollegesOdds.forApp(app, in: store.workspace).map(CollegesOdds.chanceText))
        return parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private var statusBinding: Binding<AppStatus> {
        Binding(get: { app.status }, set: { status in
            Task {
                do { try await store.setStatus(status, forApplication: app.id); Haptics.success() }
                catch { self.error = APIError.wrap(error); Haptics.error() }
            }
        })
    }
}

/// A follow-up with a checkbox. Checking it marks it done.
private struct FollowUpRow: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(Router.self) private var router
    let item: ProgressFollowUp
    @Binding var error: APIError?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
            Button {
                markDone()
            } label: {
                Image(systemName: "circle")
                    .font(.title3)
                    .foregroundStyle(Theme.accent)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Mark done: \(item.followUp.text)")

            VStack(alignment: .leading, spacing: 2) {
                Text(item.followUp.text).foregroundStyle(Theme.ink)
                Text(item.appName).font(.footnote).foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .onTapGesture { router.openApplication(id: item.appID) }

            Text(item.followUp.due.isEmpty ? "No date" : ForgeDates.short(item.followUp.due))
                .font(.forgeNumber(.footnote))
                .foregroundStyle(isLate ? Theme.danger : Theme.muted)
        }
        .swipeActions {
            Button("Done", systemImage: "checkmark") { markDone() }.tint(Theme.success)
        }
    }

    private var isLate: Bool {
        (ForgeDates.daysUntil(item.followUp.due) ?? 0) < 0
    }

    private func markDone() {
        Task {
            do { try await store.setFollowUp(item.followUp.id, done: true, inApplication: item.appID); Haptics.success() }
            catch { self.error = APIError.wrap(error); Haptics.error() }
        }
    }
}
