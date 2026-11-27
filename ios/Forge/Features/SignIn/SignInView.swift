import AuthenticationServices
import SwiftUI

/// Shown when nobody is signed in. Forge accounts are Xanom accounts; sign-in happens in a secure browser
/// sheet through Forge's OAuth server.
struct SignInView: View {
    @Environment(SessionModel.self) private var session
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                header
                SignInFeatureList()
                Spacer(minLength: 0)
            }
            .padding(.horizontal, Theme.Spacing.lg)
            .padding(.top, Theme.Spacing.xl * 1.5)
            .frame(maxWidth: 520, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
        .safeAreaInset(edge: .bottom) { footer }
        .background(Theme.canvas.ignoresSafeArea())
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack(spacing: 10) {
                ForgeMark(size: 30)
                Text("College Forge")
                    .font(.forgeDisplay(.title2, weight: .medium))
                    .foregroundStyle(Theme.ink)
            }
            .accessibilityElement(children: .combine)
            Text("Every application, in one place.")
                .font(.forgeDisplay(.largeTitle))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, Theme.Spacing.lg)
            Text("Track each school's status and deadlines, let Forge check your portals, and open decisions when you're ready.")
                .font(.body)
                .foregroundStyle(Theme.body)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var footer: some View {
        VStack(spacing: Theme.Spacing.sm) {
            if let message = session.signInMessage {
                ErrorBanner(message: message, dismiss: { session.signInMessage = nil })
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            PrimaryButton(title: "Continue with Xanom", isLoading: session.phase == .signingIn) {
                Task { await session.signIn(using: openBrowser) }
            }
            Text("Forge uses your Xanom account, the same one as Mullwell, Lodestar and Tare. New here? You can create one on the next screen.")
                .font(.footnote)
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, Theme.Spacing.lg)
        .padding(.top, Theme.Spacing.sm)
        .padding(.bottom, Theme.Spacing.xs)
        .frame(maxWidth: 520)
        .frame(maxWidth: .infinity)
        .background(Theme.canvas)
        .animation(.snappy, value: session.signInMessage)
        .sensoryFeedback(.error, trigger: session.signInMessage) { _, new in new != nil }
    }

    private func openBrowser(_ url: URL) async throws -> URL {
        try await webAuthenticationSession.authenticate(
            using: url,
            callback: .customScheme(AppConfig.callbackScheme),
            preferredBrowserSession: nil,
            additionalHeaderFields: [:]
        )
    }
}

private struct SignInFeatureList: View {
    private let items = [
        ("clock.arrow.circlepath", "Portal checks on your schedule, with logins kept encrypted"),
        ("bell.badge", "A notification the moment a decision or update is posted"),
        ("square.and.arrow.down", "Bring your schools over from College Apps in one step"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            ForEach(items, id: \.1) { icon, text in
                HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
                    Image(systemName: icon)
                        .foregroundStyle(Theme.accent)
                        .frame(width: 24)
                    Text(text)
                        .font(.subheadline)
                        .foregroundStyle(Theme.body)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(Theme.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.large, style: .continuous))
    }
}
