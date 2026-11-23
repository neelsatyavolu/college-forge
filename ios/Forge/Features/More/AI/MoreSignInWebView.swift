import SwiftUI
import WebKit

/// Shows a provider's sign-in page and catches its final redirect. Grok and ChatGPT send the browser back to a
/// local address (`http://localhost:1455/…`, `http://127.0.0.1:56121/…`) that nothing answers on a phone, so
/// the web asks people to copy that URL by hand. Here the redirect is caught before it loads.
struct MoreSignInWebView: UIViewRepresentable {
    let url: URL
    let onCallback: (URL) -> Void
    @Binding var isLoading: Bool

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        view.navigationDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        view.load(URLRequest(url: url))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.parent = self
    }

    /// Whether a URL is the provider's local callback.
    nonisolated static func isCallback(_ url: URL) -> Bool {
        guard url.scheme == "http" || url.scheme == "https", let host = url.host()?.lowercased() else { return false }
        return host == "localhost" || host == "127.0.0.1"
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: MoreSignInWebView
        private var delivered = false

        init(_ parent: MoreSignInWebView) {
            self.parent = parent
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard let url = action.request.url, MoreSignInWebView.isCallback(url) else { return .allow }
            if !delivered {
                delivered = true
                parent.onCallback(url)
            }
            return .cancel
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.isLoading = true
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.isLoading = false
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
            parent.isLoading = false
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
            parent.isLoading = false
        }
    }
}
