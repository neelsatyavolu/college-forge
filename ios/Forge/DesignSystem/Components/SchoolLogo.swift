import SwiftUI

/// A school's logo in a rounded square, falling back to a monogram while loading or when there is none.
/// Pass a site-relative path through `AppConfig.resolve(_:)` (or use `init(name:path:)`).
struct SchoolLogo: View {
    let name: String
    let url: URL?
    var size: CGFloat = 40
    /// Brand color for the monogram, if known (catalog `colors.first`).
    var tint: Color?

    @State private var loaded: UIImage?

    var body: some View {
        Group {
            if let image = loaded ?? url.flatMap({ LogoCache.shared.cached($0) }) {
                Image(uiImage: image).resizable().scaledToFit().padding(size * 0.12)
                    .background(Color.white)
            } else {
                monogram
            }
        }
        .task(id: url) {
            loaded = nil
            guard let url else { return }
            let image = await LogoCache.shared.image(for: url)
            guard !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: 0.2)) { loaded = image }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 0.5))
        .accessibilityHidden(true)
    }

    private var monogram: some View {
        ZStack {
            (tint ?? Theme.accent).opacity(0.14)
            Text(Self.initials(for: name))
                .font(.system(size: size * 0.38, weight: .semibold, design: .serif))
                .foregroundStyle(tint ?? Theme.accent)
                .minimumScaleFactor(0.5)
        }
    }

    /// "Massachusetts Institute of Technology" → "MI"; "UCLA" → "UC"; "Rice University" → "RU".
    static func initials(for name: String) -> String {
        let skip: Set<String> = ["of", "the", "at", "and", "&", "in"]
        let words = name.split(whereSeparator: { $0 == " " || $0 == "-" || $0 == "," })
            .map(String.init)
            .filter { !skip.contains($0.lowercased()) }
        if words.count == 1 { return String(words[0].prefix(2)).uppercased() }
        return words.prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
    }
}

extension SchoolLogo {
    /// Resolves a site-relative logo path against the configured server.
    init(name: String, path: String?, config: AppConfig, size: CGFloat = 40, tint: Color? = nil) {
        self.init(name: name, url: config.resolve(path), size: size, tint: tint)
    }
}

#Preview {
    HStack(spacing: 12) {
        SchoolLogo(name: "Rice University", url: nil)
        SchoolLogo(name: "Massachusetts Institute of Technology", url: nil, size: 56, tint: .red)
        SchoolLogo(name: "UCLA", url: nil, size: 28)
    }
    .padding()
}
