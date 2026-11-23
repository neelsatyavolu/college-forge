import SwiftUI

/// A small tinted capsule with a colored dot: "● Submitted".
struct Badge: View {
    let text: String
    var tone: Color = Theme.mutedSoft
    var showsDot = true

    var body: some View {
        HStack(spacing: 5) {
            if showsDot {
                Circle().fill(tone).frame(width: 6, height: 6)
            }
            Text(text)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(tone.opacity(0.14), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.opacity(0.35), lineWidth: 0.5))
        .accessibilityElement(children: .combine)
    }
}

/// An application's status, colored like the web tracker.
struct StatusBadge: View {
    let status: AppStatus

    var body: some View {
        Badge(text: status.label, tone: status.tone)
            .accessibilityLabel("Status: \(status.label)")
    }
}

#Preview {
    VStack(alignment: .leading, spacing: 8) {
        ForEach(AppStatus.all) { StatusBadge(status: $0) }
        Badge(text: "Reach", tone: CollegeTier.reach.tone)
    }
    .padding()
}
