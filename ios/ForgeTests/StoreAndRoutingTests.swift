import Foundation
import Testing
@testable import Forge

private struct Value: Sendable, Equatable {
    var revision: Int
    var text: String
}

@Suite("Optimistic reconciliation")
struct ReconciledTests {
    private func make(_ text: String = "a", revision: Int = 1) -> Reconciled<Value> {
        var state = Reconciled<Value>(revision: { $0.revision })
        state.receive(Value(revision: revision, text: text))
        return state
    }

    @Test func successShowsServerValue() {
        var state = make()
        state.begin { $0.text = "b" }
        #expect(state.displayed?.text == "b")
        state.finish(Value(revision: 2, text: "b (saved)"))
        #expect(state.displayed == Value(revision: 2, text: "b (saved)"))
    }

    @Test func failureRollsBack() {
        var state = make()
        state.begin { $0.text = "b" }
        state.finish(nil)
        #expect(state.displayed == Value(revision: 1, text: "a"))
    }

    @Test func overlappingChangesDoNotFlicker() {
        var state = make()
        state.begin { $0.text += "1" }
        state.begin { $0.text += "2" }
        state.finish(Value(revision: 2, text: "a1"))
        // The second change is still in flight; keep showing both.
        #expect(state.displayed?.text == "a12")
        state.finish(Value(revision: 3, text: "a12"))
        #expect(state.displayed == Value(revision: 3, text: "a12"))
    }

    @Test func olderRepliesAreIgnored() {
        var state = make(revision: 5)
        state.receive(Value(revision: 4, text: "stale"))
        #expect(state.displayed?.revision == 5)
    }

    @Test func cannotChangeBeforeLoad() {
        var state = Reconciled<Value>(revision: { $0.revision })
        #expect(state.begin { $0.text = "x" } == false)
        #expect(state.inFlight == 0)
    }
}

@Suite("Store")
@MainActor
struct WorkspaceStoreTests {
    @Test func failedStatusChangeRollsBack() async throws {
        let transport = MockTransport { _ in (400, .json(#"{"success":false,"error":"No application matches."}"#)) }
        let manager = TokenManager(store: MemoryTokenStore(), devToken: "t") { _ in throw APIError.signedOut }
        let store = WorkspaceStore(api: APIClient(config: testConfig, transport: transport, tokens: manager))
        store.seed(workspace: PreviewData.workspace, tracker: PreviewData.tracker)

        await #expect(throws: APIError.server(status: 400, message: "No application matches.")) {
            try await store.setStatus(.admitted, forApplication: "a1")
        }
        #expect(store.application(id: "a1")?.status == .submitted)
    }

    @Test func statusChangeAppliesServerTracker() async throws {
        let reply = try Fixture.data("applications")
        let transport = MockTransport { request in
            #expect(request.jsonBody?["action"] as? String == "update")
            return (200, reply)
        }
        let manager = TokenManager(store: MemoryTokenStore(), devToken: "t") { _ in throw APIError.signedOut }
        let store = WorkspaceStore(api: APIClient(config: testConfig, transport: transport, tokens: manager))
        store.seed(workspace: PreviewData.workspace, tracker: PreviewData.tracker)

        try await store.setStatus(.admitted, forApplication: "a1")
        #expect(store.tracker.revision == 42)
        #expect(store.application(id: "app-1") != nil)
    }

    @Test func signedOutReplyNotifiesSession() async {
        let transport = MockTransport { _ in (401, .json("{}")) }
        let manager = TokenManager(store: MemoryTokenStore(), devToken: "t") { _ in throw APIError.signedOut }
        let store = WorkspaceStore(api: APIClient(config: testConfig, transport: transport, tokens: manager))
        var ended = false
        store.onSignedOut = { ended = true }
        await store.loadIfNeeded()
        #expect(ended)
        #expect(store.phase == .failed(.signedOut))
    }
}

@Suite("Routing and push")
@MainActor
struct RoutingTests {
    @Test func applicationDeepLinkSelectsTab() {
        let router = Router()
        router.selectedTab = .essays
        #expect(router.handle(URL(string: "collegeforge://application/app-1")!))
        #expect(router.selectedTab == .applications)
        #expect(router.applicationsPath.count == 1)
        #expect(!router.handle(URL(string: "collegeforge://oauth/callback?code=x")!))
        #expect(!router.handle(URL(string: "https://forge.example/application/app-1")!))
    }

    @Test func pushPayloadParsing() {
        let payload = PushPayload(userInfo: ["aps": ["alert": "Rice posted an update"], "type": "portal_update", "appId": "app-1"])
        #expect(payload == PushPayload(type: "portal_update", applicationID: "app-1"))
        #expect(payload?.isPortalUpdate == true)
        #expect(PushPayload(userInfo: ["aps": [:]]) == nil)
        #expect(PushPayload(userInfo: ["type": "portal_update", "appId": ""])?.applicationID == nil)
    }

    @Test func tappingPortalUpdateOpensApplication() {
        let services = AppServices(config: testConfig)
        services.push.didTap(PushPayload(type: "portal_update", applicationID: "app-9"))
        #expect(services.router.selectedTab == .applications)
        #expect(services.router.applicationsPath.count == 1)
    }

    @Test func deviceTokenIsHex() {
        #expect(Data([0x0a, 0xff, 0x01]).hexString == "0aff01")
    }

    @Test func configResolvesRelativeLogos() {
        #expect(testConfig.resolve("/logos/rice.png")?.absoluteString == "https://forge.example/logos/rice.png")
        #expect(testConfig.resolve("https://cdn.example/x.png")?.absoluteString == "https://cdn.example/x.png")
        #expect(testConfig.resolve("") == nil)
        #expect(testConfig.shareURL(token: "abc").absoluteString == "https://forge.example/hub/share.html?t=abc")
    }

    @Test func dates() {
        let now = ForgeDates.day("2026-11-23")!
        #expect(ForgeDates.daysUntil("2026-11-25", now: now) == 2)
        #expect(ForgeDates.relative("2026-11-24", now: now) == "tomorrow")
        #expect(ForgeDates.relative("2026-11-20", now: now) == "3 days ago")
        #expect(ForgeDates.short("2026-11-01", now: now) == "Nov 1")
        #expect(ForgeDates.short("2027-01-08", now: now) == "Jan 8, 2027")
        #expect(ForgeDates.short("") == "")
    }

    @Test func apiErrorsUseServerMessages() throws {
        let response = HTTPURLResponse(url: testConfig.baseURL, statusCode: 429, httpVersion: nil, headerFields: nil)!
        #expect(throws: APIError.rateLimited(message: "Slow down.")) {
            try APIClient.validate(.json(#"{"error":"Slow down."}"#), response)
        }
        #expect(throws: APIError.server(status: 200, message: "Save failed")) {
            try APIClient.checkEnvelope(.json(#"{"success":false,"error":"Save failed"}"#))
        }
        #expect(APIError.wrap(URLError(.notConnectedToInternet)) == .offline)
    }
}
