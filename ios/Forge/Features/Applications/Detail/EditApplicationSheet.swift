import SwiftUI

/// Edits the fields the web's details form has: round, dates, portal link, notes (and the name).
struct EditApplicationSheet: View {
    let app: TrackedApplication
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var draft: ApplicationDraft
    @State private var saving = false
    @State private var error: APIError?

    init(app: TrackedApplication) {
        self.app = app
        _draft = State(initialValue: ApplicationDraft(app))
    }

    private var edit: ApplicationEdit? { draft.edit(from: app) }

    var body: some View {
        NavigationStack {
            Form {
                Section("School") {
                    TextField("Name", text: $draft.name)
                        .textInputAutocapitalization(.words)
                }
                Section("Round and dates") {
                    Picker("Round", selection: $draft.round) {
                        ForEach(ApplicationRound.all) { round in
                            Text(round == .none && app.roundFromPortal ? "From portal (\(app.round.short))" : round.label).tag(round)
                        }
                    }
                    OptionalDateRow(title: "Deadline", date: $draft.deadline)
                    OptionalDateRow(title: "Submitted", date: $draft.submittedAt)
                    OptionalDateRow(title: "Decision date", date: $draft.decisionDate, hint: estimateHint)
                }
                Section {
                    TextField("https://", text: $draft.portalUrl)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("Portal link")
                }
                Section {
                    TextField("Interview notes, what to send, anything else", text: $draft.notes, axis: .vertical)
                        .lineLimit(4...12)
                } header: {
                    Text("Notes")
                } footer: {
                    if draft.notes.count > ApplicationDraft.notesLimit - 200 {
                        Text("\(draft.notes.count) of \(ApplicationDraft.notesLimit) characters")
                            .foregroundStyle(draft.notes.count > ApplicationDraft.notesLimit ? Theme.danger : Theme.muted)
                    }
                }
                Section("Decision note") {
                    DecisionNoteField(school: app.name, text: $draft.decisionNote)
                }
                if let message = draft.validationError, edit != nil {
                    Section { Text(message).foregroundStyle(Theme.danger) }
                }
            }
            .navigationTitle("Edit \(app.name)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button("Save", action: save).disabled(edit == nil || draft.validationError != nil)
                    }
                }
            }
            .interactiveDismissDisabled(edit != nil)
            .errorAlert($error)
        }
    }

    private var estimateHint: String? {
        guard let date = app.decisionDate, date.estimated else { return nil }
        return "Last year: \(ForgeDates.short(date.date))"
    }

    private func save() {
        guard let edit else { return dismiss() }
        saving = true
        Task {
            defer { saving = false }
            do {
                try await store.updateApplication(id: app.id, edit)
                Haptics.success()
                dismiss()
            } catch {
                self.error = APIError.wrap(error)
                Haptics.error()
            }
        }
    }
}
