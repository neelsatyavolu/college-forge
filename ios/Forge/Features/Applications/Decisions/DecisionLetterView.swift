import PDFKit
import SwiftUI
import WebKit

/// The decision letter Forge saved, in a sheet: HTML with JavaScript off and nothing remote, a PDF, or text.
struct DecisionLetterView: View {
    let app: TrackedApplication
    /// Nil for the current decision's letter; an id from `letterHistory` for an earlier one.
    var letterId: String?

    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var letter: DecisionLetter?
    @State private var error: APIError?
    @State private var pdfFile: URL?

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("\(app.name) letter")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                    if let pdfFile {
                        ToolbarItem(placement: .primaryAction) {
                            ShareLink(item: pdfFile) { Label("Share", systemImage: "square.and.arrow.up") }
                        }
                    }
                }
        }
        .task { await load() }
        .onDisappear {
            if let pdfFile { try? FileManager.default.removeItem(at: pdfFile.deletingLastPathComponent()) }
        }
    }

    @ViewBuilder private var content: some View {
        if let letter {
            switch letter.kind {
            case .pdf where letter.pdfData != nil:
                PDFLetter(data: letter.pdfData!).ignoresSafeArea(edges: .bottom)
            case .html where letter.html != nil:
                HTMLLetter(html: letter.html!).ignoresSafeArea(edges: .bottom)
            default:
                ScrollView {
                    Text(letter.text)
                        .font(.body)
                        .foregroundStyle(Theme.body)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding()
                }
            }
        } else if let error {
            EmptyStateView(systemImage: "envelope.badge", title: "Couldn't open the letter", message: error.message)
        } else {
            LoadingView()
        }
    }

    private func load() async {
        do {
            let loaded = try await store.decisionLetter(forApplication: app.id, letterId: letterId)
            letter = loaded
            if let data = loaded.pdfData { pdfFile = Self.writeShareable(data, name: app.name) }
        } catch {
            self.error = APIError.wrap(error)
        }
    }

    /// A copy for the share sheet in its own fresh folder, so it can never be an older letter. Nil if the write fails.
    private static func writeShareable(_ data: Data, name: String) -> URL? {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("letters/\(UUID().uuidString)", isDirectory: true)
        let safeName = name.replacingOccurrences(of: "/", with: "-")
        let url = folder.appendingPathComponent("\(safeName) decision letter.pdf")
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try data.write(to: url, options: [.atomic, .completeFileProtection])
            return url
        } catch {
            return nil
        }
    }
}

/// Sanitized school HTML. JavaScript is off, there's no base URL, a CSP blocks anything remote, and links
/// don't navigate inside the sheet.
private struct HTMLLetter: UIViewRepresentable {
    let html: String

    private static let csp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'"

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        config.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .white
        let page = """
        <!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\
        <meta http-equiv="Content-Security-Policy" content="\(Self.csp)">\
        <style>body{font:17px/1.55 Georgia,serif;color:#141413;background:#fff;margin:20px}img{max-width:100%;height:auto}</style>\
        </head><body>\(html)</body></html>
        """
        view.loadHTMLString(page, baseURL: nil)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, WKNavigationDelegate {
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            // Only the letter itself loads; a tapped https link opens in Safari instead.
            if action.navigationType == .linkActivated, let url = action.request.url, url.scheme == "https" {
                await UIApplication.shared.open(url)
                return .cancel
            }
            return action.navigationType == .other && action.request.url?.absoluteString == "about:blank" ? .allow : .cancel
        }
    }
}

private struct PDFLetter: UIViewRepresentable {
    let data: Data

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.document = PDFDocument(data: data)
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {}
}
