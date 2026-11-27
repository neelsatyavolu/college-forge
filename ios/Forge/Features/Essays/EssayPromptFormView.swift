import SwiftUI

/// Sheet for adding a prompt or editing one. Editing keeps the draft.
struct EssayPromptFormView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State var draft: EssayPromptDraft
    let groups: [EssayGroup]
    /// Called with the saved essay's id.
    var onSaved: (String) -> Void = { _ in }

    @State private var saving = false
    @State private var error: APIError?
    @FocusState private var focus: Field?

    private enum Field { case title, prompt, limit }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Application", selection: $draft.groupKey) {
                        ForEach(groups) { Text($0.title).tag($0.key) }
                    }
                    .disabled(draft.isEditing)
                } footer: {
                    Text("Copy the exact prompt and limit from the current application.")
                }

                Section("Title") {
                    TextField("e.g. Why this school", text: $draft.label)
                        .focused($focus, equals: .title)
                        .submitLabel(.next)
                        .onSubmit { focus = .prompt }
                        .onChange(of: draft.label) { _, new in
                            if new.count > EssayPromptDraft.maxTitleLength {
                                draft.label = String(new.prefix(EssayPromptDraft.maxTitleLength))
                            }
                        }
                }

                Section("Prompt") {
                    TextField("Paste the prompt", text: $draft.prompt, axis: .vertical)
                        .lineLimit(3...12)
                        .focused($focus, equals: .prompt)
                }

                Section {
                    LabeledContent("Limit") {
                        TextField("Limit", value: $draft.limit, format: .number)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                            .font(.forgeNumber())
                            .focused($focus, equals: .limit)
                    }
                    Picker("Count", selection: $draft.unit) {
                        Text("Words").tag("words")
                        Text("Characters").tag("characters")
                    }
                } footer: {
                    if !EssayPromptDraft.limitRange.contains(draft.limit) {
                        Text("Limit must be between 1 and 50,000.").foregroundStyle(Theme.danger)
                    } else if draft.isEditing {
                        Text("Editing a prompt keeps your draft.")
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.canvas)
            .navigationTitle(draft.isEditing ? "Edit prompt" : "Add prompt")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .interactiveDismissDisabled(saving)
            .errorAlert($error, title: "Couldn't save the prompt")
            .onAppear { if !draft.isEditing { focus = .title } }
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button("Cancel") { dismiss() }.disabled(saving)
        }
        ToolbarItem(placement: .confirmationAction) {
            if saving {
                ProgressView()
            } else {
                Button("Save", action: save).disabled(!draft.isValid)
            }
        }
    }

    private func save() {
        guard draft.isValid, let group = groups.first(where: { $0.key == draft.groupKey }) else { return }
        saving = true
        Task {
            defer { saving = false }
            do {
                let id = try await store.saveEssayPrompt(draft, currentItems: store.savedEssayPrompts(in: group.key))
                Haptics.success()
                dismiss()
                onSaved(id)
            } catch {
                self.error = APIError.wrap(error)
                Haptics.error()
            }
        }
    }
}

#Preview {
    EssayPromptFormView(
        draft: .new(in: EssayCatalog.commonKey),
        groups: EssayCatalog.groups(colleges: PreviewData.workspace.colleges, essays: PreviewData.workspace.essays)
    )
    .previewEnvironment()
}
