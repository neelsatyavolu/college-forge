import SwiftUI

/// Search Forge's school catalog, pick from the shortlist, or add any school by name.
struct AddSchoolSheet: View {
    /// Called with the new application's id after it's added.
    let onAdded: (String) -> Void

    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var catalog: [CatalogSchool]?
    @State private var catalogFailed = false
    @State private var applied = true
    @State private var adding: String?
    @State private var error: APIError?

    var body: some View {
        let results = SchoolSearch.results(query: query, tracked: store.applications, shortlist: store.workspace.colleges, catalog: catalog ?? [])
        NavigationStack {
            List {
                Section {
                    Toggle("I've already applied", isOn: $applied)
                } footer: {
                    Text(applied ? "Added as submitted. Save its portal login next so Forge can check it." : "Added as not started.")
                }
                if catalogFailed {
                    Text("Couldn't load the school list. You can still add a school by name.")
                        .font(.footnote).foregroundStyle(Theme.muted)
                }
                if !results.shortlist.isEmpty {
                    Section(query.isEmpty ? "From your shortlist" : "On your shortlist") {
                        ForEach(results.shortlist, id: \.slug) { college in
                            resultRow(key: "s-\(college.slug)", name: college.name, detail: "On your shortlist", logo: nil) {
                                .add(name: college.name, slug: college.slug, edit: edit)
                            }
                        }
                    }
                }
                if !results.catalog.isEmpty {
                    Section("Schools") {
                        ForEach(results.catalog) { school in
                            resultRow(key: school.id, name: school.name, detail: "\(school.state) · \(school.portalName)", logo: school.logo, tint: school.colors.first.flatMap(UIColor.init(css:)).map(Color.init(uiColor:))) {
                                .add(name: school.name, collegeId: school.id, edit: edit)
                            }
                        }
                    }
                }
                if results.offersCustom {
                    let name = ApplicationsValidation.trimmed(query)
                    Section {
                        resultRow(key: "custom", name: "Add “\(name)”", detail: "Not in Forge's list. You can add its portal link after.", logo: nil, monogram: name) {
                            .add(name: name, edit: edit)
                        }
                    }
                }
                if catalog == nil, !catalogFailed, query.count >= 2 {
                    HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Michigan, Pomona…")
            .autocorrectionDisabled()
            .navigationTitle("Add a school")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .task { await loadCatalog() }
            .errorAlert($error, title: "Couldn't add the school")
        }
    }

    private var edit: ApplicationEdit { ApplicationEdit(status: applied ? .submitted : .planning) }

    private func resultRow(key: String, name: String, detail: String, logo: String?, tint: Color? = nil, monogram: String? = nil, action: @escaping () -> ApplicationAction) -> some View {
        Button {
            add(key: key, action: action())
        } label: {
            HStack {
                ForgeRow(title: name, subtitle: detail) {
                    SchoolLogo(name: monogram ?? name, path: logo, config: store.config, size: 36, tint: tint)
                }
                if adding == key { ProgressView() }
            }
        }
        .disabled(adding != nil)
    }

    private func loadCatalog() async {
        guard catalog == nil else { return }
        do {
            catalog = try await store.api.catalog()
        } catch {
            catalogFailed = true
        }
    }

    private func add(key: String, action: ApplicationAction) {
        adding = key
        Task {
            defer { adding = nil }
            do {
                let response = try await store.perform(action)
                Haptics.success()
                dismiss()
                if let id = response.app?.id { onAdded(id) }
            } catch {
                self.error = APIError.wrap(error)
                Haptics.error()
            }
        }
    }
}
