import SwiftUI

/// A short confirmation that slides in at the bottom and hides itself after a few seconds.
private struct ApplicationsToast: ViewModifier {
    @Binding var message: String?

    func body(content: Content) -> some View {
        content.overlay(alignment: .bottom) {
            if let message {
                Text(message)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, Theme.Spacing.md)
                    .padding(.vertical, Theme.Spacing.sm)
                    .background(.regularMaterial, in: Capsule())
                    .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 0.5))
                    .padding(.horizontal, Theme.Spacing.md)
                    .padding(.bottom, 64)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .onTapGesture { self.message = nil }
                    .task(id: message) {
                        try? await Task.sleep(for: .seconds(4))
                        withAnimation { self.message = nil }
                    }
                    .accessibilityAddTraits(.isStaticText)
                    .onAppear { AccessibilityNotification.Announcement(message).post() }
            }
        }
        .animation(.snappy, value: message)
    }
}

extension View {
    func applicationsToast(_ message: Binding<String?>) -> some View {
        modifier(ApplicationsToast(message: message))
    }
}
