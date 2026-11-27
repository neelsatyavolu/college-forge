import SwiftUI

/// Opens one essay in the editor.
struct EssayRoute: Hashable {
    let id: String
}

/// Color for a length: red over the limit, amber near it, teal otherwise.
enum EssayLengthTone {
    static func color(count: Int, essay: Essay) -> Color {
        if EssayMetrics.isOver(count, essay) { return Theme.danger }
        return EssayMetrics.progress(count, essay) > 0.85 ? Theme.amber : Theme.teal
    }

    static func dot(count: Int, essay: Essay) -> Color {
        if EssayMetrics.isOver(count, essay) { return Theme.danger }
        return count > 0 ? Theme.teal : Theme.hairline
    }
}

/// A thin capsule showing how much of the limit is used.
struct EssayLengthBar: View {
    let count: Int
    let essay: Essay

    var body: some View {
        GeometryReader { proxy in
            Capsule().fill(Theme.fill)
                .overlay(alignment: .leading) {
                    Capsule()
                        .fill(EssayLengthTone.color(count: count, essay: essay))
                        .frame(width: proxy.size.width * EssayMetrics.progress(count, essay))
                }
        }
        .frame(height: 4)
        .animation(.easeOut(duration: 0.16), value: count)
        .accessibilityHidden(true)
    }
}

/// One essay in the list.
struct EssayRow: View {
    let essay: Essay
    let count: Int

    var group: String?
    var isFinal = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
            if isFinal {
                Image(systemName: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(Theme.ink)
                    .accessibilityLabel("Marked final")
            } else {
                Circle()
                    .fill(EssayLengthTone.dot(count: count, essay: essay))
                    .frame(width: 8, height: 8)
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(group.map { "\($0) · \(essay.label)" } ?? essay.label)
                    .font(.body)
                    .foregroundStyle(Theme.ink)
                    .lineLimit(3)
                HStack(spacing: Theme.Spacing.xs) {
                    EssayLengthBar(count: count, essay: essay)
                        .frame(maxWidth: 140)
                    Text("\(count) / \(essay.limit)")
                        .font(.forgeNumber(.caption))
                        .foregroundStyle(EssayMetrics.isOver(count, essay) ? Theme.danger : Theme.muted)
                }
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityValue("\(count) of \(essay.limit) \(EssayMetrics.unitLabel(essay))")
    }
}

/// A tappable section header that expands or collapses a school's essays.
struct EssayGroupHeader: View {
    let group: EssayGroup
    let started: Int
    let isExpanded: Bool
    let unfinished: Bool
    let toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.xs) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(group.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(group.kind == .orphan ? Theme.mutedSoft : Theme.ink)
                        .textCase(nil)
                    if let subtitle = group.subtitle {
                        Text(subtitle)
                            .font(.caption)
                            .foregroundStyle(Theme.muted)
                            .lineLimit(2)
                            .textCase(nil)
                    }
                    if let due = group.due {
                        Text("Due \(due.shortDate) · \(due.round)\(group.kind == .school ? "" : " · " + due.school)")
                            .font(.caption)
                            .foregroundStyle(Theme.body)
                            .textCase(nil)
                        if unfinished, let days = ForgeDates.daysUntil(due.date), days < 14 {
                            Badge(text: days == 0 ? "due today" : "\(days)d left", tone: Theme.danger)
                                .textCase(nil)
                        }
                    }
                }
                Spacer(minLength: Theme.Spacing.xs)
                Text(group.essays.isEmpty ? "0" : "\(started)/\(group.essays.count)")
                    .font(.forgeNumber(.caption))
                    .foregroundStyle(Theme.mutedSoft)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.muted)
                    .rotationEffect(.degrees(isExpanded ? 90 : 0))
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(group.title), \(started) of \(group.essays.count) started")
        .accessibilityValue(group.due.map { "Due \($0.shortDate), \($0.round), \($0.school)" } ?? "")
        .accessibilityHint(isExpanded ? "Collapses the section" : "Expands the section")
    }
}

/// "Saved", "Saving…" or "Not saved", for the list header and editor.
struct EssaySaveStatusLabel: View {
    let state: EssayDraftQueue.SaveState

    var body: some View {
        HStack(spacing: 5) {
            switch state {
            case .saved:
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.teal)
                Text("Saved")
            case .saving:
                ProgressView().controlSize(.mini)
                Text("Saving…")
            case .failed:
                Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Theme.danger)
                Text("Not saved")
            }
        }
        .font(.caption)
        .foregroundStyle(Theme.muted)
        .accessibilityElement(children: .combine)
    }
}

/// The banner shown when drafts haven't reached the server.
struct EssaySaveErrorBanner: View {
    let queue: EssayDraftQueue

    var body: some View {
        if let message = queue.errorMessage {
            let recovery = queue.storageUnavailable
                ? "Keep the app open, or copy your draft."
                : "A copy is kept on this iPhone."
            ErrorBanner(message: "Your latest changes haven't saved. \(recovery) \(message)",
                        retry: { Task { await queue.flush() } })
        } else if queue.storageUnavailable && queue.hasUnsaved {
            ErrorBanner(message: "Draft recovery is unavailable on this iPhone. Keep the app open until your draft saves.")
        }
    }
}
