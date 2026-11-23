import Foundation

/// The Grok and ChatGPT sign-ins live in cookies Forge sets on its AI routes (`grok_session_*`,
/// `codex_session_*` and the short-lived `*_pkce`). The app's network session keeps no cookies, so this jar
/// holds just those, in the Keychain, per Forge account. Other cookies are ignored.
struct MoreAICookies: Codable, Equatable, Sendable {
    /// Cookie name → value.
    private(set) var values: [String: String] = [:]

    static let allowedPrefixes = ["grok_", "codex_"]

    static func isAllowed(_ name: String) -> Bool {
        allowedPrefixes.contains { name.hasPrefix($0) }
    }

    var isEmpty: Bool { values.isEmpty }

    /// The `Cookie` request header, or nil when there's nothing to send. Sorted for stable output.
    var headerValue: String? {
        guard !values.isEmpty else { return nil }
        return values.keys.sorted().map { "\($0)=\(values[$0]!)" }.joined(separator: "; ")
    }

    /// Applies a response's `Set-Cookie` headers: new values replace old ones, expired or empty ones are removed.
    /// Returns whether anything changed.
    @discardableResult
    mutating func merge(_ response: HTTPURLResponse, now: Date = .now) -> Bool {
        guard let url = response.url else { return false }
        let fields = response.allHeaderFields.reduce(into: [String: String]()) { result, pair in
            if let key = pair.key as? String, let value = pair.value as? String { result[key] = value }
        }
        return merge(HTTPCookie.cookies(withResponseHeaderFields: fields, for: url), now: now)
    }

    @discardableResult
    mutating func merge(_ cookies: [HTTPCookie], now: Date = .now) -> Bool {
        var next = values
        for cookie in cookies where Self.isAllowed(cookie.name) {
            let expired = cookie.expiresDate.map { $0 <= now } ?? false
            if expired || cookie.value.isEmpty {
                next[cookie.name] = nil
            } else {
                next[cookie.name] = cookie.value
            }
        }
        guard next != values else { return false }
        values = next
        return true
    }
}

/// Loads and saves `MoreAICookies` for one Forge account on one server.
final class MoreAICookieJar: @unchecked Sendable {
    private let keychain: Keychain
    private let account: String
    private let lock = NSLock()
    private var cookies: MoreAICookies

    init(baseURL: URL, accountEmail: String, keychain: Keychain = Keychain()) {
        self.keychain = keychain
        self.account = "ai-cookies:\(baseURL.host() ?? "forge"):\(accountEmail.lowercased())"
        self.cookies = keychain.value(MoreAICookies.self, for: account) ?? MoreAICookies()
    }

    var headerValue: String? {
        lock.withLock { cookies.headerValue }
    }

    func capture(_ response: HTTPURLResponse) {
        lock.withLock {
            guard cookies.merge(response) else { return }
            if cookies.isEmpty {
                keychain.remove(account)
            } else {
                keychain.setValue(cookies, for: account)
            }
        }
    }

    func clear() {
        lock.withLock {
            cookies = MoreAICookies()
            keychain.remove(account)
        }
    }
}
