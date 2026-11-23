import SwiftUI

/// Signs in to Grok or ChatGPT. The provider's page opens here and the sign-in finishes by itself; if the
/// provider shows a code instead (or the page won't cooperate), it can be pasted.
struct MoreProviderConnectSheet: View {
    let provider: MoreAIProvider
    let client: MoreAIClient
    let onConnected: () -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var authorizeURL: URL?
    @State private var loadingPage = false
    @State private var showPaste = false
    @State private var pasted = ""
    @State private var finishing = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let error {
                    ErrorBanner(message: error, dismiss: { self.error = nil }).padding(Theme.Spacing.md)
                }
                if showPaste { pastePanel }
                content
            }
            .background(Theme.canvas.ignoresSafeArea())
            .navigationTitle("Connect \(provider.label)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .task { await start() }
            .interactiveDismissDisabled(finishing)
        }
    }

    @ViewBuilder
    private var content: some View {
        if finishing {
            LoadingView(label: "Finishing sign-in…")
        } else if let authorizeURL {
            MoreSignInWebView(url: authorizeURL, onCallback: { finish($0.absoluteString) }, isLoading: $loadingPage)
                .overlay(alignment: .top) { if loadingPage { ProgressView().padding(.top, Theme.Spacing.md) } }
        } else if error == nil {
            LoadingView(label: "Opening \(provider.label)…")
        } else {
            ContentUnavailableView {
                Label("Couldn't open sign-in", systemImage: "exclamationmark.triangle")
            } actions: {
                Button("Try again") { Task { await start() } }.buttonStyle(.forgePrimary).fixedSize()
            }
        }
    }

    private var pastePanel: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Text(provider == .grok
                 ? "Paste the authorization code or the full callback URL."
                 : "Paste the full URL of the page that failed to load.")
                .font(.footnote)
                .foregroundStyle(Theme.muted)
            HStack {
                TextField(provider == .grok ? "Code or callback URL" : "http://localhost:1455/…", text: $pasted)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                    .submitLabel(.done)
                    .onSubmit { finish(pasted) }
                Button("Finish") { finish(pasted) }
                    .buttonStyle(.forgePrimary)
                    .fixedSize()
                    .disabled(pasted.trimmingCharacters(in: .whitespaces).isEmpty || finishing)
            }
        }
        .padding(Theme.Spacing.md)
        .background(Theme.surface)
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button("Cancel") { dismiss() }.disabled(finishing)
        }
        ToolbarItem(placement: .primaryAction) {
            Menu("More", systemImage: "ellipsis.circle") {
                Button(showPaste ? "Hide code field" : "Paste a code or URL", systemImage: "doc.on.clipboard") {
                    withAnimation { showPaste.toggle() }
                }
                if let authorizeURL {
                    Button("Open in Safari", systemImage: "safari") {
                        showPaste = true
                        openURL(authorizeURL)
                    }
                }
            }
            .disabled(finishing)
        }
    }

    private func start() async {
        error = nil
        do {
            authorizeURL = try await client.startSignIn(provider)
        } catch {
            self.error = APIError.wrap(error).message
        }
    }

    private func finish(_ callback: String) {
        let value = callback.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !finishing else { return }
        finishing = true
        error = nil
        Task {
            do {
                try await client.completeSignIn(provider, callback: value)
                Haptics.success()
                onConnected()
                dismiss()
            } catch {
                self.error = APIError.wrap(error).message
                Haptics.error()
                finishing = false
                // The provider's one-time code is spent; start over with a fresh page.
                authorizeURL = nil
                pasted = ""
                await start()
            }
        }
    }
}
