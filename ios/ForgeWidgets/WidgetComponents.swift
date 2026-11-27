import SwiftUI
import WidgetKit

enum WidgetLinks {
    static let applications = URL(string: "collegeforge://tab/applications")!

    static func open(_ item: WidgetItem?) -> URL {
        guard let id = item?.applicationID else { return applications }
        return application(id)
    }

    static func application(_ id: String) -> URL {
        URL(string: "collegeforge://application/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)") ?? applications
    }
}

extension WidgetItem {
    var symbol: String {
        switch kind {
        case .decisionPosted: "envelope.badge.fill"
        case .deadline: "calendar.badge.exclamationmark"
        case .followUp: "checklist"
        case .missing: "exclamationmark.triangle.fill"
        case .flag: "flag.fill"
        case .decisionDate: "envelope"
        case .date: "calendar"
        }
    }

    /// Coral for "needs you now", amber for "soon", green otherwise.
    var tint: Color {
        switch tier {
        case 0, 1: Theme.coral
        case 2: Theme.amber
        default: Theme.accent
        }
    }
}

/// The small caps label at the top of a widget ("UP NEXT").
struct WidgetEyebrow: View {
    let text: String
    var tint: Color = Theme.muted
    var trailing: String?

    var body: some View {
        HStack(spacing: 4) {
            Text(text.uppercased())
                .font(.forgeEyebrow)
                .tracking(0.6)
                .foregroundStyle(tint)
            Spacer(minLength: 4)
            if let trailing {
                Text(trailing)
                    .font(.forgeNumber(.caption2))
                    .foregroundStyle(Theme.mutedSoft)
            }
        }
        .widgetAccentable()
    }
}

/// One item as a row: icon, what, which school, and when.
struct WidgetItemRow: View {
    let item: WidgetItem
    let now: Date

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: item.symbol)
                .font(.caption)
                .foregroundStyle(item.tint)
                .frame(width: 16)
            VStack(alignment: .leading, spacing: 1) {
                Text(item.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Text(item.detail)
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }
            Spacer(minLength: 6)
            Text(item.headline(now: now))
                .font(.caption.weight(.medium))
                .foregroundStyle(item.tier <= 1 ? item.tint : Theme.muted)
                .lineLimit(1)
                .multilineTextAlignment(.trailing)
        }
    }
}

/// The large first item on Up Next.
struct WidgetLeadItem: View {
    let item: WidgetItem
    let now: Date
    var titleLines = 2

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Label(item.headline(now: now), systemImage: item.symbol)
                .font(.caption.weight(.semibold))
                .foregroundStyle(item.tint)
                .labelStyle(.titleAndIcon)
                .lineLimit(1)
            Text(item.title)
                .font(.forgeDisplay(.headline))
                .foregroundStyle(Theme.ink)
                .lineLimit(titleLines)
                .minimumScaleFactor(0.85)
            Text(item.detail)
                .font(.caption)
                .foregroundStyle(Theme.muted)
                .lineLimit(2)
        }
    }
}

/// What a widget says when there's nothing to draw.
struct WidgetMessage: View {
    let symbol: String
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(Theme.accent)
                .padding(.bottom, 2)
            Text(title)
                .font(.forgeDisplay(.subheadline))
                .foregroundStyle(Theme.ink)
                .lineLimit(2)
            Text(detail)
                .font(.caption)
                .foregroundStyle(Theme.muted)
                .lineLimit(3)
        }
        // Grouped in the middle, so a large widget has no gap between the icon and the words.
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

/// Signed out, or signed in with no schools yet. Nil when there's data to show.
struct WidgetGate {
    static func message(_ snapshot: WidgetSnapshot?) -> WidgetMessage? {
        guard let snapshot else {
            return WidgetMessage(symbol: "person.crop.circle", title: "Sign in to Forge", detail: "Your applications show up here once you sign in.")
        }
        if snapshot.apps.isEmpty {
            return WidgetMessage(symbol: "tray", title: "No schools yet", detail: "Add schools in Forge to track them here.")
        }
        return nil
    }
}

extension View {
    /// The card background every Forge widget uses.
    func forgeWidgetBackground() -> some View {
        containerBackground(Theme.card, for: .widget)
    }
}
