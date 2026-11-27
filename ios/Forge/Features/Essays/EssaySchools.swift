import SwiftUI

/// Essay schools: the schools the student writes supplements for (`Workspace.essaySchools`, public/hub/EssaySchools.jsx).
/// Every school is one until the student turns it off; a school turned off stays on the list and keeps its drafts.
extension WorkspaceStore {
    /// Sets schools on (`true`) or off (`false`) by Essays group key, optimistically, in one PATCH.
    func setEssaySchools(_ changes: [String: Bool]) async throws {
        guard !changes.isEmpty else { return }
        let patch: [String: Bool?] = changes.mapValues { $0 ? nil : false }
        try await self.patch(.with { $0.essaySchools = patch }) { ws in
            for (key, writing) in changes { ws.essaySchools[key] = writing ? nil : false }
        }
    }

    func writesEssays(for college: College) -> Bool {
        guard let key = EssayCatalog.groupKey(for: college) else { return true }
        return !EssayCatalog.isSkipped(key, essaySchools: workspace.essaySchools)
    }
}

/// The list row's "Stop writing essays" / "Write essays" action (context menu and swipe).
struct EssaySchoolButton: View {
    let college: College
    let onError: (APIError) -> Void

    @Environment(WorkspaceStore.self) private var store

    var body: some View {
        if let key = EssayCatalog.groupKey(for: college) {
            let writing = store.writesEssays(for: college)
            Button {
                Task {
                    do {
                        try await store.setEssaySchools([key: !writing])
                        Haptics.selection()
                    } catch {
                        let apiError = APIError.wrap(error)
                        if apiError != .cancelled { onError(apiError) }
                    }
                }
            } label: {
                writing
                    ? Label("Stop writing essays", systemImage: "pencil.slash")
                    : Label("Write essays", systemImage: "pencil")
            }
            .accessibilityHint(writing ? "Takes this school's supplements off Essays. Drafts are kept." : "Puts this school's supplements back on Essays.")
        }
    }
}

/// "Pick essay schools": a toggle per school, select all or none, saved together.
struct EssaySchoolsSheet: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    /// Only the student's edits; untouched rows follow the saved workspace, so a change made elsewhere isn't undone.
    @State private var picked: [String: Bool] = [:]
    @State private var saving = false
    @State private var error: APIError?

    private var rows: [EssaySchool] {
        EssayCatalog.schools(colleges: store.workspace.colleges, essaySchools: store.workspace.essaySchools)
    }

    var body: some View {
        let rows = rows
        NavigationStack {
            List {
                Section {
                    ForEach(rows) { row in
                        Toggle(isOn: binding(row)) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.title)
                                if !row.subtitle.isEmpty {
                                    Text(row.subtitle).font(.caption).foregroundStyle(Theme.muted)
                                }
                            }
                        }
                    }
                } header: {
                    HStack {
                        Text("\(rows.filter { picked[$0.key] ?? $0.writing }.count) of \(rows.count)")
                        Spacer()
                        Button("Select all") { setAll(rows, true) }.textCase(nil)
                        Button("None") { setAll(rows, false) }.textCase(nil)
                    }
                } footer: {
                    Text("Essays shows supplements for the schools you turn on. Schools you turn off stay on your list and keep their drafts. The Common App essay is always on.")
                }
            }
            .disabled(saving)
            .navigationTitle("Essay schools")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save(rows) } }.disabled(saving)
                }
            }
            .errorAlert($error)
        }
    }

    private func binding(_ row: EssaySchool) -> Binding<Bool> {
        Binding(get: { picked[row.key] ?? row.writing }, set: { picked[row.key] = $0 })
    }

    private func setAll(_ rows: [EssaySchool], _ on: Bool) {
        picked = Dictionary(rows.map { ($0.key, on) }, uniquingKeysWith: { first, _ in first })
    }

    private func save(_ rows: [EssaySchool]) async {
        let changes = EssaySchoolsSheet.changes(rows: rows, picked: picked)
        saving = true
        defer { saving = false }
        do {
            try await store.setEssaySchools(changes)
            Haptics.success()
            dismiss()
        } catch {
            let apiError = APIError.wrap(error)
            if apiError != .cancelled { self.error = apiError }
        }
    }

    /// Only the schools whose choice changed, so saving an untouched sheet sends nothing.
    nonisolated static func changes(rows: [EssaySchool], picked: [String: Bool]) -> [String: Bool] {
        var out: [String: Bool] = [:]
        for row in rows {
            let want = picked[row.key] ?? row.writing
            if want != row.writing { out[row.key] = want }
        }
        return out
    }
}
