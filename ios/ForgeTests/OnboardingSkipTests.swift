import Foundation
import Testing
@testable import Forge

@Suite("Skipping first-run setup")
@MainActor
struct OnboardingSkipTests {
    private func newStore(draftKey: String) -> WorkspaceStore {
        let manager = TokenManager(store: MemoryTokenStore(), devToken: "t") { _ in throw APIError.signedOut }
        let store = WorkspaceStore(api: APIClient(config: testConfig, transport: MockTransport { _ in (500, Data()) }, tokens: manager))
        var ws = PreviewData.workspace
        ws.onboarding.completed = false
        ws.applicant.name = ""
        ws.colleges = []
        ws.profile.activities = []
        ws.draftStorageKey = draftKey
        store.seed(workspace: ws, tracker: PreviewData.tracker)
        store.skippedSetupKeys = []
        return store
    }

    @Test func skippingHidesSetupForThatWorkspaceOnly() {
        let store = newStore(draftKey: "draft-a")
        #expect(OnboardingGate.shouldPresent(store))

        OnboardingGate.skip(store)
        #expect(!OnboardingGate.shouldPresent(store))

        // A reset hub gets a new draft key, so setup is offered again.
        var reset = store.workspace
        reset.draftStorageKey = "draft-b"
        store.seed(workspace: reset, tracker: PreviewData.tracker)
        #expect(OnboardingGate.shouldPresent(store))
        store.skippedSetupKeys = []
    }
}
