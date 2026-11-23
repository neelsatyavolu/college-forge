import SwiftUI

/// A centered empty state: icon, title, one line of guidance and an optional action.
struct EmptyStateView: View {
    let systemImage: String
    let title: String
    let message: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(title).font(.forgeDisplay(.title2))
            } icon: {
                Image(systemName: systemImage).foregroundStyle(Theme.accent)
            }
        } description: {
            Text(message).foregroundStyle(Theme.muted)
        } actions: {
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.forgePrimary)
                    .fixedSize()
            }
        }
    }
}

/// A full-screen spinner with an optional caption.
struct LoadingView: View {
    var label: String?

    var body: some View {
        VStack(spacing: Theme.Spacing.md) {
            ProgressView().controlSize(.large)
            if let label {
                Text(label).font(.subheadline).foregroundStyle(Theme.muted)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

/// A full-screen error with a retry button, for a first load that failed.
struct ErrorStateView: View {
    let error: APIError
    var retry: (() async -> Void)?

    var body: some View {
        ContentUnavailableView {
            Label("Couldn't load", systemImage: error == .offline ? "wifi.slash" : "exclamationmark.triangle")
        } description: {
            Text(error.message)
        } actions: {
            if let retry {
                Button("Try again") { Task { await retry() } }
                    .buttonStyle(.forgePrimary)
                    .fixedSize()
            }
        }
    }
}

/// An inline banner for a failure that doesn't replace the screen (a refresh or save that failed).
struct ErrorBanner: View {
    let message: String
    var retry: (() -> Void)?
    var dismiss: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.sm) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(Theme.danger)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Theme.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let retry {
                Button("Retry", action: retry)
                    .font(.subheadline.weight(.semibold))
                    .tint(Theme.accent)
            }
            if let dismiss {
                Button(action: dismiss) {
                    Image(systemName: "xmark").font(.footnote.weight(.semibold))
                }
                .tint(Theme.muted)
                .accessibilityLabel("Dismiss")
            }
        }
        .padding(Theme.Spacing.sm)
        .background(Theme.danger.opacity(0.1), in: RoundedRectangle(cornerRadius: Theme.Radius.medium))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.medium).strokeBorder(Theme.danger.opacity(0.25), lineWidth: 0.5))
        .accessibilityElement(children: .combine)
    }
}

extension View {
    /// Shows an alert for an `APIError` and clears it when dismissed.
    func errorAlert(_ error: Binding<APIError?>, title: String = "Something went wrong") -> some View {
        alert(title, isPresented: Binding(get: { error.wrappedValue != nil }, set: { if !$0 { error.wrappedValue = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(error.wrappedValue?.message ?? "")
        }
    }
}

#Preview("Empty") {
    EmptyStateView(systemImage: "tray", title: "No applications yet", message: "Add the schools you're applying to.", actionTitle: "Add a school") {}
}

#Preview("Banner") {
    ErrorBanner(message: "You're offline. Check your connection and try again.", retry: {}, dismiss: {})
        .padding()
}
