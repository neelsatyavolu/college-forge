import Foundation

/// OAuth tokens for the signed-in account.
struct TokenSet: Codable, Equatable, Sendable {
    var accessToken: String
    var refreshToken: String
    var expiresAt: Date

    /// True when the access token expires within `margin` seconds.
    func isExpiring(within margin: TimeInterval = 60, now: Date = .now) -> Bool {
        expiresAt.timeIntervalSince(now) < margin
    }
}

/// POST /oauth/token reply.
struct TokenResponse: Decodable, Sendable {
    var access_token: String
    var refresh_token: String
    var expires_in: Double
    var token_type: String?

    func tokenSet(now: Date = .now) -> TokenSet {
        TokenSet(accessToken: access_token, refreshToken: refresh_token, expiresAt: now.addingTimeInterval(expires_in))
    }
}

/// Persists tokens. The app uses the Keychain; tests use memory.
protocol TokenStoring: Sendable {
    func load() -> TokenSet?
    func save(_ tokens: TokenSet?)
}

/// Tokens in the Keychain, one item per server host so a debug server never sees production tokens.
struct KeychainTokenStore: TokenStoring {
    let keychain: Keychain
    let account: String

    init(baseURL: URL, keychain: Keychain = Keychain()) {
        self.keychain = keychain
        self.account = "tokens:\(baseURL.host() ?? "forge")"
    }

    func load() -> TokenSet? { keychain.value(TokenSet.self, for: account) }

    func save(_ tokens: TokenSet?) {
        if let tokens { keychain.setValue(tokens, for: account) } else { keychain.remove(account) }
    }
}
