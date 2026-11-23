import SwiftUI

@main
struct ForgeApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    init() {
        Theme.configureAppearance()
    }

    var body: some Scene {
        WindowGroup {
            let services = delegate.services
            RootView()
                .environment(services.session)
                .environment(services.store)
                .environment(services.router)
                .environment(services.push)
                .tint(Theme.accent)
                .onOpenURL { services.router.handle($0) }
        }
    }
}
