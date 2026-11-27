import SwiftUI

/// "Assess all N" in the Not assessed yet header: sorts untiered schools into reach, target or likely.
struct ShortlistAssessButton: View {
    let count: Int
    @Environment(WorkspaceStore.self) private var store
    @Environment(CollegesChancesModel.self) private var chances

    var body: some View {
        Button {
            Task { await chances.assessAll(store: store) }
        } label: {
            if chances.isAssessing {
                ProgressView().controlSize(.small)
            } else {
                Text("Assess all \(count)")
            }
        }
        .font(.subheadline.weight(.medium))
        .disabled(chances.isBusy)
        .accessibilityHint("Sorts each school into reach, target or likely: from your grades and scores where it can, otherwise from an AI estimate of your chances. The AI step needs ChatGPT or Grok connected.")
    }
}

/// What Assess all is doing, or what it last did. Shown above the tiers so it stays once the section empties.
struct ShortlistAssessStatusSection: View {
    @Environment(CollegesChancesModel.self) private var chances

    var body: some View {
        if chances.isAssessing {
            Section {
                if chances.fraction > 0 {
                    ChancesProgress(fraction: chances.fraction, text: chances.progress)
                } else {
                    Label(chances.progress, systemImage: "arrow.triangle.2.circlepath")
                        .font(.footnote)
                        .foregroundStyle(Theme.muted)
                }
            } footer: {
                Text("Keep Forge open until this finishes.")
            }
        } else if let outcome = chances.assessOutcome, !(outcome.notice.isEmpty && outcome.error == nil) {
            Section {
                VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                    if !outcome.notice.isEmpty {
                        Text(outcome.notice).font(.footnote).foregroundStyle(Theme.muted)
                    }
                    if let error = outcome.error {
                        Label(error, systemImage: "exclamationmark.circle")
                            .font(.footnote)
                            .foregroundStyle(Theme.danger)
                    }
                }
            }
        }
    }
}
