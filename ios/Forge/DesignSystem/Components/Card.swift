import SwiftUI

/// A rounded card on the canvas, for content outside a `List` (summaries, highlights).
struct Card<Content: View>: View {
    var padding: CGFloat = Theme.Spacing.md
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(padding)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Radius.large, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.large, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 0.5))
    }
}

extension View {
    /// Card styling for any view.
    func forgeCard(padding: CGFloat = Theme.Spacing.md) -> some View {
        Card(padding: padding) { self }
    }

    /// The app's background behind lists and scroll views. Use on every screen's root.
    func forgeScreenBackground() -> some View {
        scrollContentBackground(.hidden)
            .background(Theme.canvas.ignoresSafeArea())
    }
}

/// A standard list row: leading view (logo, icon), title, subtitle and trailing accessory.
struct ForgeRow<Leading: View, Trailing: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var leading: Leading
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            leading
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.body.weight(.medium))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(2)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

extension ForgeRow where Trailing == EmptyView {
    init(title: String, subtitle: String? = nil, @ViewBuilder leading: () -> Leading) {
        self.init(title: title, subtitle: subtitle, leading: leading, trailing: { EmptyView() })
    }
}

/// A label and value pair for detail screens ("Deadline" — "Jan 1").
struct LabeledValueRow: View {
    let label: String
    let value: String
    var systemImage: String?

    var body: some View {
        LabeledContent {
            Text(value.isEmpty ? "—" : value)
                .foregroundStyle(value.isEmpty ? Theme.mutedSoft : Theme.ink)
                .multilineTextAlignment(.trailing)
        } label: {
            if let systemImage {
                Label(label, systemImage: systemImage).foregroundStyle(Theme.body)
            } else {
                Text(label).foregroundStyle(Theme.body)
            }
        }
    }
}

#Preview {
    List {
        ForgeRow(title: "Rice University", subtitle: "Regular Decision · Jan 4") {
            SchoolLogo(name: "Rice University", url: nil)
        } trailing: {
            StatusBadge(status: .submitted)
        }
        LabeledValueRow(label: "Deadline", value: "Jan 4", systemImage: "calendar")
    }
    .forgeScreenBackground()
}
