import SwiftUI

struct RankingsAiImportSection: View {
    let response: RankingsResponse
    @Environment(WorkspaceStore.self) private var store
    @Environment(RankingsModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var editing = false
    @State private var text = ""
    @State private var confirmingRemoval = false
    @State private var busy = false
    @State private var error: APIError?

    private var hasList: Bool { response.tabs.contains { $0.id == "ai" } }

    var body: some View {
        Section {
            if editing {
                TextField("Paste your ranking JSON", text: $text, axis: .vertical)
                    .font(.body.monospaced())
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .lineLimit(3...10)
                    .disabled(busy)
                Text(verbatim: #"{"list":[{"school":"Example College","rank":"1","why":"Strong labs"}]}"#)
                    .font(.caption.monospaced())
                    .foregroundStyle(Theme.muted)
                Button("Save list") { Task { await changeList(remove: false) } }
                    .disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Button("Cancel") {
                    editing = false
                    text = ""
                }
                .disabled(busy)
            } else {
                Button(hasList ? "Replace the list" : "Load a list") { editing = true }
                    .disabled(busy)
                if hasList {
                    Button("Remove", role: .destructive) { confirmingRemoval = true }
                        .disabled(busy)
                        .confirmationDialog("Remove your judged list?", isPresented: $confirmingRemoval, titleVisibility: .visible) {
                            Button("Remove", role: .destructive) { Task { await changeList(remove: true) } }
                            Button("Cancel", role: .cancel) {}
                        }
                }
            }
            if busy { ProgressView() }
        } header: {
            Text("Your own judged list")
        } footer: {
            Text("Paste JSON with your own ranking and a reason for each school. It shows as an AI My Path tab. Only you can see it. It is not shared, exported or read by Forge's assistant.")
        }
        .errorAlert($error)
    }

    private func changeList(remove: Bool) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let request = try remove ? RankingsAiRequest.remove : RankingsAiRequest.replace(text)
            _ = try await store.api.send(request)
            dismiss()
            await model.reloadAfterJudgedListChange(api: store.api, removed: remove)
        } catch {
            self.error = APIError.wrap(error)
        }
    }
}
