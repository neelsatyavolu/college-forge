import SwiftUI

/// Whether the first-run setup should cover the app: the workspace has loaded and is still new
/// (`needsOnboarding` in lib/store.ts).
enum OnboardingGate {
    @MainActor
    static func shouldPresent(_ store: WorkspaceStore) -> Bool {
        store.hasLoaded && store.workspace.needsOnboarding && !isSkipped(store)
    }

    @MainActor
    static func isSkipped(_ store: WorkspaceStore) -> Bool {
        let key = store.workspace.draftStorageKey
        return !key.isEmpty && store.skippedSetupKeys.contains(key)
    }

    /// Stops covering the app for this workspace. Setup stays available from Profile.
    @MainActor
    static func skip(_ store: WorkspaceStore) {
        let key = store.workspace.draftStorageKey
        guard !key.isEmpty else { return }
        store.skippedSetupKeys.insert(key)
    }
}

extension View {
    /// Covers this view with the setup chat while `OnboardingGate.shouldPresent` is true.
    /// Attach once, to the signed-in root (MainTabView).
    func onboardingCover() -> some View {
        modifier(OnboardingCoverModifier())
    }
}

private struct OnboardingCoverModifier: ViewModifier {
    @Environment(WorkspaceStore.self) private var store

    func body(content: Content) -> some View {
        content.fullScreenCover(isPresented: Binding(get: { OnboardingGate.shouldPresent(store) }, set: { _ in })) {
            SetupChatView(canCancel: false)
        }
    }
}
