import SwiftUI

/// Intended major, list balance, regions and campus settings. Saving refreshes the recommendations.
struct RecommendationPreferencesSheet: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var draft = CollegesPreferenceDraft()
    @State private var isSaving = false
    @State private var error: APIError?

    var body: some View {
        NavigationStack {
            Form {
                Section("Intended major") {
                    TextField("e.g. Computer Science", text: $draft.intended)
                        .textInputAutocapitalization(.words)
                }
                Section {
                    Picker("List balance", selection: $draft.ambition) {
                        ForEach(CollegesPreferenceDraft.ambitions, id: \.id) { Text($0.label).tag($0.id) }
                    }
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
            .tint(Theme.accent)
            .navigationTitle("Preferences")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving { ProgressView() } else { Button("Update") { Task { await save() } } }
                }
            }
            .interactiveDismissDisabled(isSaving)
            .errorAlert($error)
        }
        .onAppear { draft = CollegesPreferenceDraft(store.workspace) }
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

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        let prefs = draft.listPrefs(merging: store.workspace.onboarding.listPrefs)
        let intended = draft.intended.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try await store.patch(.with {
                $0.profile = .init(intended: intended)
                $0.listPrefs = prefs
            }) { ws in
                ws.profile.intended = intended
                ws.onboarding.listPrefs = prefs
            }
            Haptics.success()
            dismiss()
        } catch {
            self.error = APIError.wrap(error)
            Haptics.error()
        }
    }
}

/// The editable copy of the recommendation preferences.
struct CollegesPreferenceDraft: Equatable {
    var intended = ""
    var ambition = "balanced"
    var regions: [String] = []
    var settings: [String] = []

    static let ambitions = [(id: "balanced", label: "Balanced mix"), (id: "ambitious", label: "More reaches"), (id: "conservative", label: "More likely options")]
    static let regions = [(id: "northeast", label: "New England"), (id: "mid-atlantic", label: "Mid-Atlantic"), (id: "south", label: "South"), (id: "midwest", label: "Midwest"), (id: "west", label: "West")]
    static let settings = [(id: "urban", label: "City"), (id: "suburban", label: "Suburban"), (id: "college-town", label: "College town"), (id: "rural", label: "Rural")]

    init() {}

    init(_ ws: Workspace) {
        let prefs = ws.onboarding.listPrefs
        intended = ws.profile.intended
        ambition = prefs?.ambition ?? "balanced"
        regions = prefs?.regions ?? []
        settings = prefs?.settings ?? []
    }

    /// Keeps app count, size and notes from the saved preferences.
    func listPrefs(merging saved: ListPrefs?) -> ListPrefs {
        var prefs = saved ?? ListPrefs()
        prefs.ambition = ambition
        prefs.regions = regions.filter { $0 != "any" }
        prefs.settings = settings
        return prefs
    }

    /// Adds or removes one value.
    static func toggled(_ list: [String], _ value: String, on: Bool) -> [String] {
        let rest = list.filter { $0 != value }
        return on ? rest + [value] : rest
    }
}
