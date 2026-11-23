import Foundation

/// One HTTP request to Forge. `path` is site-relative ("/api/workspace").
struct APIRequest: Sendable {
    var method = "GET"
    var path: String
    var query: [URLQueryItem] = []
    var body: Data?
    var contentType: String? = "application/json"
    var timeout: TimeInterval = 30
    /// Extra headers, e.g. the AI provider cookies the More tab keeps per account.
    var headers: [String: String] = [:]

    init(_ method: String = "GET", _ path: String, query: [URLQueryItem] = [], body: Data? = nil, timeout: TimeInterval = 30) {
        self.method = method
        self.path = path
        self.query = query
        self.body = body
        self.timeout = timeout
    }

    /// A request with a JSON-encoded body.
    static func json(_ method: String, _ path: String, _ body: some Encodable, timeout: TimeInterval = 30) throws -> APIRequest {
        APIRequest(method, path, body: try JSONEncoder().encode(body), timeout: timeout)
    }
}

/// Talks to Forge's /api routes. Adds `Authorization: Bearer` and `x-forge-app: ios`, refreshes the token once
/// on a 401 (shared across concurrent requests) and turns failures into `APIError`.
final class APIClient: Sendable {
    let config: AppConfig
    private let transport: any HTTPTransport
    private let tokens: any AccessTokenProvider

    init(config: AppConfig, transport: any HTTPTransport = URLSession.forge, tokens: any AccessTokenProvider) {
        self.config = config
        self.transport = transport
        self.tokens = tokens
    }

    // MARK: Typed helpers

    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = [], as type: T.Type = T.self) async throws -> T {
        try await decode(T.self, from: APIRequest("GET", path, query: query))
    }

    func post<T: Decodable>(_ path: String, body: some Encodable, timeout: TimeInterval = 30, as type: T.Type = T.self) async throws -> T {
        try await decode(T.self, from: .json("POST", path, body, timeout: timeout))
    }

    func patch<T: Decodable>(_ path: String, body: some Encodable, as type: T.Type = T.self) async throws -> T {
        try await decode(T.self, from: .json("PATCH", path, body))
    }

    /// Sends a request and decodes the reply. A `{success:false, error}` reply throws `.server`.
    func decode<T: Decodable>(_ type: T.Type, from request: APIRequest) async throws -> T {
        let (data, _) = try await send(request)
        try Self.checkEnvelope(data)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.wrap(error)
        }
    }

    /// Sends a request and returns the raw body of a 2xx reply.
    @discardableResult
    func send(_ request: APIRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let token = try await tokens.validAccessToken()
            let (data, response) = try await perform(request, token: token)
            guard response.statusCode == 401, let token else { return try Self.validate(data, response) }
            let fresh = try await tokens.refreshedAccessToken(replacing: token)
            let (retryData, retryResponse) = try await perform(request, token: fresh)
            if retryResponse.statusCode == 401 {
                await tokens.invalidate()
                throw APIError.signedOut
            }
            return try Self.validate(retryData, retryResponse)
        } catch {
            throw APIError.wrap(error)
        }
    }

    /// Opens a streaming response (e.g. AI chat). Refreshes once on a 401 like `send`.
    func stream(_ request: APIRequest) async throws -> (URLSession.AsyncBytes, HTTPURLResponse) {
        do {
            let token = try await tokens.validAccessToken()
            var (bytes, response) = try await openStream(request, token: token)
            if response.statusCode == 401, let token {
                let fresh = try await tokens.refreshedAccessToken(replacing: token)
                (bytes, response) = try await openStream(request, token: fresh)
                if response.statusCode == 401 {
                    await tokens.invalidate()
                    throw APIError.signedOut
                }
            }
            guard (200..<300).contains(response.statusCode) else {
                var body = Data()
                for try await byte in bytes.prefix(8192) { body.append(byte) }
                _ = try Self.validate(body, response)
                throw APIError.unavailable
            }
            return (bytes, response)
        } catch {
            throw APIError.wrap(error)
        }
    }

    // MARK: Internals

    func urlRequest(for request: APIRequest, token: String?) throws -> URLRequest {
        guard var components = URLComponents(url: config.baseURL.appending(path: request.path), resolvingAgainstBaseURL: false) else {
            throw APIError.unavailable
        }
        if !request.query.isEmpty { components.queryItems = request.query }
        guard let url = components.url else { throw APIError.unavailable }
        var r = URLRequest(url: url, timeoutInterval: request.timeout)
        r.httpMethod = request.method
        r.httpBody = request.body
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.setValue(AppConfig.appHeader.value, forHTTPHeaderField: AppConfig.appHeader.name)
        if request.body != nil, let type = request.contentType { r.setValue(type, forHTTPHeaderField: "Content-Type") }
        for (name, value) in request.headers { r.setValue(value, forHTTPHeaderField: name) }
        if let token { r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return r
    }

    private func perform(_ request: APIRequest, token: String?) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await transport.send(urlRequest(for: request, token: token))
        guard let http = response as? HTTPURLResponse else { throw APIError.unavailable }
        return (data, http)
    }

    private func openStream(_ request: APIRequest, token: String?) async throws -> (URLSession.AsyncBytes, HTTPURLResponse) {
        let (bytes, response) = try await transport.stream(urlRequest(for: request, token: token))
        guard let http = response as? HTTPURLResponse else { throw APIError.unavailable }
        return (bytes, http)
    }

    private struct ErrorBody: Decodable {
        var success: Bool?
        var error: String?
        var error_description: String?
        var signedOut: Bool?
    }

    /// Maps a non-2xx reply to an APIError, using the server's own message when it sent one.
    static func validate(_ data: Data, _ response: HTTPURLResponse) throws -> (Data, HTTPURLResponse) {
        let status = response.statusCode
        if (200..<300).contains(status) { return (data, response) }
        let body = try? JSONDecoder().decode(ErrorBody.self, from: data)
        let message = (body?.error_description ?? body?.error)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        switch status {
        case 401: throw APIError.signedOut
        case 429: throw APIError.rateLimited(message: message.isEmpty ? "Too many tries. Wait a minute, then try again." : message)
        case 400..<500 where !message.isEmpty: throw APIError.server(status: status, message: message)
        case 400..<500: throw APIError.server(status: status, message: "That didn't go through. Try again.")
        case 500... where !message.isEmpty && message != "server_error": throw APIError.server(status: status, message: message)
        default: throw APIError.unavailable
        }
    }

    /// Forge replies `{success:false, error}` on some failures even with a 200.
    static func checkEnvelope(_ data: Data) throws {
        guard let body = try? JSONDecoder().decode(ErrorBody.self, from: data), body.success == false else { return }
        if body.signedOut == true { throw APIError.signedOut }
        throw APIError.server(status: 200, message: body.error ?? "That didn't save. Try again.")
    }
}
