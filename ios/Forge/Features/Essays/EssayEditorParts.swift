import SwiftUI

/// Group badge, limit, title and the prompt. The prompt folds away while writing.
struct EssayEditorHeader: View {
    let item: EssayItem
    @Binding var expanded: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            HStack(spacing: Theme.Spacing.xs) {
                Badge(text: item.badge, tone: Theme.coral, showsDot: false)
                Text("Limit \(item.essay.limit) \(EssayMetrics.unitLabel(item.essay))")
                    .font(.forgeNumber(.caption))
                    .foregroundStyle(Theme.muted)
                if EssayMetrics.isPersonalStatement(item.essay) {
                    Text("min \(EssayMetrics.personalStatementMinimum)")
                        .font(.forgeNumber(.caption))
                        .foregroundStyle(Theme.mutedSoft)
                }
            }
            Button { withAnimation(.snappy) { expanded.toggle() } } label: {
                HStack(alignment: .firstTextBaseline) {
                    Text(item.essay.label)
                        .font(.forgeDisplay(.title3))
                        .foregroundStyle(Theme.ink)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.down")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Theme.muted)
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(expanded ? "Hides the prompt" : "Shows the prompt")
            if expanded && !item.essay.prompt.isEmpty {
                // Short prompts take only their own height; long ones scroll inside 180 pt.
                ScrollView { promptText }
                    .scrollBounceBehavior(.basedOnSize)
                    .frame(maxHeight: 180)
                    .fixedSize(horizontal: false, vertical: true)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.top, Theme.Spacing.sm)
        .padding(.bottom, Theme.Spacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var promptText: some View {
        Text(item.essay.prompt)
            .font(.subheadline)
            .foregroundStyle(Theme.body)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
    }
}

/// The count, limit bar, warnings and save state under the editor.
struct EssayCountBar: View {
    let essay: Essay
    let count: Int
    let state: EssayDraftQueue.SaveState

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
                Text("\(count) / \(essay.limit) \(EssayMetrics.unitLabel(essay))")
                    .font(.forgeNumber(.subheadline))
                    .foregroundStyle(EssayMetrics.isOver(count, essay) ? Theme.danger : Theme.ink)
                EssayLengthWarning(essay: essay, count: count)
                Spacer(minLength: Theme.Spacing.xs)
                EssaySaveStatusLabel(state: state)
            }
            EssayLengthBar(count: count, essay: essay)
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, Theme.Spacing.sm)
        .background(.bar)
        .overlay(alignment: .top) { Divider().overlay(Theme.hairline) }
    }
}

/// "12 over" or "under 250 min".
struct EssayLengthWarning: View {
    let essay: Essay
    let count: Int

    var body: some View {
        if EssayMetrics.isOver(count, essay) {
            Text("\(count - essay.limit) over")
                .font(.forgeNumber(.caption))
                .foregroundStyle(Theme.danger)
        } else if EssayMetrics.isUnderMinimum(count, essay) {
            Text("under \(EssayMetrics.personalStatementMinimum) min")
                .font(.forgeNumber(.caption))
                .foregroundStyle(Theme.amber)
        }
    }
}

/// The compact count shown above the keyboard.
struct EssayKeyboardCount: View {
    let essay: Essay
    let count: Int
    let state: EssayDraftQueue.SaveState

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(state == .failed ? Theme.danger : state == .saving ? Theme.mutedSoft : Theme.teal)
                .frame(width: 6, height: 6)
            Text("\(count)/\(essay.limit)")
                .font(.forgeNumber(.footnote))
                .foregroundStyle(EssayMetrics.isOver(count, essay) ? Theme.danger : Theme.ink)
        }
        .fixedSize()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(count) of \(essay.limit) \(EssayMetrics.unitLabel(essay)), \(stateLabel)")
    }

    private var stateLabel: String {
        switch state {
        case .saved: "saved"
        case .saving: "saving"
        case .failed: "not saved"
        }
    }
}

/// Advisor comments left on this essay through a share link.
struct EssayAdvisorNotesSheet: View {
    let notes: [AdvisorNote]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(notes) { note in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(note.author.isEmpty ? "Advisor" : note.author)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.ink)
                        Spacer()
                        Text(ForgeDates.ago(milliseconds: note.createdAt))
                            .font(.caption)
                            .foregroundStyle(Theme.mutedSoft)
                    }
                    Text(note.body)
                        .font(.subheadline)
                        .foregroundStyle(Theme.body)
                        .textSelection(.enabled)
                }
                .padding(.vertical, 2)
            }
            .forgeScreenBackground()
            .navigationTitle("Advisor notes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}
