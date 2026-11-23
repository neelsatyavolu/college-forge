import Foundation
import Testing
@testable import Forge

@Suite("Token refresh")
struct TokenRefreshTests {
    private func tokens(_ access: String, expiresIn: TimeInterval = 3600) -> TokenSet {
        TokenSet(accessToken: access, refreshToken: "refresh-\(access)", expiresAt: .now.addingTimeInterval(expiresIn))
    }

    /// The server accepts only `valid` and answers 401 to anything else.
    private func server(accepting valid: String) -> MockTransport {
        MockTransport { request in
            request.bearer == valid ? (200, .json(#"{"signedIn":true,"user":{"email":"sam@example.com","name":"Sam"}}"#)) : (401, .json(#"{"success":false,"signedOut":true}"#))
        }
    }

    @Test func concurrent401sShareOneRefresh() async throws {
        let calls = Counter()
        let manager = TokenManager(store: MemoryTokenStore(tokens("old"))) { refreshToken in
            #expect(refreshToken == "refresh-old")
            _ = await calls.increment()
            try await Task.sleep(for: .milliseconds(80))
            return TokenSet(accessToken: "new", refreshToken: "refresh-new", expiresAt: .now.addingTimeInterval(3600))
        }
        let transport = server(accepting: "new")
        let api = APIClient(config: testConfig, transport: transport, tokens: manager)

        try await withThrowingTaskGroup(of: MeResponse.self) { group in
            for _ in 0..<8 { group.addTask { try await api.me() } }
            for try await me in group { #expect(me.signedIn) }
        }
        #expect(await calls.value == 1)
        #expect(try await manager.validAccessToken() == "new")
    }

    @Test func everyRequestSendsAppHeaderAndBearer() async throws {
        let manager = TokenManager(store: MemoryTokenStore(tokens("t1"))) { _ in throw APIError.unavailable }
        let transport = server(accepting: "t1")
        _ = try await APIClient(config: testConfig, transport: transport, tokens: manager).me()
        let request = try #require(transport.requests.first)
        #expect(request.value(forHTTPHeaderField: "x-forge-app") == "ios")
        #expect(request.bearer == "t1")
        #expect(request.url?.absoluteString == "https://forge.example/api/me")
    }

    @Test func expiringTokenRefreshesBeforeTheRequest() async throws {
        let calls = Counter()
        let manager = TokenManager(store: MemoryTokenStore(tokens("old", expiresIn: 10))) { _ in
            _ = await calls.increment()
            return TokenSet(accessToken: "new", refreshToken: "r2", expiresAt: .now.addingTimeInterval(3600))
        }
        let transport = server(accepting: "new")
        _ = try await APIClient(config: testConfig, transport: transport, tokens: manager).me()
        #expect(await calls.value == 1)
        #expect(transport.requests.count == 1)
    }

    @Test func failedRefreshSignsOutAndNotifies() async throws {
        let store = MemoryTokenStore(tokens("old"))
        let manager = TokenManager(store: store) { _ in throw APIError.signedOut }
        let notified = Counter()
        await manager.setSignedOutHandler { _ = await notified.increment() }
        let api = APIClient(config: testConfig, transport: server(accepting: "nobody"), tokens: manager)

        await #expect(throws: APIError.signedOut) { try await api.me() }
        #expect(await notified.value == 1)
        #expect(store.load() == nil)
        #expect(await manager.hasSession == false)
    }

    @Test func offlineRefreshKeepsTheSession() async throws {
        let store = MemoryTokenStore(tokens("old", expiresIn: 5))
        let manager = TokenManager(store: store) { _ in throw APIError.offline }
        // Refresh fails offline; the old token is still tried and accepted.
        _ = try await APIClient(config: testConfig, transport: server(accepting: "old"), tokens: manager).me()
        #expect(store.load()?.accessToken == "old")
    }

    @Test func rejectedRefreshedTokenEndsSession() async throws {
        let manager = TokenManager(store: MemoryTokenStore(tokens("old"))) { _ in
            TokenSet(accessToken: "new", refreshToken: "r", expiresAt: .now.addingTimeInterval(3600))
        }
        let api = APIClient(config: testConfig, transport: server(accepting: "nobody"), tokens: manager)
        await #expect(throws: APIError.signedOut) { try await api.me() }
        #expect(await manager.hasSession == false)
    }

    @Test func devTokenSkipsOAuth() async throws {
        let manager = TokenManager(store: MemoryTokenStore(), devToken: "dev-token") { _ in throw APIError.unavailable }
        #expect(await manager.hasSession)
        let transport = server(accepting: "dev-token")
        _ = try await APIClient(config: testConfig, transport: transport, tokens: manager).me()
        #expect(transport.requests.first?.bearer == "dev-token")
    }

    @Test func signOutDuringRefreshDoesNotRestoreTokens() async throws {
        let store = MemoryTokenStore(tokens("old"))
        let manager = TokenManager(store: store) { _ in
            try await Task.sleep(for: .milliseconds(80))
            return TokenSet(accessToken: "new", refreshToken: "r", expiresAt: .now.addingTimeInterval(3600))
        }
        let refresh = Task { try await manager.refreshedAccessToken(replacing: "old") }
        try await Task.sleep(for: .milliseconds(20))
        await manager.clear()
        let result = await refresh.result
        #expect((try? result.get()) == nil)
        #expect(store.load() == nil)
    }
}
