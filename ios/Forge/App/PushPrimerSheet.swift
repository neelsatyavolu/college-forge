import SwiftUI

/// Explains portal-update notifications before iOS asks. Shown once, after the first tracked application.
struct PushPrimerSheet: View {
    @Environment(PushManager.self) private var push
    @Environment(\.dismiss) private var dismiss
    @State private var isAsking = false
    /// The sheet sizes to its content, so there's no empty band at any text size.
    @State private var height: CGFloat = 400

    private static let shownKey = "ForgePushPrimerShown"
    static var wasShown: Bool {
        get { UserDefaults.standard.bool(forKey: shownKey) }
        set { UserDefaults.standard.set(newValue, forKey: shownKey) }
    }

    var body: some View {
        VStack(spacing: Theme.Spacing.lg) {
            Image(systemName: "bell.badge")
                .font(.system(size: 40, weight: .regular))
                .foregroundStyle(Theme.coral)
                .symbolRenderingMode(.hierarchical)
                .padding(.top, Theme.Spacing.lg)
            VStack(spacing: Theme.Spacing.xs) {
                Text("Hear when a portal changes")
                    .font(.forgeDisplay(.title2))
                    .multilineTextAlignment(.center)
                Text("Forge checks your portals on your schedule. Get a notification when a decision is posted, a status changes or a document goes missing.")
                    .font(.body)
                    .foregroundStyle(Theme.muted)
                    .multilineTextAlignment(.center)
            }
            VStack(spacing: Theme.Spacing.sm) {
                PrimaryButton(title: "Turn on notifications", isLoading: isAsking) {
                    Task {
                        isAsking = true
                        await push.requestAuthorization()
                        isAsking = false
                        dismiss()
                    }
                }
                Button("Not now") { dismiss() }
                    .font(.body.weight(.medium))
                    .foregroundStyle(Theme.muted)
                    .frame(minHeight: 44)
            }
        }
        .padding(.horizontal, Theme.Spacing.lg)
        .padding(.top, Theme.Spacing.sm)
        .padding(.bottom, Theme.Spacing.md)
        .fixedSize(horizontal: false, vertical: true)
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Theme.canvas.ignoresSafeArea())
        .presentationDetents([.height(height)])
        // Marked here, not when requested, so it counts only if the student actually saw it.
        .onAppear { Self.wasShown = true }
    }
}

#Preview {
    Color.clear.sheet(isPresented: .constant(true)) {
        PushPrimerSheet()
            .environment(PushManager())
    }
}
