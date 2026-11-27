import SwiftUI

/// FAFSA, CSS Profile and IDOC status, links, and free-form notes.
struct FinancialAidSection: View {
    @Binding var error: APIError?
    @Environment(WorkspaceStore.self) private var store
    @State private var notes: String?
    @State private var savingNotes = false

    private static let fafsaOptions: [AidFormStatus] = [.notStarted, .inProgress, .submitted, .processed]
    private static let cssOptions: [AidFormStatus] = fafsaOptions + [.notApplicable]

    private var aid: FinancialAid { store.workspace.financialAid }

    var body: some View {
        Section {
            Picker("FAFSA", selection: binding(\.fafsaStatus)) {
                ForEach(Self.fafsaOptions, id: \.self) { Text($0.label).tag($0) }
            }
            Picker("CSS Profile", selection: binding(\.cssStatus)) {
                ForEach(Self.cssOptions, id: \.self) { Text($0.label).tag($0) }
            }
            Picker("IDOC", selection: binding(\.idocStatus)) {
                ForEach(Self.cssOptions, id: \.self) { Text($0.label).tag($0) }
            }
            Link(destination: URL(string: "https://studentaid.gov/h/apply-for-aid/fafsa")!) {
                Label("Open FAFSA", systemImage: "arrow.up.right.square")
            }
            Link(destination: URL(string: "https://cssprofile.collegeboard.org/")!) {
                Label("Open CSS Profile", systemImage: "arrow.up.right.square")
            }
            TextField("Notes (special circumstances, fee waivers…)", text: notesBinding, axis: .vertical)
                .lineLimit(2...8)
            if let notes, notes != (aid.notes ?? "") {
                Button(savingNotes ? "Saving…" : "Save notes", action: saveNotes).disabled(savingNotes)
            }
        } header: {
            ApplicationsSectionHeader(title: "Financial aid", count: nil, tone: nil)
        } footer: {
            Text("Create FSA IDs early for you and a parent. Check each school's deadlines on the official sites.")
        }
    }

    private var notesBinding: Binding<String> {
        Binding { notes ?? aid.notes ?? "" } set: { notes = $0 }
    }

    private func binding(_ key: WritableKeyPath<FinancialAid, AidFormStatus>) -> Binding<AidFormStatus> {
        Binding {
            aid[keyPath: key]
        } set: { value in
            var next = aid
            next[keyPath: key] = value
            save(next)
        }
    }

    private func saveNotes() {
        var next = aid
        next.notes = notes
        savingNotes = true
        save(next) { notes = nil; savingNotes = false }
    }

    private func save(_ next: FinancialAid, done: (() -> Void)? = nil) {
        Task {
            do {
                try await store.patch(.with { $0.financialAid = next }) { $0.financialAid = next }
                Haptics.selection()
            } catch {
                self.error = APIError.wrap(error)
            }
            done?()
        }
    }
}
