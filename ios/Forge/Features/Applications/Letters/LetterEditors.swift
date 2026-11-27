import SwiftUI

/// Adds or edits one recommender. An empty id creates a new one (server upsert).
struct RecommendationEditor: View {
    @State var letter: Recommendation
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var saving = false
    @State private var error: APIError?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $letter.name).textContentType(.name)
                    Picker("Type", selection: $letter.type) {
                        ForEach(RecommenderType.all, id: \.self) { Text($0.label).tag($0) }
                    }
                    TextField("Subject", text: optional(\.subject))
                    Picker("Status", selection: $letter.status) {
                        ForEach(RecommendationStatus.all, id: \.self) { Text($0.label).tag($0) }
                    }
                }
                Section {
                    OptionalDateRow(title: "Deadline", date: optional(\.deadline))
                    TextField("Notes", text: optional(\.notes), axis: .vertical).lineLimit(2...6)
                }
            }
            .navigationTitle(letter.id.isEmpty ? "Add a recommender" : letter.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(letter.id.isEmpty ? "Add" : "Save", action: save)
                        .disabled(saving || ApplicationsValidation.trimmed(letter.name).isEmpty)
                }
            }
            .errorAlert($error)
        }
    }

    private func optional(_ key: WritableKeyPath<Recommendation, String?>) -> Binding<String> {
        Binding { letter[keyPath: key] ?? "" } set: { letter[keyPath: key] = $0 }
    }

    private func save() {
        var row = letter
        row.name = ApplicationsValidation.trimmed(row.name)
        saving = true
        Task {
            defer { saving = false }
            do {
                try await store.patch(.with { $0.recommendation = row }) { ws in
                    if let i = ws.recommendations.firstIndex(where: { $0.id == row.id && !row.id.isEmpty }) {
                        ws.recommendations[i] = row
                    }
                }
                Haptics.success()
                dismiss()
            } catch {
                self.error = APIError.wrap(error)
            }
        }
    }
}

/// Adds or edits one scholarship. An empty id creates a new one.
struct ScholarshipEditor: View {
    @State var scholarship: Scholarship
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var saving = false
    @State private var error: APIError?

    private var urlError: String? {
        let url = scholarship.url ?? ""
        return url.isEmpty || ApplicationsValidation.isWebLink(url) ? nil : "Enter a link starting with https:// or http://."
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $scholarship.name)
                    TextField("Amount", text: optional(\.amount))
                    Picker("Status", selection: $scholarship.status) {
                        ForEach(ScholarshipStatus.all, id: \.self) { Text($0.label).tag($0) }
                    }
                    OptionalDateRow(title: "Deadline", date: optional(\.deadline))
                    Picker("From", selection: schoolBinding) {
                        Text("Outside scholarship").tag("")
                        ForEach(store.workspace.colleges, id: \.slug) { Text($0.short.isEmpty ? $0.name : $0.short).tag($0.slug) }
                    }
                }
                Section {
                    TextField("https://", text: optional(\.url))
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    if let url = scholarship.url, urlError == nil, let link = URL(string: url) {
                        Link(destination: link) { Label("Open link", systemImage: "arrow.up.right.square") }
                    }
                } header: {
                    Text("Link")
                } footer: {
                    if let urlError { Text(urlError).foregroundStyle(Theme.danger) }
                }
                Section {
                    TextField("Notes", text: optional(\.notes), axis: .vertical).lineLimit(2...6)
                }
            }
            .navigationTitle(scholarship.id.isEmpty ? "Add a scholarship" : scholarship.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(scholarship.id.isEmpty ? "Add" : "Save", action: save)
                        .disabled(saving || urlError != nil || ApplicationsValidation.trimmed(scholarship.name).isEmpty)
                }
            }
            .errorAlert($error)
        }
    }

    private func optional(_ key: WritableKeyPath<Scholarship, String?>) -> Binding<String> {
        Binding { scholarship[keyPath: key] ?? "" } set: { scholarship[keyPath: key] = $0 }
    }

    /// "" is an outside scholarship; a slug ties it to that school as the school's own award.
    private var schoolBinding: Binding<String> {
        Binding { scholarship.slug ?? "" } set: { slug in
            scholarship.slug = slug
            scholarship.kind = slug.isEmpty ? "outside" : "school"
        }
    }

    private func save() {
        var row = scholarship
        row.name = ApplicationsValidation.trimmed(row.name)
        row.url = row.url.map(ApplicationsValidation.trimmed)
        saving = true
        Task {
            defer { saving = false }
            do {
                try await store.patch(.with { $0.scholarship = row }) { ws in
                    if let i = ws.scholarships.firstIndex(where: { $0.id == row.id && !row.id.isEmpty }) {
                        ws.scholarships[i] = row
                    }
                }
                Haptics.success()
                dismiss()
            } catch {
                self.error = APIError.wrap(error)
            }
        }
    }
}
