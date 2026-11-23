import SwiftUI

/// A campus photo, falling back to the school's initials.
struct CollegePhoto: View {
    let name: String
    let url: URL?

    var body: some View {
        AsyncImage(url: url, transaction: Transaction(animation: .easeOut(duration: 0.2))) { phase in
            if case .success(let image) = phase {
                image.resizable().scaledToFill()
            } else {
                ZStack {
                    Theme.accentSoft
                    Text(SchoolLogo.initials(for: name))
                        .font(.system(.title, design: .serif, weight: .semibold))
                        .foregroundStyle(Theme.accent)
                        .minimumScaleFactor(0.4)
                        .padding(4)
                }
            }
        }
        .accessibilityHidden(true)
    }
}

/// "No supps" / "Supps optional" / "Supps required".
struct CollegesSuppBadge: View {
    let load: String?

    var body: some View {
        Badge(text: load?.isEmpty == false ? load! : "Supps unknown", tone: tone, showsDot: false)
    }

    private var tone: Color {
        switch load {
        case "No supps": Theme.success
        case "Supps optional": Theme.amber
        default: Theme.mutedSoft
        }
    }
}

/// A tier badge: "Reach", "Target", "Likely".
struct CollegesTierBadge: View {
    let tier: CollegeTier

    var body: some View {
        Badge(text: tier.displayLabel, tone: tier.tone)
    }
}

/// A bullet list row for reasons, cautions and limitations.
struct CollegesBullet: View {
    let text: String
    var tone: Color = Theme.mutedSoft

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.xs) {
            Circle().fill(tone).frame(width: 5, height: 5).alignmentGuide(.firstTextBaseline) { $0[.bottom] + 3 }
            Text(text)
                .font(.subheadline)
                .foregroundStyle(Theme.body)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// Picks reach, target or likely for a shortlist school.
struct CollegesTierMenu<MenuLabel: View>: View {
    let current: CollegeTier?
    let choose: (CollegeTier) -> Void
    @ViewBuilder var label: MenuLabel

    var body: some View {
        Menu {
            ForEach(CollegeTier.planning, id: \.self) { tier in
                Button { choose(tier) } label: {
                    if tier == current {
                        Label(tier.displayLabel, systemImage: "checkmark")
                    } else {
                        Text(tier.displayLabel)
                    }
                }
            }
        } label: {
            label
        }
    }
}
