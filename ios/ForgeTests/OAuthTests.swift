import Foundation
import Testing
@testable import Forge

@Suite("OAuth and PKCE")
struct OAuthTests {
    @Test func pkceMatchesRFC7636Vector() {
        let pkce = PKCE(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        #expect(pkce.challenge == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    @Test func generatedVerifierMeetsServerRules() throws {
        let pkce = PKCE.generate()
        // lib/oauth.ts: /^[A-Za-z0-9._~-]{43,128}$/ for the verifier, /^[A-Za-z0-9_-]{43,128}$/ for the challenge.
        #expect(pkce.verifier.wholeMatch(of: /[A-Za-z0-9._~-]{43,128}/) != nil)
        #expect(pkce.challenge.wholeMatch(of: /[A-Za-z0-9_-]{43,128}/) != nil)
        #expect(PKCE.generate().verifier != pkce.verifier)
    }

    @Test func authorizeURLCarriesEverything() throws {
        let service = OAuthService(config: testConfig, transport: MockTransport { _ in (500, Data()) }, keychain: Keychain(service: "test"))
        let pkce = PKCE(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        let url = service.authorizeURL(clientID: "fc_123", pkce: pkce, state: "s1")
        let items = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
        let q = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
        #expect(url.path() == "/oauth/authorize")
        #expect(q["response_type"] == "code")
        #expect(q["client_id"] == "fc_123")
        #expect(q["redirect_uri"] == "collegeforge://oauth/callback")
        #expect(q["code_challenge"] == pkce.challenge)
        #expect(q["code_challenge_method"] == "S256")
        #expect(q["state"] == "s1")
    }

    @Test func callbackRequiresMatchingState() throws {
        let good = URL(string: "collegeforge://oauth/callback?code=abc&state=s1&iss=https://forge.example")!
        #expect(try OAuthService.code(from: good, expectedState: "s1") == "abc")
        let wrongState = URL(string: "collegeforge://oauth/callback?code=abc&state=other")!
        #expect(throws: APIError.self) { try OAuthService.code(from: wrongState, expectedState: "s1") }
        let denied = URL(string: "collegeforge://oauth/callback?error=access_denied&state=s1")!
        #expect(throws: APIError.server(status: 400, message: "Sign-in was cancelled.")) {
            try OAuthService.code(from: denied, expectedState: "s1")
        }
    }

    @Test func tokenExchangeSendsFormAndParsesReply() async throws {
        let transport = MockTransport { request in
            #expect(request.url?.path() == "/oauth/token")
            #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/x-www-form-urlencoded")
            let form = String(decoding: request.httpBody ?? Data(), as: UTF8.self)
            #expect(form.contains("grant_type=authorization_code"))
            #expect(form.contains("redirect_uri=collegeforge%3A%2F%2Foauth%2Fcallback"))
            #expect(form.contains("code_verifier=v"))
            return (200, .json(#"{"access_token":"a1","refresh_token":"r1","expires_in":3600,"token_type":"Bearer"}"#))
        }
        let service = OAuthService(config: testConfig, transport: transport, keychain: Keychain(service: "co.xanom.forge.tests"))
        let request = OAuthService.AuthorizationRequest(url: testConfig.baseURL, clientID: "fc_1", pkce: PKCE(verifier: "v"), state: "s")
        let tokens = try await service.exchange(code: "c", request: request)
        #expect(tokens.accessToken == "a1")
        #expect(tokens.refreshToken == "r1")
        #expect(!tokens.isExpiring(within: 3000))
    }

    @Test func invalidGrantMeansSignedOut() async {
        let transport = MockTransport { _ in (400, .json(#"{"error":"invalid_grant","error_description":"expired"}"#)) }
        let service = OAuthService(config: testConfig, transport: transport, keychain: Keychain(service: "co.xanom.forge.tests"))
        await #expect(throws: APIError.signedOut) { try await service.refresh("old") }
    }

    @Test func formEncodingEscapesReservedCharacters() {
        #expect(OAuthService.formEncode(["b": "x y", "a": "1/2&3"]) == "a=1%2F2%263&b=x%20y")
    }
}
