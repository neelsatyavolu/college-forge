import SwiftUI

/// Filled accent button: the one main action on a screen. `.buttonStyle(.forgePrimary)`.
struct ForgePrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(Theme.canvas)
            .padding(.horizontal, Theme.Spacing.lg)
            .padding(.vertical, 14)
            .frame(minHeight: 50)
            .background(Theme.accent.opacity(isEnabled ? 1 : 0.4), in: RoundedRectangle(cornerRadius: Theme.Radius.medium))
            .opacity(configuration.isPressed ? 0.8 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }
}

/// Outlined button for secondary actions. `.buttonStyle(.forgeSecondary)`.
struct ForgeSecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.medium))
            .foregroundStyle(Theme.accent.opacity(isEnabled ? 1 : 0.4))
            .padding(.horizontal, Theme.Spacing.lg)
            .padding(.vertical, 13)
            .frame(minHeight: 48)
            .background(configuration.isPressed ? Theme.accentSoft : .clear, in: RoundedRectangle(cornerRadius: Theme.Radius.medium))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.medium).strokeBorder(Theme.hairline, lineWidth: 1))
    }
}

extension ButtonStyle where Self == ForgePrimaryButtonStyle {
    static var forgePrimary: ForgePrimaryButtonStyle { .init() }
}

extension ButtonStyle where Self == ForgeSecondaryButtonStyle {
    static var forgeSecondary: ForgeSecondaryButtonStyle { .init() }
}

/// A full-width primary button that shows a spinner while `isLoading`.
struct PrimaryButton: View {
    let title: String
    var systemImage: String?
    var isLoading = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Label {
                    Text(title)
                } icon: {
                    if let systemImage { Image(systemName: systemImage) }
                }
                .opacity(isLoading ? 0 : 1)
                if isLoading {
                    ProgressView().tint(Theme.canvas)
                }
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.forgePrimary)
        .disabled(isLoading)
        .accessibilityValue(isLoading ? "Working" : "")
    }
}

#Preview {
    VStack(spacing: 16) {
        PrimaryButton(title: "Continue with Xanom", systemImage: "person.badge.key") {}
        PrimaryButton(title: "Saving", isLoading: true) {}
        Button("Not now") {}.buttonStyle(.forgeSecondary)
    }
    .padding()
}
