import Foundation
import Testing
@testable import Forge

@Suite("More: AI providers and cookies")
struct MoreAITests {
    private func response(_ headers: [String: String]) -> HTTPURLResponse {
        HTTPURLResponse(url: URL(string: "https://forge.example/api/auth/grok/complete")!, statusCode: 200, httpVersion: nil, headerFields: headers)!
    }

    @Test func cookieJarKeepsOnlyProviderCookies() {
        var jar = MoreAICookies()
        let changed = jar.merge(response(["Set-Cookie": "grok_session_0=abc; Path=/; HttpOnly"]))
        #expect(changed)
        jar.merge(HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": "forge_session=nope; Path=/"], for: URL(string: "https://forge.example/")!))
        jar.merge(HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": "codex_pkce=xyz; Path=/"], for: URL(string: "https://forge.example/")!))
        #expect(jar.headerValue == "codex_pkce=xyz; grok_session_0=abc")
    }

    @Test func expiredOrEmptyCookieIsRemoved() {
        var jar = MoreAICookies()
        jar.merge(response(["Set-Cookie": "grok_session_0=abc; Path=/"]))
        jar.merge(response(["Set-Cookie": "grok_session_0=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"]))
        #expect(jar.isEmpty)
        #expect(jar.headerValue == nil)
    }

    @Test func unchangedMergeReportsNoChange() {
        var jar = MoreAICookies()
        jar.merge(response(["Set-Cookie": "grok_pkce=v; Path=/"]))
        let changed = jar.merge(response(["Set-Cookie": "grok_pkce=v; Path=/"]))
        #expect(!changed)
    }

    @Test func statusDecodesLeniently() throws {
        let json = """
        {"grokConnected":true,"codexConnected":false,"opencodeAvailable":false,"active":"grok",
         "connectionErrors":{"codex":"ChatGPT connection could not be refreshed."},
         "grokModels":[{"id":"grok-4","label":"Grok 4","tier":"fast"},{"bad":1}],"defaultGrokModel":"grok-4",
         "webSearchAvailable":true,"futureField":7}
        """
        let status = try JSONDecoder().decode(MoreAIStatus.self, from: Data(json.utf8))
        #expect(status.active == .grok)
        #expect(status.grokModels.map(\.title) == ["Grok 4 · fast"])
        #expect(status.connectionErrorText == "ChatGPT connection could not be refreshed.")
        #expect(status.isAvailable(.grok) && !status.isAvailable(.codex))
    }

    @Test func preferencesNeverFallBackToAnotherProvider() {
        var status = MoreAIStatus()
        status.grokConnected = true
        status.active = .grok
        var prefs = MoreAIPreferences()
        #expect(prefs.chosen(in: status) == .grok)
        #expect(prefs.canSend(with: status))
        prefs.preferred = .codex
        #expect(!prefs.canSend(with: status))
        #expect(prefs.headerLabel(for: status) == "ChatGPT unavailable")
        #expect(MoreAIPreferences().headerLabel(for: MoreAIStatus()) == "Not connected")
        #expect(!MoreAIPreferences().canSend(with: nil))
    }

    @Test func modelChoiceFallsBackToDefaultWhenNoLongerOffered() {
        var status = MoreAIStatus()
        status.grokModels = [MoreAIModel(id: "a", label: "A"), MoreAIModel(id: "b", label: "B")]
        status.defaultGrokModel = "a"
        var prefs = MoreAIPreferences()
        #expect(prefs.model(for: .grok, in: status) == "a")
        prefs.models[.grok] = "b"
        #expect(prefs.model(for: .grok, in: status) == "b")
        prefs.models[.grok] = "retired"
        #expect(prefs.model(for: .grok, in: status) == "a")
    }

    @Test func preferencesRoundTrip() throws {
        var prefs = MoreAIPreferences(preferred: .codex)
        prefs.models[.codex] = "gpt-x"
        let data = try JSONEncoder().encode(prefs)
        #expect(try JSONDecoder().decode(MoreAIPreferences.self, from: data) == prefs)
    }

    @Test func multipartBodyIsWellFormed() {
        let form = MoreMultipartForm(files: [MoreUploadFile(name: "tran\"script.pdf", mimeType: "application/pdf", data: Data("PDF".utf8))], boundary: "B")
        let text = String(decoding: form.body, as: UTF8.self)
        #expect(form.contentType == "multipart/form-data; boundary=B")
        #expect(text == "--B\r\nContent-Disposition: form-data; name=\"files\"; filename=\"transcript.pdf\"\r\nContent-Type: application/pdf\r\n\r\nPDF\r\n--B--\r\n")
        #expect(MoreMultipartForm.safeFilename("\"\n") == "file")
    }

    @Test func signInCallbackDetection() {
        #expect(MoreSignInWebView.isCallback(URL(string: "http://localhost:1455/auth/callback?code=x")!))
        #expect(MoreSignInWebView.isCallback(URL(string: "http://127.0.0.1:56121/callback?code=x")!))
        #expect(!MoreSignInWebView.isCallback(URL(string: "https://auth.openai.com/authorize")!))
    }
}
