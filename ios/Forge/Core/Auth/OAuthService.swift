import Foundation

/// The OAuth 2.1 client side of Forge's authorization server (lib/oauth.ts): dynamic client registration,
/// PKCE authorization codes and rotating refresh tokens. The browser step lives in `SessionModel`.
struct OAuthService: Sendable {
    let config: AppConfig
    let transport: any HTTPTransport
    let keychain: Keychain

    init(config: AppConfig, transport: any HTTPTransport = URLSession.forge, keychain: Keychain = Keychain()) {
        self.config = config
        self.transport = transport
        self.keychain = keychain
    }

    /// Everything the browser step needs, plus what the token exchange checks afterwards.
    struct AuthorizationRequest: Sendable {
        let url: URL
        let clientID: String
        let pkce: PKCE
        let state: String
    }

    private var clientAccount: String { "oauth-client:\(config.baseURL.host() ?? "forge")" }

    // MARK: Client registration

    /// The registered client id, registering on first use. Cached in the Keychain per server host.
    func clientID() async throws -> String {
        if let cached = keychain.data(for: clientAccount).flatMap({ String(data: $0, encoding: .utf8) }), !cached.isEmpty {
            return cached
        }
        struct Registration: Encodable {
            let client_name: String
            let redirect_uris: [String]
            let grant_types = ["authorization_code", "refresh_token"]
            let response_types = ["code"]
            let token_endpoint_auth_method = "none"
        }
        struct Registered: Decodable { let client_id: String }
        let body = Registration(client_name: AppConfig.clientName, redirect_uris: [AppConfig.redirectURI])
        var request = URLRequest(url: config.baseURL.appending(path: "oauth/register"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let data = try await perform(request)
        let id = try JSONDecoder().decode(Registered.self, from: data).client_id
        keychain.set(Data(id.utf8), for: clientAccount)
        return id
    }

    /// Drops the cached registration so the next sign-in registers again (e.g. after a server reset).
    func forgetClient() {
        keychain.remove(clientAccount)
    }

    // MARK: Authorization

    func authorizationRequest() async throws -> AuthorizationRequest {
        let clientID = try await clientID()
        let pkce = PKCE.generate()
        let state = PKCE.randomURLSafeString(bytes: 16)
        return AuthorizationRequest(url: authorizeURL(clientID: clientID, pkce: pkce, state: state), clientID: clientID, pkce: pkce, state: state)
    }

    func authorizeURL(clientID: String, pkce: PKCE, state: String) -> URL {
        var components = URLComponents(url: config.baseURL.appending(path: "oauth/authorize"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "redirect_uri", value: AppConfig.redirectURI),
            URLQueryItem(name: "code_challenge", value: pkce.challenge),
            URLQueryItem(name: "code_challenge_method", value: PKCE.method),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "scope", value: "applications"),
        ]
        return components.url!
    }

    /// Reads the authorization code from the callback URL, checking `state`.
    static func code(from callback: URL, expectedState: String) throws -> String {
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let value = { (name: String) in items.first { $0.name == name }?.value }
        if let error = value("error") {
            throw APIError.server(status: 400, message: error == "access_denied" ? "Sign-in was cancelled." : "Sign-in didn't finish. Try again.")
        }
        guard value("state") == expectedState, let code = value("code"), !code.isEmpty else {
            throw APIError.server(status: 400, message: "Sign-in didn't finish. Try again.")
        }
        return code
    }

    // MARK: Tokens

    func exchange(code: String, request: AuthorizationRequest) async throws -> TokenSet {
        try await token([
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": AppConfig.redirectURI,
            "client_id": request.clientID,
            "code_verifier": request.pkce.verifier,
        ])
    }

    /// Exchanges a refresh token. An invalid or reused token throws `APIError.signedOut`.
    func refresh(_ refreshToken: String) async throws -> TokenSet {
        let clientID = keychain.data(for: clientAccount).flatMap { String(data: $0, encoding: .utf8) }
        var form = ["grant_type": "refresh_token", "refresh_token": refreshToken]
        if let clientID { form["client_id"] = clientID }
        return try await token(form)
    }

    private func token(_ form: [String: String]) async throws -> TokenSet {
        var request = URLRequest(url: config.baseURL.appending(path: "oauth/token"))
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(Self.formEncode(form).utf8)
        let data = try await perform(request)
        do {
            return try JSONDecoder().decode(TokenResponse.self, from: data).tokenSet()
        } catch {
            throw APIError.wrap(error)
        }
    }

    private func perform(_ request: URLRequest) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await transport.send(request)
        } catch {
            throw APIError.wrap(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.unavailable }
        if (200..<300).contains(http.statusCode) { return data }
        struct OAuthErrorBody: Decodable { let error: String?; let error_description: String? }
        let body = try? JSONDecoder().decode(OAuthErrorBody.self, from: data)
        switch body?.error {
        case "invalid_grant": throw APIError.signedOut
        case "invalid_client":
            forgetClient()
            throw APIError.server(status: http.statusCode, message: "Sign-in didn't finish. Try again.")
        default:
            if http.statusCode == 429 {
                throw APIError.rateLimited(message: body?.error_description ?? "Too many tries. Try again later.")
            }
            if http.statusCode >= 500 { throw APIError.unavailable }
            throw APIError.server(status: http.statusCode, message: body?.error_description ?? "Sign-in didn't finish. Try again.")
        }
    }

    static func formEncode(_ form: [String: String]) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return form.sorted { $0.key < $1.key }
            .map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")" }
            .joined(separator: "&")
    }
}
