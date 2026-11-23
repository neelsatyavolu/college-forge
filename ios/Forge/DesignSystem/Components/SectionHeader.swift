import SwiftUI

/// A section title with optional detail text and a trailing action. Works inside `List` sections
/// (`Section { } header: { SectionHeader(...) }`) and in plain stacks.
struct SectionHeader: View {
    let title: String
    var detail: String?
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.forgeDisplay(.title3))
                    .foregroundStyle(Theme.ink)
                if let detail {
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(Theme.muted)
                }
            }
            Spacer(minLength: Theme.Spacing.sm)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .font(.subheadline.weight(.medium))
                    .tint(Theme.accent)
            }
        }
        .textCase(nil)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isHeader)
    }
}

/// An uppercase label above a group ("DUE THIS WEEK").
struct Eyebrow: View {
    let text: String
    var tone: Color = Theme.accent

    var body: some View {
        Text(text.uppercased())
            .font(.forgeEyebrow)
            .tracking(1.4)
            .foregroundStyle(tone)
    }
}

#Preview {
    VStack(spacing: 24) {
        SectionHeader(title: "Waiting to hear", detail: "4 schools", actionTitle: "See all") {}
        Eyebrow(text: "Due this week")
    }
    .padding()
}
