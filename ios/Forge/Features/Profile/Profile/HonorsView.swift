import SwiftUI

/// Up to five honors. Swipe right to highlight one, left to remove it.
struct HonorsView: View {
    @Environment(WorkspaceStore.self) private var store
    @State private var editing: ProfileActivityEditTarget?
    @State private var error: APIError?

    var body: some View {
        let honors = store.workspace.profile.honors
        List {
            Section {
                ForEach(Array(honors.enumerated()), id: \.offset) { index, honor in
                    Button { editing = ProfileActivityEditTarget(index: index) } label: { HonorRow(honor: honor) }
                        .tint(Theme.ink)
                        .swipeActions(edge: .leading) {
                            Button(honor.top == true ? "Unhighlight" : "Highlight", systemImage: honor.top == true ? "star.slash" : "star") {
                                var next = honors
                                next[index].top = !(honor.top ?? false)
                                save(next)
                                Haptics.selection()
                            }
                            .tint(Theme.amber)
                        }
                }
                .onMove { from, to in
                    var next = honors
                    next.move(fromOffsets: from, toOffset: to)
                    save(next)
                }
                .onDelete { offsets in
                    var next = honors
                    next.remove(atOffsets: offsets)
                    save(next)
                }
            } header: {
                if !honors.isEmpty { Text("\(honors.count) of \(ProfileRules.maxHonors) on the Common App") }
            }
        }
        .overlay {
            if honors.isEmpty {
                EmptyStateView(systemImage: "star", title: "No honors yet",
                               message: "Add academic, arts, sports or community awards. Up to \(ProfileRules.maxHonors).",
                               actionTitle: "Add an honor") { editing = ProfileActivityEditTarget(index: nil) }
            }
        }
        .navigationTitle("Honors and awards")
        .navigationBarTitleDisplayMode(.inline)
        .forgeScreenBackground()
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Add honor", systemImage: "plus") { editing = ProfileActivityEditTarget(index: nil) }
                    .disabled(honors.count >= ProfileRules.maxHonors)
            }
            if honors.count > 1 {
                ToolbarItem(placement: .topBarLeading) { EditButton() }
            }
        }
        .sheet(item: $editing) { target in
            let initial = target.index.flatMap { honors.indices.contains($0) ? honors[$0] : nil }
            HonorEditorSheet(initial: initial ?? Honor()) { honor in
                var next = store.workspace.profile.honors
                if let i = target.index, next.indices.contains(i) { next[i] = honor } else { next.append(honor) }
                try await store.saveHonors(next)
            }
        }
        .errorAlert($error, title: "Couldn't save")
    }

    private func save(_ next: [Honor]) {
        Task {
            do { try await store.saveHonors(next) }
            catch { self.error = APIError.wrap(error); Haptics.error() }
        }
    }
}

/// Recognition levels and their colors (`LEVEL_TONE` on the web).
enum ProfileHonorLevel {
    static let all = ["School", "Regional", "State", "National", "International"]

    static func tone(_ level: String) -> Color {
        switch level {
        case "National", "International": Theme.coral
        case "State": Theme.success
        default: Theme.mutedSoft
        }
    }
}

private struct HonorRow: View {
    let honor: Honor

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: honor.top == true ? "star.fill" : "star")
                .foregroundStyle(honor.top == true ? Theme.amber : Theme.hairline)
                .accessibilityLabel(honor.top == true ? "Highlighted" : "")
            VStack(alignment: .leading, spacing: 2) {
                Text(honor.title).foregroundStyle(Theme.ink)
                if let year = honor.year, !year.isEmpty {
                    Text(year).font(.forgeNumber(.footnote)).foregroundStyle(Theme.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if !honor.level.isEmpty {
                Badge(text: honor.level, tone: ProfileHonorLevel.tone(honor.level))
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct HonorEditorSheet: View {
    let initial: Honor
    let onSave: (Honor) async throws -> Void
    @State private var honor = Honor()
    @State private var loaded = false

    var body: some View {
        ProfileEditSheet(title: initial.title.isEmpty ? "Add honor" : "Honor",
                         canSave: ProfileRules.honorError(honor) == nil,
                         save: { try await onSave(cleaned) }) {
            Section {
                TextField("Award or honor title", text: $honor.title, prompt: Text("National Merit Semifinalist"))
                Picker("Level", selection: $honor.level) {
                    Text("Choose").tag("")
                    ForEach(levels, id: \.self) { Text($0).tag($0) }
                }
                TextField("Year or grade", text: Binding(get: { honor.year ?? "" }, set: { honor.year = $0 }), prompt: Text("Grade 11"))
                Toggle("Highlight this honor", isOn: Binding(get: { honor.top ?? false }, set: { honor.top = $0 }))
            }
        }
        .onAppear {
            guard !loaded else { return }
            honor = initial
            loaded = true
        }
    }

    /// Standard levels, plus whatever was typed on the web.
    private var levels: [String] {
        ProfileHonorLevel.all.contains(initial.level) || initial.level.isEmpty ? ProfileHonorLevel.all : ProfileHonorLevel.all + [initial.level]
    }

    private var cleaned: Honor {
        var h = honor
        h.title = h.title.profileTrimmed
        return h
    }
}
