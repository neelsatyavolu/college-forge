import SwiftUI

/// One school in a list, with swipe actions (status, check, remove) and a context menu.
struct ApplicationListRow: View {
    let app: TrackedApplication
    /// Show the portal's words and missing documents (rows in "Needs attention").
    var expanded = false

    @Environment(WorkspaceStore.self) private var store
    @Environment(PortalCheckModel.self) private var checks
    @State private var confirmRemove = false
    @State private var choosingStatus = false
    @State private var error: APIError?

    var body: some View {
        NavigationLink(value: ApplicationRoute(id: app.id)) {
            ApplicationRowContent(app: app, expanded: expanded, checking: checks.isChecking(app.id))
        }
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            if let next = quickStatus {
                Button { setStatus(next) } label: { Label(next.label, systemImage: next.systemImage) }
                    .tint(next.tone)
            }
            Button { choosingStatus = true } label: { Label("Status", systemImage: "list.bullet") }
                .tint(Theme.accent)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(role: .destructive) { confirmRemove = true } label: { Label("Remove", systemImage: "trash") }
            if app.hasSavedPassword {
                Button { Task { await checks.check([app], store: store) } } label: {
                    Label("Check", systemImage: "arrow.triangle.2.circlepath")
                }
                .tint(Theme.teal)
                .disabled(checks.isChecking(app.id))
            }
        }
        .contextMenu {
            Picker("Status", selection: Binding(get: { app.status }, set: setStatus)) {
                ForEach(AppStatus.all) { Label($0.label, systemImage: $0.systemImage).tag($0) }
            }
            .pickerStyle(.menu)
            if app.hasSavedPassword {
                Button { Task { await checks.check([app], store: store) } } label: {
                    Label("Check portal now", systemImage: "arrow.triangle.2.circlepath")
                }
            }
            if let url = URL(string: app.portalUrl), ApplicationDraft.isHTTPS(app.portalUrl) {
                Link(destination: url) { Label("Open \(app.portalName)", systemImage: "arrow.up.right.square") }
            }
            Divider()
            Button(role: .destructive) { confirmRemove = true } label: { Label("Remove", systemImage: "trash") }
        }
        .confirmationDialog("Status for \(app.name)", isPresented: $choosingStatus, titleVisibility: .visible) {
            ForEach(AppStatus.all.filter { $0 != app.status }) { status in
                Button(status.label) { setStatus(status) }
            }
        }
        .confirmationDialog("Remove \(app.name)?", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Remove", role: .destructive, action: remove)
            Button("Keep it", role: .cancel) {}
        } message: {
            Text("This removes the school and its saved login.")
        }
        .errorAlert($error)
    }

    /// The obvious next step for a full swipe: mark a school you're working on as submitted.
    private var quickStatus: AppStatus? {
        app.stage == .working ? .submitted : nil
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

    private func remove() {
        Task {
            do {
                try await store.removeApplication(id: app.id)
                Haptics.success()
            } catch {
                self.error = APIError.wrap(error)
                Haptics.error()
            }
        }
    }
}

/// The visual content of a row, shared by the status and decisions lists.
struct ApplicationRowContent: View {
    let app: TrackedApplication
    var expanded = false
    var checking = false
    @Environment(WorkspaceStore.self) private var store

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.sm) {
            SchoolLogo(name: app.name, path: app.logo, config: store.config, size: 40)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text(app.name)
                        .font(.body.weight(.medium))
                        .foregroundStyle(Theme.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    StatusBadge(status: app.status)
                }
                ApplicationMetaLine(app: app)
                PortalSummaryLine(app: app, expanded: expanded, checking: checking)
            }
            // Rows grow to fit wrapped text instead of truncating it on narrow phones.
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// "ED · Deadline Nov 1 · in 5 days"
struct ApplicationMetaLine: View {
    let app: TrackedApplication

    var body: some View {
        let parts = segments
        if !parts.isEmpty {
            Text(parts.joined(separator: " · "))
                .font(.subheadline)
                .foregroundStyle(isSoon ? Theme.coral : Theme.muted)
                .fontWeight(isSoon ? .medium : .regular)
        }
    }

    private var isSoon: Bool {
        guard let next = app.nextDate, let days = ForgeDates.daysUntil(next.date) else { return false }
        return days <= 7
    }

    private var segments: [String] {
        var out: [String] = []
        if app.round != .none { out.append(app.round.short + (app.roundFromPortal ? " (portal)" : "")) }
        if let next = app.nextDate {
            // "~" marks an estimate, as on the detail screen; it can't wrap onto its own line.
            if next.estimated {
                out.append("\(next.kind) ~\(ForgeDates.short(next.date))")
            } else {
                out.append("\(next.kind) \(ForgeDates.short(next.date))")
                out.append(ForgeDates.relative(next.date))
            }
        } else if !app.deadline.isEmpty, app.stage == .working {
            out.append("Deadline \(ForgeDates.short(app.deadline)) passed")
        }
        return out
    }
}

/// What the portal last said. A posted decision replaces the portal's words, which could give it away.
struct PortalSummaryLine: View {
    let app: TrackedApplication
    var expanded = false
    var checking = false

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            if checking {
                Label("Checking portal…", systemImage: "arrow.triangle.2.circlepath")
                    .foregroundStyle(Theme.teal)
                    .symbolEffect(.rotate, isActive: true)
            } else if app.decision.state == .hidden {
                Label("Decision posted. Open it when you're ready.", systemImage: "envelope.badge")
                    .foregroundStyle(Theme.coral)
                    .fontWeight(.medium)
            } else if let portal = app.portal {
                if !portal.ok {
                    Label("\(portal.error) · tried \(ForgeDates.ago(milliseconds: portal.checkedAt))", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(Theme.danger)
                } else if expanded || !portal.statusText.isEmpty {
                    Text(portal.statusText.isEmpty ? "Checked \(ForgeDates.ago(milliseconds: portal.checkedAt))" : "“\(portal.statusText)” · \(ForgeDates.ago(milliseconds: portal.checkedAt))")
                        .foregroundStyle(Theme.body)
                        .lineLimit(expanded ? 3 : 1)
                }
            } else if app.login != nil {
                Text("Login saved. The next check fills this in.").foregroundStyle(Theme.muted)
            }
            if !checking, let failure = app.lastFailure, app.portal?.ok != false {
                Label("Latest check didn't finish: \(failure.error)", systemImage: "exclamationmark.triangle")
                    .foregroundStyle(Theme.danger)
                    .lineLimit(expanded ? 3 : 1)
            }
            if !app.missing.isEmpty, app.stage == .working || app.stage == .waiting {
                Label(expanded ? "Missing: " + app.missing.joined(separator: ", ") : "\(app.missing.count) missing", systemImage: "doc.badge.ellipsis")
                    .foregroundStyle(Theme.amber)
                    .lineLimit(expanded ? 4 : 1)
            }
        }
        .font(.footnote)
    }
}

#Preview {
    List {
        ApplicationListRow(app: PreviewData.tracker.apps[0], expanded: true)
        ApplicationListRow(app: PreviewData.tracker.apps[1])
    }
    .environment(PortalCheckModel())
    .previewEnvironment()
}
