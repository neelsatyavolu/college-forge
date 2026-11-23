import SwiftUI

/// What the portal said at the last check, its checklist, and "Check now".
/// While a decision is unopened the portal's own words are left out; they could give it away.
struct PortalStatusSection: View {
    let app: TrackedApplication
    @Environment(WorkspaceStore.self) private var store
    @Environment(PortalCheckModel.self) private var checks

    var body: some View {
        Section {
            summary
            if let failure = app.lastFailure, app.portal?.ok != false {
                Label("Latest check didn't finish: \(failure.error) (\(ForgeDates.ago(milliseconds: failure.at))). Showing the last good check.", systemImage: "exclamationmark.triangle")
                    .font(.subheadline)
                    .foregroundStyle(Theme.danger)
            }
            if !app.missing.isEmpty {
                ForEach(app.missing, id: \.self) { item in
                    Label(item, systemImage: "doc.badge.ellipsis")
                        .foregroundStyle(Theme.ink)
                        .badge(Text("Missing").foregroundStyle(Theme.amber))
                }
            }
            if let checklist = visibleChecklist, !checklist.isEmpty {
                DisclosureGroup("Checklist (\(checklist.filter(\.done).count) of \(checklist.count) received)") {
                    ForEach(Array(checklist.enumerated()), id: \.offset) { _, item in
                        PortalChecklistRow(item: item)
                    }
                }
            }
            if app.hasSavedPassword {
                Button {
                    Task { await checks.check([app], store: store) }
                } label: {
                    HStack {
                        Label(checks.isChecking(app.id) ? "Checking portal…" : "Check now", systemImage: "arrow.triangle.2.circlepath")
                        if checks.isChecking(app.id) { Spacer(); ProgressView() }
                    }
                }
                .disabled(checks.isChecking(app.id))
            }
            if let url = URL(string: app.portalUrl), ApplicationDraft.isHTTPS(app.portalUrl) {
                Link(destination: url) {
                    Label("Open \(app.portalName)", systemImage: "arrow.up.right.square")
                }
            }
        } header: {
            Text("Portal")
        } footer: {
            if app.hasSavedPassword {
                Text("Forge signs in to check this portal every 12 hours when automatic checks are on.")
            }
        }
    }

    /// The checklist, hidden while a decision is unopened.
    private var visibleChecklist: [PortalItem]? {
        app.decision.state == .hidden ? nil : app.portal?.checklist
    }

    @ViewBuilder private var summary: some View {
        if app.decision.state == .hidden {
            // The Decision section above covers it; the portal's words could give it away.
            EmptyView()
        } else if let portal = app.portal {
            if portal.ok {
                VStack(alignment: .leading, spacing: 2) {
                    if !portal.statusText.isEmpty {
                        Text("“\(portal.statusText)”").font(.body.weight(.medium)).foregroundStyle(Theme.ink)
                    }
                    if !portal.update.isEmpty {
                        Text(portal.update).font(.subheadline).foregroundStyle(Theme.body)
                    }
                    Text("Checked \(ForgeDates.ago(milliseconds: portal.checkedAt))").font(.footnote).foregroundStyle(Theme.muted)
                }
            } else {
                Label("\(portal.error) · tried \(ForgeDates.ago(milliseconds: portal.checkedAt))", systemImage: "exclamationmark.triangle")
                    .foregroundStyle(Theme.danger)
            }
        } else if app.login != nil {
            Text("Login saved. The next check fills this in.").foregroundStyle(Theme.muted)
        } else {
            Text("Save the portal login below and Forge will check it for you.").foregroundStyle(Theme.muted)
        }
    }
}

private struct PortalChecklistRow: View {
    let item: PortalItem

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
            Image(systemName: item.done ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(item.done ? Theme.success : (item.optional ? Theme.mutedSoft : Theme.amber))
            VStack(alignment: .leading, spacing: 1) {
                Text(item.item).foregroundStyle(Theme.ink)
                let detail = [item.status, ForgeDates.short(item.date), item.optional ? "Optional" : ""].filter { !$0.isEmpty }
                if !detail.isEmpty {
                    Text(detail.joined(separator: " · ")).font(.footnote).foregroundStyle(Theme.muted)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}
