import SwiftUI

/// Things to chase for one school. Tap the circle to mark one done; swipe to delete.
struct FollowUpsSection: View {
    let app: TrackedApplication
    @Environment(WorkspaceStore.self) private var store
    @State private var adding = false
    @State private var error: APIError?

    var body: some View {
        Section {
            if app.followUps.isEmpty {
                Text("Nothing left to chase for this school.").foregroundStyle(Theme.muted)
            }
            ForEach(app.followUps) { followUp in
                FollowUpRow(followUp: followUp) { markDone(followUp) }
                    .swipeActions {
                        Button(role: .destructive) { delete(followUp) } label: { Label("Delete", systemImage: "trash") }
                        Button { markDone(followUp) } label: { Label("Done", systemImage: "checkmark") }
                            .tint(Theme.success)
                    }
            }
            Button { adding = true } label: { Label("Add a follow-up", systemImage: "plus") }
        } header: {
            Text("Follow-ups")
        }
        .sheet(isPresented: $adding) { AddFollowUpSheet(app: app) }
        .errorAlert($error)
    }

    private func markDone(_ followUp: FollowUp) {
        Task {
            do {
                try await store.setFollowUp(followUp.id, done: true, inApplication: app.id)
                Haptics.success()
            } catch {
                self.error = APIError.wrap(error)
            }
        }
    }

    private func delete(_ followUp: FollowUp) {
        let id = app.id
        Task {
            do {
                try await store.perform(.followUpSet(id: id, followUpId: followUp.id, remove: true)) { tracker in
                    guard let i = tracker.apps.firstIndex(where: { $0.id == id }) else { return }
                    tracker.apps[i].followUps.removeAll { $0.id == followUp.id }
                }
            } catch {
                self.error = APIError.wrap(error)
            }
        }
    }
}

private struct FollowUpRow: View {
    let followUp: FollowUp
    let done: () -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
            Button(action: done) {
                Image(systemName: "circle").font(.title3).foregroundStyle(Theme.accent)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Mark done")
            VStack(alignment: .leading, spacing: 2) {
                Text(followUp.text).foregroundStyle(Theme.ink)
                if !followUp.due.isEmpty {
                    let overdue = (ForgeDates.daysUntil(followUp.due) ?? 0) < 0
                    Text("Due \(ForgeDates.short(followUp.due)), \(ForgeDates.relative(followUp.due))")
                        .font(.footnote)
                        .foregroundStyle(overdue ? Theme.danger : Theme.muted)
                }
            }
        }
    }
}

private struct AddFollowUpSheet: View {
    let app: TrackedApplication
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var due: String = ""
    @State private var saving = false
    @State private var error: APIError?
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Counselor sends the mid-year report", text: $text, axis: .vertical)
                        .focused($focused)
                        .lineLimit(1...4)
                } footer: {
                    Text("These also show on your Progress page.")
                }
                OptionalDateRow(title: "Due", date: $due)
            }
            .navigationTitle("Add a follow-up")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add", action: save)
                        .disabled(saving || !ApplicationsValidation.canAddFollowUp(text))
                }
            }
            .onAppear { focused = true }
            .errorAlert($error)
        }
        .presentationDetents([.medium, .large])
    }

    private func save() {
        saving = true
        Task {
            defer { saving = false }
            do {
                try await store.perform(.followUpAdd(id: app.id, text: ApplicationsValidation.trimmed(text), due: due.isEmpty ? nil : due))
                Haptics.success()
                dismiss()
            } catch {
                self.error = APIError.wrap(error)
            }
        }
    }
}
