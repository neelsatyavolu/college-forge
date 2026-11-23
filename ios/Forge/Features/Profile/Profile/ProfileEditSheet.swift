import SwiftUI

/// A form in a sheet with Cancel and Save. Save runs `save`; the sheet closes when it succeeds
/// and shows the server's message when it doesn't.
struct ProfileEditSheet<Content: View>: View {
    let title: String
    var canSave = true
    let save: () async throws -> Void
    @ViewBuilder var content: Content

    @Environment(\.dismiss) private var dismiss
    @State private var saving = false
    @State private var error: APIError?

    var body: some View {
        NavigationStack {
            Form { content }
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .forgeScreenBackground()
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        if saving { ProgressView() } else {
                            Button("Save", action: run).disabled(!canSave)
                        }
                    }
                }
                .errorAlert($error, title: "Couldn't save")
        }
        .interactiveDismissDisabled(saving)
    }

    private func run() {
        saving = true
        Task {
            defer { saving = false }
            do {
                try await save()
                Haptics.success()
                dismiss()
            } catch {
                self.error = APIError.wrap(error)
                Haptics.error()
            }
        }
    }
}
