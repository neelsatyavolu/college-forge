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
            // Missing items show once, here: first in the checklist, which opens when anything is missing.
            if !checklistRows.isEmpty {
                DisclosureGroup(checklistTitle, isExpanded: checklistOpen) {
                    ForEach(Array(checklistRows.enumerated()), id: \.offset) { _, row in
                        PortalChecklistRow(item: row.item, missing: row.missing)
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

    /// The student's own open/closed choice; nil until they tap, so it opens when something is missing.
    @State private var checklistExpanded: Bool?

    private var checklistOpen: Binding<Bool> {
        Binding(get: { checklistExpanded ?? !app.missing.isEmpty }, set: { checklistExpanded = $0 })
    }

    private var checklistRows: [PortalChecklistOrder.Row] {
        PortalChecklistOrder.rows(checklist: app.portal?.checklist ?? [], missing: app.missing, decisionHidden: app.decision.state == .hidden)
    }

    private var checklistTitle: String {
        if app.decision.state == .hidden { return "Missing (\(app.missing.count))" }
        let checklist = app.portal?.checklist ?? []
        let received = "\(checklist.filter(\.done).count) of \(checklist.count) received"
        return app.missing.isEmpty ? "Checklist (\(received))" : "Checklist (\(app.missing.count) missing · \(received))"
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

/// Orders the portal checklist for the detail screen: missing items first, in portal order, then the rest.
enum PortalChecklistOrder {
    struct Row: Hashable {
        let item: PortalItem
        let missing: Bool
    }

    /// While a decision is unopened the server sends no checklist (it could give the decision away), only the
    /// safe missing names, so those become name-only rows.
    static func rows(checklist: [PortalItem], missing: [String], decisionHidden: Bool) -> [Row] {
        if decisionHidden {
            return missing.map { Row(item: PortalItem(item: $0, status: "", date: "", done: false, optional: false), missing: true) }
        }
        let missingNames = Set(missing)
        let rows = checklist.map { Row(item: $0, missing: !$0.done && !$0.optional && missingNames.contains($0.item)) }
        return rows.filter(\.missing) + rows.filter { !$0.missing }
    }
}

private struct PortalChecklistRow: View {
    let item: PortalItem
    var missing = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
            Image(systemName: item.done ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(item.done ? Theme.success : (item.optional ? Theme.mutedSoft : Theme.amber))
            VStack(alignment: .leading, spacing: 1) {
                Text(item.item).foregroundStyle(Theme.ink)
                let detail = [item.status, ForgeDates.short(item.date), item.optional ? "Optional" : ""].filter { !$0.isEmpty }
                if missing {
                    // "Missing" sits under the name rather than in a trailing badge, so long names wrap freely.
                    Text(detail.isEmpty ? "Missing" : "Missing · \(detail.joined(separator: " · "))")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(Theme.amber)
                } else if !detail.isEmpty {
                    Text(detail.joined(separator: " · ")).font(.footnote).foregroundStyle(Theme.muted)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}
