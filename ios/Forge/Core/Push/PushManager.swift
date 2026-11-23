import Observation
import UIKit
import UserNotifications

/// Push notifications for portal updates: permission, APNs registration with Forge, and what happens when a
/// notification arrives or is tapped.
///
/// Permission is asked once the student has at least one tracked application (see `RootView`), or from
/// Settings via `requestAuthorization()`. Never at first launch.
@MainActor
@Observable
final class PushManager {
    private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined
    /// The current APNs token as hex, once iOS hands it over.
    private(set) var deviceToken: String?
    /// The last registration problem, for Settings to show. Nil when fine.
    private(set) var lastError: String?

    @ObservationIgnored private let center: UNUserNotificationCenter
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var api: APIClient?
    @ObservationIgnored private var environment = "sandbox"
    /// Set by AppServices: what to do when a portal-update push arrives or is tapped.
    @ObservationIgnored var onPortalUpdate: ((_ applicationID: String?, _ tapped: Bool) -> Void)?

    private static let tokenKey = "ForgePushToken"

    init(center: UNUserNotificationCenter = .current(), defaults: UserDefaults = .standard) {
        self.center = center
        self.defaults = defaults
        self.deviceToken = defaults.string(forKey: Self.tokenKey)
    }

    var isAuthorized: Bool {
        [.authorized, .provisional, .ephemeral].contains(authorizationStatus)
    }

    /// Starts sending the token to Forge for this account and registers with APNs if allowed.
    func attach(api: APIClient) async {
        self.api = api
        environment = api.config.pushEnvironment
        authorizationStatus = await center.notificationSettings().authorizationStatus
        registerIfAllowed()
    }

    /// Asks for permission if the student hasn't been asked yet. Returns whether notifications are allowed.
    @discardableResult
    func requestAuthorizationIfNeeded() async -> Bool {
        await refreshAuthorizationStatus()
        guard authorizationStatus == .notDetermined else { return isAuthorized }
        return await requestAuthorization()
    }

    /// Shows the system prompt (only works while `.notDetermined`; otherwise send people to Settings).
    @discardableResult
    func requestAuthorization() async -> Bool {
        let granted = (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) ?? false
        await refreshAuthorizationStatus()
        if granted { registerIfAllowed() }
        return granted
    }

    /// Reads the permission. When it was just turned on in iPhone Settings, registers with APNs right away.
    func refreshAuthorizationStatus() async {
        let wasAuthorized = isAuthorized
        authorizationStatus = await center.notificationSettings().authorizationStatus
        if !wasAuthorized { registerIfAllowed() }
    }

    /// The app came to the foreground: pick up a permission change and retry a failed registration.
    func sceneDidBecomeActive() async {
        await refreshAuthorizationStatus()
        guard lastError != nil, api != nil, isAuthorized else { return }
        if let deviceToken { await upload(deviceToken) } else { registerIfAllowed() }
    }

    private func registerIfAllowed() {
        guard api != nil, isAuthorized else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    // MARK: APNs callbacks (from AppDelegate)

    func didRegister(deviceToken data: Data) async {
        let token = data.hexString
        deviceToken = token
        defaults.set(token, forKey: Self.tokenKey)
        await upload(token)
    }

    func didFailToRegister(_ error: any Error) {
        lastError = "This device couldn't sign up for notifications."
    }

    // MARK: Sign-out

    /// Removes this device from the account on the server (best effort) and stops uploading.
    func detach() async {
        if let api, let token = deviceToken {
            try? await api.unregisterDevice(token: token)
        }
        api = nil
    }

    /// The session ended without a sign-out (revoked, expired), so the server can't be told. Unregistering
    /// from APNs makes the old token dead: Forge drops it on the next push, and the next sign-in gets a new one.
    func forgetDevice() {
        api = nil
        lastError = nil
        UIApplication.shared.unregisterForRemoteNotifications()
        deviceToken = nil
        defaults.removeObject(forKey: Self.tokenKey)
    }

    // MARK: Incoming notifications

    /// A notification arrived while the app is open. Refreshes data; returns how to present it.
    func willPresent(_ payload: PushPayload?) -> UNNotificationPresentationOptions {
        if let payload, payload.isPortalUpdate { onPortalUpdate?(payload.applicationID, false) }
        return [.banner, .list, .sound]
    }

    /// The student tapped a notification.
    func didTap(_ payload: PushPayload?) {
        guard let payload, payload.isPortalUpdate else { return }
        onPortalUpdate?(payload.applicationID, true)
    }

    private func upload(_ token: String) async {
        guard let api else { return }
        do {
            try await api.registerDevice(token: token, environment: environment)
            lastError = nil
        } catch {
            lastError = APIError.wrap(error).message
        }
    }
}
