import Foundation

/// Where the app talks to and how it identifies itself. Fixed at launch; changing the server URL in
/// Settings > Developer takes effect after the app restarts.
struct AppConfig: Sendable {
    static let productionURL = URL(string: "https://forge.xanom.co")!
    static let redirectURI = "collegeforge://oauth/callback"
    static let callbackScheme = "collegeforge"
    static let clientName = "Forge for iPhone"
    /// Sent on every API request so the server accepts the bearer token in place of a session cookie.
    static let appHeader = (name: "x-forge-app", value: "ios")

    /// UserDefaults keys. Launch arguments `-ForgeBaseURL <url>` and `-ForgeDevToken <token>` set the same
    /// keys through the arguments domain, which wins over saved values.
    enum Keys {
        static let baseURL = "ForgeBaseURL"
        static let devToken = "ForgeDevToken"
    }

    let baseURL: URL
    /// A bearer token that skips OAuth entirely (DEBUG only).
    let devToken: String?

    /// "sandbox" for development builds, "production" for TestFlight and the App Store.
    var pushEnvironment: String {
        #if DEBUG
        "sandbox"
        #else
        "production"
        #endif
    }

    init(baseURL: URL, devToken: String? = nil) {
        self.baseURL = baseURL
        self.devToken = devToken
    }

    /// Reads overrides in DEBUG builds; release builds always use production.
    static func current(defaults: UserDefaults = .standard) -> AppConfig {
        #if DEBUG
        let override = defaults.string(forKey: Keys.baseURL).flatMap(validatedURL)
        let token = defaults.string(forKey: Keys.devToken)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return AppConfig(baseURL: override ?? productionURL, devToken: token?.isEmpty == false ? token : nil)
        #else
        return AppConfig(baseURL: productionURL)
        #endif
    }

    /// Saves a server URL override for the next launch (DEBUG only). Pass nil to go back to production.
    /// Returns false when the URL isn't http(s).
    @discardableResult
    static func setDebugBaseURL(_ string: String?, defaults: UserDefaults = .standard) -> Bool {
        guard let string, !string.isEmpty else {
            defaults.removeObject(forKey: Keys.baseURL)
            return true
        }
        guard validatedURL(string) != nil else { return false }
        defaults.set(string, forKey: Keys.baseURL)
        return true
    }

    private static func validatedURL(_ string: String) -> URL? {
        guard let url = URL(string: string.trimmingCharacters(in: .whitespaces)),
              let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              url.host() != nil else { return nil }
        return url
    }

    /// Turns a site-relative path ("/logos/mit.png") into an absolute URL. Absolute https URLs pass through.
    func resolve(_ path: String?) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        if path.hasPrefix("http://") || path.hasPrefix("https://") { return URL(string: path) }
        return URL(string: path, relativeTo: baseURL)?.absoluteURL
    }

    /// The public link for a share token.
    func shareURL(token: String) -> URL {
        var components = URLComponents(url: baseURL.appending(path: "hub/share.html"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "t", value: token)]
        return components.url!
    }
}
