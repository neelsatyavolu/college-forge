import SwiftUI

/// Completed AP exams. Planned AP classes go in coursework.
struct APScoresView: View {
    @Environment(WorkspaceStore.self) private var store
    @State private var editing: EditTarget?
    @State private var error: APIError?

    private struct EditTarget: Identifiable {
        let index: Int?
        var id: Int { index ?? -1 }
    }

    var body: some View {
        let scores = store.workspace.profile.testing.aps
        List {
            Section {
                ForEach(Array(scores.enumerated()), id: \.offset) { index, ap in
                    Button { editing = EditTarget(index: index) } label: {
                        HStack {
                            Text(ap.course).foregroundStyle(Theme.ink)
                            Spacer()
                            Text(ap.score)
                                .font(.forgeNumber(.title3, weight: .semibold))
                                .foregroundStyle(Theme.accent)
                        }
                    }
                    .accessibilityLabel("\(ap.course), score \(ap.score)")
                }
                .onDelete { offsets in
                    var next = scores
                    next.remove(atOffsets: offsets)
                    save(next)
                }
            } footer: {
                Text("Add completed exams here. Put planned AP classes in coursework.")
            }
        }
        .overlay {
            if scores.isEmpty {
                EmptyStateView(systemImage: "checkmark.seal", title: "No AP scores yet",
                               message: "Add each exam you've taken and its score.",
                               actionTitle: "Add a score") { editing = EditTarget(index: nil) }
            }
        }
        .navigationTitle("AP exam scores")
        .navigationBarTitleDisplayMode(.inline)
        .forgeScreenBackground()
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Add score", systemImage: "plus") { editing = EditTarget(index: nil) }
            }
            if !scores.isEmpty {
                ToolbarItem(placement: .topBarLeading) { EditButton() }
            }
        }
        .sheet(item: $editing) { target in
            APScoreSheet(initial: target.index.flatMap { scores.indices.contains($0) ? scores[$0] : nil } ?? APScore()) { ap in
                var next = scores
                if let i = target.index, next.indices.contains(i) { next[i] = ap } else { next.append(ap) }
                try await store.saveAPScores(next)
            }
        }
        .errorAlert($error, title: "Couldn't save")
    }

    private func save(_ next: [APScore]) {
        Task {
            do { try await store.saveAPScores(next) }
            catch { self.error = APIError.wrap(error); Haptics.error() }
        }
    }
}

private struct APScoreSheet: View {
    let initial: APScore
    let onSave: (APScore) async throws -> Void
    @State private var ap = APScore()
    @State private var loaded = false

    var body: some View {
        ProfileEditSheet(title: initial.course.isEmpty ? "Add AP score" : "AP score", canSave: ProfileRules.apScoreError(ap) == nil,
                         save: { try await onSave(ap) }) {
            Section {
                TextField("AP course", text: $ap.course, prompt: Text("Calculus AB"))
                Picker("Score", selection: $ap.score) {
                    Text("Choose").tag("")
                    ForEach(["5", "4", "3", "2", "1"], id: \.self) { Text($0).tag($0) }
                }
            }
        }
        .onAppear {
            guard !loaded else { return }
            ap = initial
            loaded = true
        }
    }
}
