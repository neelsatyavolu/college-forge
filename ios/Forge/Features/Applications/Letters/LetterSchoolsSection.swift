import SwiftUI

/// The schools a recommender's letter goes to, picked from tracked applications, each with whether
/// its portal shows the letter received (public/hub/LettersPanel.jsx).
struct LetterSchoolsSection: View {
    @Binding var letter: Recommendation
    @Environment(WorkspaceStore.self) private var store

    var body: some View {
        let apps = store.applications
        let assigned = Set(letter.schools ?? [])
        let receipts = Dictionary(uniqueKeysWithValues: LetterReceipts
            .receipts(for: letter, apps: apps, others: store.workspace.recommendations)
            .map { ($0.appId, $0) })
        Section {
            if apps.isEmpty {
                Text("Add schools on Progress to assign this letter to them.").foregroundStyle(Theme.muted)
            }
            ForEach(apps) { app in
                Button { toggle(app.id) } label: {
                    HStack {
                        Image(systemName: assigned.contains(app.id) ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(assigned.contains(app.id) ? Theme.teal : Theme.mutedSoft)
                        Text(app.name).foregroundStyle(Theme.ink)
                        Spacer()
                        if let r = receipts[app.id] { ReceiptLabel(receipt: r) }
                    }
                }
                .accessibilityAddTraits(assigned.contains(app.id) ? .isSelected : [])
            }
        } header: {
            Text("Sends to")
        } footer: {
            if !apps.isEmpty { Text("Received and missing come from each school's last portal check.") }
        }
    }

    private func toggle(_ id: String) {
        var ids = letter.schools ?? []
        if let i = ids.firstIndex(of: id) { ids.remove(at: i) } else { ids.append(id) }
        letter.schools = ids
    }
}

/// "Received", "Missing" or "No portal data", with a count when letters were matched by type.
struct ReceiptLabel: View {
    let receipt: LetterReceipts.Receipt

    var body: some View {
        let (text, tone): (String, Color) = switch receipt.state {
        case .received: ("Received", Theme.success)
        case .missing: ("Missing", Theme.amber)
        case .unclear: ("\(receipt.done) of \(receipt.total) in, unnamed", Theme.muted)
        case .noPortalData: ("No portal data", Theme.mutedSoft)
        }
        Text(text).font(.caption).foregroundStyle(tone)
    }
}
