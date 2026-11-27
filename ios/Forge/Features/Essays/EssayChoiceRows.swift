import SwiftUI

/// Choosing what to answer: which N prompts of a set (UC: 4 of 8), which college a school's prompts are for,
/// and which option of a choose-one prompt. Mirrors public/hub/EssayChoice.jsx.
extension WorkspaceStore {
    /// Hides (`true`) or shows (`nil`) essays by id, optimistically, in one PATCH.
    func setEssayHidden(_ changes: [String: Bool?]) async throws {
        guard !changes.isEmpty else { return }
        try await patch(.with { $0.essayHidden = changes }) { ws in
            for (id, hide) in changes { ws.essayHidden[id] = hide == true ? true : nil }
        }
    }

    /// Saves which option (0-based) of a choose-one prompt the student answers; `nil` clears it.
    func setEssayOption(id: String, option: Int?) async throws {
        try await patch(.with { $0.essayOption = [id: option] }) { ws in ws.essayOption[id] = option }
    }
}

/// "Applying to [college]" for schools whose prompts depend on the college or program (Cornell, Tufts), or an
/// opt-in toggle for a single program beside prompts for everyone (an honors college).
struct EssayAudienceRow: View {
    let essays: [Essay]
    let onError: (APIError) -> Void

    @Environment(WorkspaceStore.self) private var store
    @State private var busy = false

    private static let unchosen = "__"

    var body: some View {
        if let set = EssayChoiceRules.audienceSet(essays) {
            let chosen = EssayChoiceRules.chosenAudience(essays, hidden: store.workspace.essayHidden)
            Group {
                if set.single, let program = set.audiences.first {
                    Toggle("I’m applying to \(program)", isOn: Binding(
                        get: { chosen != "" },
                        set: { save($0 ? program : "") }
                    ))
                } else {
                    Picker(chosen == nil ? "Which college or program are you applying to?" : "Applying to",
                           selection: Binding(get: { chosen ?? Self.unchosen }, set: { if $0 != Self.unchosen { save($0) } })) {
                        if chosen == nil { Text("Choose…").tag(Self.unchosen) }
                        ForEach(set.audiences, id: \.self) { Text($0).tag($0) }
                        if set.shared { Text("None of these").tag("") }
                    }
                    .pickerStyle(.menu)
                }
            }
            .disabled(busy)
        }
    }

    private func save(_ audience: String) {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                try await store.setEssayHidden(EssayChoiceRules.audiencePatch(essays, audience: audience))
                Haptics.selection()
            } catch {
                let apiError = APIError.wrap(error)
                if apiError != .cancelled { onError(apiError) }
            }
        }
    }
}

/// A set's row: "Choose your 4" until exactly 4 are shown, then "Change".
struct EssayPickSetRow: View {
    let set: EssayPickSet

    @Environment(WorkspaceStore.self) private var store
    @State private var picking = false

    var body: some View {
        let shown = set.essays.filter { store.workspace.essayHidden[$0.id] != true }.map(\.id)
        let chosen = shown.count == set.choose
        Button { picking = true } label: {
            LabeledContent(chosen ? "Answering \(set.choose) of \(set.essays.count)" : "Answer \(set.choose) of \(set.essays.count)") {
                Text(chosen ? "Change" : "Choose your \(set.choose)").foregroundStyle(Theme.accent)
            }
        }
        .sheet(isPresented: $picking) {
            EssayPickSetSheet(set: set, initial: chosen ? Set(shown) : [])
        }
    }
}

/// One toggle per prompt in the set, at most `set.choose` on. The others move to Hidden and keep their drafts.
struct EssayPickSetSheet: View {
    let set: EssayPickSet

    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var picked: Set<String>
    @State private var saving = false
    @State private var error: APIError?

    init(set: EssayPickSet, initial: Set<String>) {
        self.set = set
        _picked = State(initialValue: initial)
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(set.essays) { essay in
                        let on = picked.contains(essay.id)
                        Toggle(essay.label, isOn: Binding(
                            get: { on },
                            set: { picked = $0 ? picked.union([essay.id]) : picked.subtracting([essay.id]) }
                        ))
                        .disabled(!on && picked.count >= set.choose)
                    }
                } header: {
                    Text("\(picked.count) of \(set.choose) picked").font(.forgeNumber(.caption))
                } footer: {
                    Text("Pick the \(set.choose) prompts you’re answering. The others move to Hidden and keep any drafts.")
                }
            }
            .disabled(saving)
            .navigationTitle("Choose your \(set.choose)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(saving || picked.count != set.choose)
                }
            }
            .errorAlert($error)
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            try await store.setEssayHidden(EssayChoiceRules.pickPatch(set, picked: picked))
            Haptics.success()
            dismiss()
        } catch {
            let apiError = APIError.wrap(error)
            if apiError != .cancelled { self.error = apiError }
        }
    }
}
