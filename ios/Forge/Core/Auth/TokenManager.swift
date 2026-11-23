import Foundation

/// Owns the signed-in tokens. Hands APIClient a valid access token, refreshes ahead of expiry, and makes
/// sure concurrent 401s share one refresh (Forge rotates refresh tokens, and reusing an old one revokes the
/// whole grant, so two parallel refreshes would sign the student out).
actor TokenManager: AccessTokenProvider {
    typealias Refresher = @Sendable (_ refreshToken: String) async throws -> TokenSet

    private let store: any TokenStoring
    private let refresher: Refresher
    private let devToken: String?
    private var tokens: TokenSet?
    private var refreshTask: Task<TokenSet, any Error>?
    private var onSignedOut: (@Sendable () async -> Void)?

    init(store: any TokenStoring, devToken: String? = nil, refresher: @escaping Refresher) {
        self.store = store
        self.devToken = devToken
        self.refresher = refresher
        self.tokens = devToken == nil ? store.load() : nil
    }

    /// Called (once per sign-out) when the session ends without the student asking, e.g. a revoked grant.
    func setSignedOutHandler(_ handler: @escaping @Sendable () async -> Void) {
        onSignedOut = handler
    }

    var hasSession: Bool { devToken != nil || tokens != nil }
    var isUsingDevToken: Bool { devToken != nil }

    func signIn(_ newTokens: TokenSet) {
        refreshTask?.cancel()
        refreshTask = nil
        tokens = newTokens
        store.save(newTokens)
    }

    /// Forgets the tokens without calling the signed-out handler (the student chose to sign out).
    func clear() {
        refreshTask?.cancel()
        refreshTask = nil
        tokens = nil
        store.save(nil)
    }

    // MARK: AccessTokenProvider

    func validAccessToken() async throws -> String? {
        if let devToken { return devToken }
        guard let current = tokens else { return nil }
        guard current.isExpiring() else { return current.accessToken }
        do {
            return try await refreshShared(from: current).accessToken
        } catch APIError.signedOut {
            throw APIError.signedOut
        } catch {
            // Offline: try the old token anyway; a 401 will bring us back here.
            return current.accessToken
        }
    }

    func refreshedAccessToken(replacing rejected: String) async throws -> String {
        if devToken != nil { throw APIError.signedOut }
        guard let current = tokens else { throw APIError.signedOut }
        // Someone else already refreshed while this request was in flight.
        if current.accessToken != rejected, refreshTask == nil { return current.accessToken }
        return try await refreshShared(from: current).accessToken
    }

    func invalidate() async {
        let hadSession = hasSession
        clear()
        if hadSession, let onSignedOut { await onSignedOut() }
    }

    // MARK: Refresh

    private func refreshShared(from current: TokenSet) async throws -> TokenSet {
        if let refreshTask { return try await refreshTask.value }
        let refresher = self.refresher
        let task = Task { try await refresher(current.refreshToken) }
        refreshTask = task
        do {
            let fresh = try await task.value
            // A sign-out while this was running wins; don't bring the tokens back.
            guard refreshTask == task else { throw APIError.signedOut }
            refreshTask = nil
            tokens = fresh
            store.save(fresh)
            return fresh
        } catch {
            let stillCurrent = refreshTask == task
            if stillCurrent { refreshTask = nil }
            if stillCurrent, case APIError.signedOut = error { await invalidate() }
            throw error
        }
    }
}
