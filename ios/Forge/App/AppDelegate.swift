import UIKit
import UserNotifications

/// Owns the app's services and receives the UIKit-only callbacks: APNs registration and notification taps.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    let services = AppServices()

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Must be set before launch finishes so a tap that launched the app is delivered.
        UNUserNotificationCenter.current().delegate = self
        // Started here rather than in AppServices so previews and test stores never write the widget data.
        services.widgets.start()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await services.push.didRegister(deviceToken: deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error) {
        services.push.didFailToRegister(error)
    }

    /// Portal pushes carry content-available, so iOS wakes the app for them in the background. Reloading
    /// then updates the widgets before the student opens anything. In the foreground `willPresent` handles it.
    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        guard application.applicationState != .active, PushPayload(userInfo: userInfo)?.isPortalUpdate == true else {
            return completionHandler(.noData)
        }
        Task {
            await services.refreshForBackgroundPush()
            completionHandler(.newData)
        }
    }

    // The completion-handler forms, not the async ones: the async forms call UIKit's completion off the
    // main thread, which crashes when a notification is tapped. iOS calls these on the main thread.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        let payload = PushPayload(userInfo: notification.request.content.userInfo)
        let options = MainActor.assumeIsolated { services.push.willPresent(payload) }
        completionHandler(options)
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let payload = PushPayload(userInfo: response.notification.request.content.userInfo)
        MainActor.assumeIsolated { services.push.didTap(payload) }
        completionHandler()
    }
}
