import AuthenticationServices
import Observation

/// Whether someone is signed in, and the sign-in / sign-out flows. Read it with
/// `@Environment(SessionModel.self)`; `RootView` switches on `phase`.
@MainActor
@Observable
final class SessionModel {
    enum Phase: Equatable {
        /// Checking the saved session at launch.
        case launching
        case signedOut
        case signingIn
        case signedIn
    }

    private(set) var phase: Phase = .launching
    /// The account's name and email from /api/me.
    private(set) var user: MeResponse.User?
    /// Students this account follows as a parent (from /api/me).
    private(set) var parent = MeResponse.Parent()
    /// The parent chose to start applications of their own, so the tabs show instead of the parent dashboard.
    /// Saved per account, so another parent signing in on this phone still lands on their dashboard.
    var parentWantsOwnWorkspace: Bool {
        get {
            access(keyPath: \.parentWantsOwnWorkspace)
            return ownWorkspaceKey.map { UserDefaults.standard.bool(forKey: $0) } ?? false
        }
        set {
            withMutation(keyPath: \.parentWantsOwnWorkspace) {
                if let key = ownWorkspaceKey { UserDefaults.standard.set(newValue, forKey: key) }
            }
        }
    }
    /// Set from a parent's own tabs to go back to the parent dashboard.
    var showParentDashboard = false
    private var ownWorkspaceKey: String? {
        user.map { "forge.parent.ownWorkspace.\($0.email.lowercased())" }
    }

    /// Whether RootView shows the parent dashboard instead of the tabs.
    var showsParentHome: Bool {
        parent.students > 0 && (showParentDashboard || (parent.home && !parentWantsOwnWorkspace))
    }
    /// Shown on the sign-in screen after a failed attempt or an expired session.
    var signInMessage: String?

    @ObservationIgnored private let oauth: OAuthService
    @ObservationIgnored private let tokens: TokenManager
    @ObservationIgnored private let api: APIClient
    /// Wired by AppServices.
    @ObservationIgnored var didSignIn: (() async -> Void)?
    @ObservationIgnored var willSignOut: (() async -> Void)?
    @ObservationIgnored var didSignOut: (() -> Void)?
    /// The server ended the session (not the student): the phone must stop getting this account's pushes.
    @ObservationIgnored var sessionDidEnd: (() -> Void)?

    init(oauth: OAuthService, tokens: TokenManager, api: APIClient) {
        self.oauth = oauth
        self.tokens = tokens
        self.api = api
    }

    /// Opens the browser step and returns the callback URL. Pass SwiftUI's `webAuthenticationSession`.
    typealias BrowserStep = @MainActor (URL) async throws -> URL

    /// Restores a saved session at launch.
    func bootstrap() async {
        guard phase == .launching else { return }
        guard await tokens.hasSession else { return phase = .signedOut }
        await confirmAccount()
    }

    func signIn(using browser: BrowserStep) async {
        guard phase == .signedOut else { return }
        phase = .signingIn
        signInMessage = nil
        do {
            let request = try await oauth.authorizationRequest()
            let callback = try await browser(request.url)
            let code = try OAuthService.code(from: callback, expectedState: request.state)
            await tokens.signIn(try await oauth.exchange(code: code, request: request))
            await confirmAccount()
        } catch {
            // A stale registration (e.g. server data reset) can only show up as a failed browser step.
            oauth.forgetClient()
            phase = .signedOut
            if !Self.isCancellation(error) { signInMessage = APIError.wrap(error).message }
        }
    }

    /// The student chose to sign out: unregister push, forget tokens, clear data.
    func signOut() async {
        guard phase == .signedIn else { return }
        await willSignOut?()
        await tokens.clear()
        finishSignOut(message: nil)
    }

    /// The server ended the session (revoked grant, expired refresh token).
    func sessionEnded() {
        guard phase == .signedIn || phase == .launching else { return }
        Task { await tokens.clear() }
        sessionDidEnd?()
        finishSignOut(message: "Your session ended. Sign in again.")
    }

    /// After an offline launch `user` is unknown; fetch it once the network is back (foreground, first load).
    func refreshUserIfNeeded() async {
        guard phase == .signedIn, user == nil else { return }
        do {
            let me = try await api.me()
            guard phase == .signedIn else { return }
            if me.signedIn { user = me.user; parent = me.parent } else { sessionEnded() }
        } catch APIError.signedOut {
            sessionEnded()
        } catch {
            // Still offline; try again next time.
        }
    }

    private func confirmAccount() async {
        do {
            let me = try await api.me()
            guard me.signedIn else { return await endAfterRejectedToken() }
            user = me.user
            parent = me.parent
        } catch APIError.signedOut {
            return await endAfterRejectedToken()
        } catch {
            // Offline at launch: keep the session; screens show their own retry.
        }
        phase = .signedIn
        await didSignIn?()
    }

    private func endAfterRejectedToken() async {
        await tokens.clear()
        sessionDidEnd?()
        finishSignOut(message: phase == .signingIn ? "Sign-in didn't finish. Try again." : "Your session ended. Sign in again.")
    }

    /// Re-reads /api/me, e.g. after a parent opens an invite on the web or a student removes them.
    func refreshParent() async {
        guard phase == .signedIn, let me = try? await api.me(), me.signedIn else { return }
        user = me.user
        parent = me.parent
    }

    private func finishSignOut(message: String?) {
        user = nil
        parent = MeResponse.Parent()
        showParentDashboard = false
        phase = .signedOut
        signInMessage = message
        didSignOut?()
    }

    private static func isCancellation(_ error: any Error) -> Bool {
        if let web = error as? ASWebAuthenticationSessionError, web.code == .canceledLogin { return true }
        return error is CancellationError || APIError.wrap(error) == .cancelled
    }
}
