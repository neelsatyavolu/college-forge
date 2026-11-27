import SwiftUI

/// Edits the preferences used to generate college recommendations.
struct RecommendationPreferencesSheet: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(CollegesPicksModel.self) private var picks
    @Environment(\.dismiss) private var dismiss
    @State private var draft = CollegesPreferenceDraft()
    @State private var loaded = false
    @State private var loadError: APIError?
    @State private var isSaving = false
    @State private var error: APIError?

    var body: some View {
        NavigationStack {
            Group {
                if loaded {
                    form
                } else if let loadError {
                    ErrorStateView(error: loadError) { await load() }
                } else {
                    LoadingView(label: "Loading preferences…")
                }
            }
            .tint(Theme.accent)
            .navigationTitle("Preferences")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(isSaving) }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else if loaded {
                        Button("Update recommendations") { Task { await save() } }
                    }
                }
            }
            .interactiveDismissDisabled(isSaving)
            .errorAlert($error)
        }
        .task { await load() }
    }

    private var form: some View {
        Form {
            Section("Intended major") {
                TextField("e.g. Computer Science", text: $draft.intended)
                    .textInputAutocapitalization(.words)
            }
            Section {
                Picker("List balance", selection: $draft.ambition) {
                    ForEach(CollegesPreferenceDraft.ambitions, id: \.self) { Text($0.label).tag($0.rawValue) }
                }
            }
            Section {
                Picker("Number of applications", selection: $draft.appCount) {
                    Text("No target").tag(nil as Int?)
                    if let count = draft.appCount, !(8...15).contains(count) {
                        Text(String(count)).tag(Optional(count)).disabled(true)
                    }
                    ForEach(8...15, id: \.self) { Text(String($0)).tag(Optional($0)) }
                }
                Picker("Yearly amount your family can pay", selection: $draft.budget) {
                    if draft.budget.isEmpty { Text("Choose one").tag("").disabled(true) }
                    ForEach(CollegesPreferenceDraft.budgets, id: \.id) { Text($0.label).tag($0.id) }
                }
                Picker("Early Decision", selection: $draft.ed) {
                    if draft.ed.isEmpty { Text("Choose one").tag("").disabled(true) }
                    ForEach(CollegesPreferenceDraft.edChoices, id: \.id) { Text($0.label).tag($0.id) }
                }
            }
            Section("Anything else the list should follow") {
                TextField("e.g. strong marine biology, in-state publics, no schools in big cities",
                          text: $draft.notes, axis: .vertical)
                    .lineLimit(3...8)
                    .onChange(of: draft.notes) { _, value in
                        draft.notes = CollegesPreferenceDraft.limitedNotes(value)
                    }
            }
            Section("Financial aid") {
                Toggle("We will apply for need-based aid", isOn: $draft.needAid)
            }
            Section {
                ForEach(CollegesPreferenceDraft.regions, id: \.id) { option in
                    Toggle(option.label, isOn: toggle(option.id, region: true))
                }
            } header: {
                Text("Regions")
            } footer: {
                Text("Leave all off for anywhere.")
            }
            Section {
                ForEach(CollegesPreferenceDraft.settings, id: \.id) { option in
                    Toggle(option.label, isOn: toggle(option.id, region: false))
                }
            } header: {
                Text("Campus setting")
            } footer: {
                Text("Leave all off for any setting.")
            }
        }
        .disabled(isSaving)
    }

    private func toggle(_ value: String, region: Bool) -> Binding<Bool> {
        Binding(
            get: { (region ? draft.regions : draft.settings).contains(value) },
            set: { on in
                if region {
                    draft.regions = CollegesPreferenceDraft.toggled(draft.regions, value, on: on)
                } else {
                    draft.settings = CollegesPreferenceDraft.toggled(draft.settings, value, on: on)
                }
            }
        )
    }

    private func load() async {
        loadError = nil
        do {
            draft = try await store.api.collegePreferenceDraft()
            loaded = true
        } catch {
            loadError = APIError.wrap(error)
        }
    }

    private func save() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            let oldKey = CollegesPicksKey(store.workspace)
            _ = try await store.api.patchCollegeWorkspace(draft.patch)
            await store.refresh()
            // Budget, ED and aid alone don't change Core's recommendation refresh key.
            if oldKey == CollegesPicksKey(store.workspace) {
                await picks.load(api: store.api)
            }
            Haptics.success()
            dismiss()
        } catch {
            self.error = APIError.wrap(error)
            Haptics.error()
        }
    }
}
