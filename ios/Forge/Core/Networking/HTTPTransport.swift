import Foundation

/// The one thing APIClient and OAuthService need from the network. URLSession conforms; tests use a fake.
protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, URLResponse)
    func stream(_ request: URLRequest) async throws -> (URLSession.AsyncBytes, URLResponse)
}

extension URLSession: HTTPTransport {
    func send(_ request: URLRequest) async throws -> (Data, URLResponse) {
        try await data(for: request, delegate: nil)
    }

    func stream(_ request: URLRequest) async throws -> (URLSession.AsyncBytes, URLResponse) {
        try await bytes(for: request, delegate: nil)
    }
}

extension URLSession {
    /// The app's session: no cookies (auth is the bearer token), no URL cache for API calls.
    static let forge: URLSession = {
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.timeoutIntervalForRequest = 30
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()
}

/// Supplies bearer tokens to APIClient. Implemented by `TokenManager`.
protocol AccessTokenProvider: Sendable {
    /// A token that isn't about to expire, refreshing first if needed. Nil when signed out.
    func validAccessToken() async throws -> String?
    /// Called after a 401 with the token that was rejected. Returns a fresh token; concurrent callers share
    /// one refresh. Throws `APIError.signedOut` when the session can't be renewed.
    func refreshedAccessToken(replacing rejected: String) async throws -> String
    /// Ends the session locally after the server keeps refusing it.
    func invalidate() async
}
