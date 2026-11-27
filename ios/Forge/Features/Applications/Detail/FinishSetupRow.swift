import SwiftUI

/// A forwarded set-up email Forge couldn't finish: its PIN, link and password, shown only when asked for.
struct FinishSetupRow: View {
    let app: TrackedApplication
    @Environment(WorkspaceStore.self) private var store
    @State private var details: SetupDetails?
    @State private var loading = false
    @State private var error: APIError?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Label("Finish setup", systemImage: "envelope.badge")
                .font(.headline)
                .foregroundStyle(Theme.ink)
            Text("Forge couldn't finish setting up this portal from your forwarded email\(details.map { $0.reason.isEmpty ? "." : ": \($0.reason)" } ?? "."). The details are kept here, encrypted, until the login works.")
                .font(.subheadline)
                .foregroundStyle(Theme.body)
            if let details {
                if !details.username.isEmpty { detail("Username", details.username) }
                if !details.pin.isEmpty { detail("PIN", details.pin) }
                if !details.password.isEmpty { detail("Password Forge made", details.password) }
                if let url = URL(string: details.link), url.scheme == "https" {
                    Link("Open the set-up page", destination: url)
                }
            } else {
                Button(loading ? "Opening…" : "Show PIN, link and password") { Task { await reveal() } }
                    .disabled(loading)
            }
        }
        .padding(.vertical, Theme.Spacing.xs)
        .errorAlert($error)
    }

    private func detail(_ label: String, _ value: String) -> some View {
        LabeledContent(label) {
            Text(value).font(.body.monospaced()).foregroundStyle(Theme.ink).textSelection(.enabled)
        }
    }

    private func reveal() async {
        loading = true
        defer { loading = false }
        do {
            details = try await store.perform(.setupDetails(id: app.id)).setup
        } catch {
            self.error = APIError.wrap(error)
        }
    }
}
