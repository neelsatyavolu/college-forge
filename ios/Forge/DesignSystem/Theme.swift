import SwiftUI
import UIKit

/// Forge's look on iOS, taken from public/styles.css and public/hub/workspace.css: warm paper and ink,
/// a deep green for actions, coral for the brand mark and urgent things. Every color adapts to dark mode.
enum Theme {
    // MARK: Surfaces and text

    /// Page background (--canvas).
    static let canvas = Color(light: 0xFAF9F5, dark: 0x14130F)
    /// Grouped sections and sidebars (--surface-soft).
    static let surface = Color(light: 0xF5F0E8, dark: 0x1C1A16)
    /// Cards on the canvas (--surface-card).
    static let card = Color(light: 0xFFFFFF, dark: 0x1F1D19)
    /// Pressed or selected fills (--surface-card).
    static let fill = Color(light: 0xEFE9DE, dark: 0x24211C)
    static let hairline = Color(light: 0xE6DFD8, dark: 0x35312B)

    static let ink = Color(light: 0x141413, dark: 0xF5F2EC)
    static let body = Color(light: 0x3D3D3A, dark: 0xCFCBC2)
    static let muted = Color(light: 0x6C6A64, dark: 0x9D9890)
    static let mutedSoft = Color(light: 0x8E8B82, dark: 0x7A756D)

    // MARK: Accents

    /// Actions, links, selection (--workspace-accent). Also the asset catalog AccentColor.
    static let accent = Color(light: 0x284F42, dark: 0xB0D3BF)
    static let accentSoft = Color(light: 0xE9EEE7, dark: 0x26372C)
    /// Brand mark and "needs you now" (--coral).
    static let coral = Color(light: 0xA84F35, dark: 0xE8A080)
    static let teal = Color(light: 0x276B55, dark: 0x80C7AC)
    static let amber = Color(light: 0xB87420, dark: 0xEAB36F)
    static let success = Color(light: 0x2F8A45, dark: 0x6FCE85)
    static let danger = Color(light: 0xB43A3A, dark: 0xE57373)

    // MARK: Layout

    enum Spacing {
        static let xxs: CGFloat = 4
        static let xs: CGFloat = 8
        static let sm: CGFloat = 12
        static let md: CGFloat = 16
        static let lg: CGFloat = 24
        static let xl: CGFloat = 32
    }

    enum Radius {
        static let small: CGFloat = 6
        static let medium: CGFloat = 10
        static let large: CGFloat = 14
    }

    /// Navigation bar titles in the serif display face (New York), like the web's headings.
    @MainActor
    static func configureAppearance() {
        let large = UIFont.preferredFont(forTextStyle: .largeTitle)
        let inline = UIFont.preferredFont(forTextStyle: .headline)
        let appearance = UINavigationBar.appearance()
        appearance.largeTitleTextAttributes = [.font: serif(large, weight: .semibold)]
        appearance.titleTextAttributes = [.font: serif(inline, weight: .semibold)]
    }

    private static func serif(_ font: UIFont, weight: UIFont.Weight) -> UIFont {
        let descriptor = font.fontDescriptor
            .addingAttributes([.traits: [UIFontDescriptor.TraitKey.weight: weight]])
            .withDesign(.serif) ?? font.fontDescriptor
        return UIFont(descriptor: descriptor, size: 0)
    }
}

// MARK: Typography

extension Font {
    /// Serif display text for screen and card titles. Scales with Dynamic Type.
    static func forgeDisplay(_ style: Font.TextStyle = .largeTitle, weight: Font.Weight = .semibold) -> Font {
        .system(style, design: .serif, weight: weight)
    }

    /// Small caps-style label above a section ("DUE THIS WEEK").
    static let forgeEyebrow = Font.system(.caption2, design: .default, weight: .semibold)

    /// Numbers that line up in columns.
    static func forgeNumber(_ style: Font.TextStyle = .body, weight: Font.Weight = .medium) -> Font {
        .system(style, design: .default, weight: weight).monospacedDigit()
    }
}

// MARK: Colors

extension Color {
    /// A color that switches with the interface style. Hex is 0xRRGGBB.
    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }

    /// Parses "#RRGGBB" (catalog brand colors). Nil for anything else.
    convenience init?(css: String) {
        var s = css.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let value = UInt32(s, radix: 16) else { return nil }
        self.init(hex: value)
    }
}
