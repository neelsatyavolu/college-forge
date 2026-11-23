import Foundation

/// Builds the app's long-lived objects once and wires them together. Owned by `AppDelegate`.
@MainActor
final class AppServices {
    let config: AppConfig
    let tokens: TokenManager
    let oauth: OAuthService
    let api: APIClient
    let session: SessionModel
    let store: WorkspaceStore
    let router: Router
    let push: PushManager

    init(config: AppConfig = .current()) {
        Keychain().clearAfterReinstall()
        self.config = config
        let oauth = OAuthService(config: config)
        let tokens = TokenManager(store: KeychainTokenStore(baseURL: config.baseURL), devToken: config.devToken) { refreshToken in
            try await oauth.refresh(refreshToken)
        }
        let api = APIClient(config: config, tokens: tokens)
        self.oauth = oauth
        self.tokens = tokens
        self.api = api
        session = SessionModel(oauth: oauth, tokens: tokens, api: api)
        store = WorkspaceStore(api: api)
        router = Router()
        push = PushManager()
        wire()
    }

    private func wire() {
        let session = session, store = store, router = router, push = push, api = api, tokens = tokens

        session.didSignIn = {
            await push.attach(api: api)
            await store.loadIfNeeded()
            #if DEBUG
            router.applyLaunchTab()
            #endif
            await session.refreshUserIfNeeded()
        }
        session.willSignOut = {
            // Save open essay drafts while the token still works; anything left stays in the
            // per-workspace recovery copy for the next sign-in.
            if store.hasLoaded { await EssayDraftQueues.queue(for: store).flush() }
            await push.detach()
        }
        session.didSignOut = {
            store.reset()
            router.reset()
        }
        session.sessionDidEnd = { push.forgetDevice() }
        store.onSignedOut = { session.sessionEnded() }
        Task {
            await tokens.setSignedOutHandler {
                await MainActor.run { session.sessionEnded() }
            }
        }
        push.onPortalUpdate = { applicationID, tapped in
            if tapped, let applicationID { router.openApplication(id: applicationID) }
            Task { await store.refreshApplications() }
        }
    }
}
