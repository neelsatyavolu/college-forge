import SwiftUI

/// A compact label for status lines inside a row: a small icon on the text's first baseline, a narrow gap,
/// and no list icon column, so it starts at the same x as the plain text lines around it.
struct InlineLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.xxs) {
            configuration.icon.imageScale(.small)
            configuration.title
        }
    }
}

extension LabelStyle where Self == InlineLabelStyle {
    static var inline: InlineLabelStyle { InlineLabelStyle() }
}
