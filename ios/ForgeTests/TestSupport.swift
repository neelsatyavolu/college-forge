import Foundation
@testable import Forge

private final class BundleToken {}

enum Fixture {
    static func data(_ name: String) throws -> Data {
        let bundle = Bundle(for: BundleToken.self)
        guard let url = bundle.url(forResource: name, withExtension: "json") else {
            throw CocoaError(.fileNoSuchFile)
        }
        return try Data(contentsOf: url)
    }

    static func decode<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
        try JSONDecoder().decode(T.self, from: data(name))
    }
}

/// A scripted network. The handler sees every request and returns status + JSON body.
final class MockTransport: HTTPTransport, @unchecked Sendable {
    typealias Handler = @Sendable (URLRequest) async throws -> (Int, Data)
    private let handler: Handler
    private let lock = NSLock()
    private var _requests: [URLRequest] = []

    init(_ handler: @escaping Handler) {
        self.handler = handler
    }

    var requests: [URLRequest] {
        lock.withLock { _requests }
    }

    func send(_ request: URLRequest) async throws -> (Data, URLResponse) {
        lock.withLock { _requests.append(request) }
        let (status, body) = try await handler(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        return (body, response)
    }

    func stream(_ request: URLRequest) async throws -> (URLSession.AsyncBytes, URLResponse) {
        throw URLError(.unsupportedURL)
    }
}

final class MemoryTokenStore: TokenStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var tokens: TokenSet?

    init(_ tokens: TokenSet? = nil) {
        self.tokens = tokens
    }

    func load() -> TokenSet? { lock.withLock { tokens } }
    func save(_ tokens: TokenSet?) { lock.withLock { self.tokens = tokens } }
}

/// Counts calls across tasks.
actor Counter {
    private(set) var value = 0
    func increment() -> Int {
        value += 1
        return value
    }
}

extension Data {
    static func json(_ string: String) -> Data { Data(string.utf8) }
}

extension URLRequest {
    var bearer: String? {
        value(forHTTPHeaderField: "Authorization")?.replacingOccurrences(of: "Bearer ", with: "")
    }

    var jsonBody: [String: Any]? {
        httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    }
}

let testConfig = AppConfig(baseURL: URL(string: "https://forge.example")!)
