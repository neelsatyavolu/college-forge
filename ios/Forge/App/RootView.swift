import SwiftUI

/// Launch → sign-in → the tabs, depending on the session.
struct RootView: View {
    @Environment(SessionModel.self) private var session

    var body: some View {
        ZStack {
            switch session.phase {
            case .launching:
                LaunchView()
            case .signedOut, .signingIn:
                SignInView()
                    .transition(.opacity)
            case .signedIn:
                if session.showsParentHome {
                    ParentHomeView()
                        .transition(.opacity)
                } else {
                    MainTabView()
                        .transition(.opacity)
                }
            }
        }
        .animation(.easeInOut(duration: 0.25), value: session.phase)
        .task { await session.bootstrap() }
    }
}

/// Matches the launch screen color so startup doesn't flash.
private struct LaunchView: View {
    var body: some View {
        ForgeMark(size: 56)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.canvas.ignoresSafeArea())
    }
}
