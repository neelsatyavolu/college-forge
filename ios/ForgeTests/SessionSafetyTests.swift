import Foundation
import Testing
@testable import Forge

@Suite("Reset and account switches")
@MainActor
struct SessionSafetyTests {
    private func makeStore(_ transport: MockTransport) -> WorkspaceStore {
        let manager = TokenManager(store: MemoryTokenStore(), devToken: "t") { _ in throw APIError.signedOut }
        return WorkspaceStore(api: APIClient(config: testConfig, transport: transport, tokens: manager))
    }

    @Test func resetHubAppliesTheBareWorkspaceAndReloadsTheTracker() async throws {
        let workspace = try Fixture.data("workspace")
        let applications = try Fixture.data("applications")
        let transport = MockTransport { request in
            if request.httpMethod == "POST" {
                #expect(request.jsonBody?["action"] as? String == "reset")
                return (200, workspace)
            }
            return (200, applications)
        }
        let store = makeStore(transport)
        store.seed(workspace: PreviewData.workspace, tracker: PreviewData.tracker)
        let before = store.workspace.draftStorageKey

        try await store.resetHub()

        #expect(store.workspace.revision == 42)
        #expect(store.workspace.draftStorageKey != before)
        #expect(store.tracker.revision == 42)
        #expect(transport.requests.map(\.url?.path) == ["/api/workspace", "/api/applications"])
    }

    @Test func aReplyThatLandsAfterSignOutIsDropped() async throws {
        let workspace = try Fixture.data("workspace")
        let applications = try Fixture.data("applications")
        let transport = MockTransport { request in
            try await Task.sleep(for: .milliseconds(200))
            return (200, request.url?.path == "/api/workspace" ? workspace : applications)
        }
        let store = makeStore(transport)
        let load = Task { await store.loadIfNeeded() }
        try await Task.sleep(for: .milliseconds(50))
        store.reset()
        await load.value

        #expect(!store.hasLoaded)
        #expect(store.phase == .idle)
        #expect(store.workspace.revision == Workspace.empty.revision)
    }

    @Test func keychainIsClearedOnceAfterReinstall() throws {
        let suite = "forge.tests.install.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let keychain = Keychain(service: "co.xanom.forge.tests.install")
        // Unsigned simulator builds can't always write the Keychain; then only the once-per-install flag is checked.
        let canWrite = keychain.set(Data("old".utf8), for: "tokens:forge.example")

        #expect(keychain.clearAfterReinstall(defaults: defaults))
        #expect(keychain.data(for: "tokens:forge.example") == nil)

        if canWrite { keychain.set(Data("new".utf8), for: "tokens:forge.example") }
        #expect(!keychain.clearAfterReinstall(defaults: defaults))
        if canWrite { #expect(keychain.data(for: "tokens:forge.example") == Data("new".utf8)) }
        keychain.remove("tokens:forge.example")
    }
}
