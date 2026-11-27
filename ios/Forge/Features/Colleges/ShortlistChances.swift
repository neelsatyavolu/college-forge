import SwiftUI

/// "Your chances": explains the estimate and runs it.
struct ShortlistChancesSection: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(CollegesChancesModel.self) private var chances

    private var estimateLabel: String {
        if chances.isRunning { return "Estimating…" }
        if chances.metadata(for: store.workspace)?.staleNotice != nil { return "Re-estimate" }
        return store.workspace.admissionOdds.isEmpty ? "Estimate my chances" : "Estimate again"
    }

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                Text("Your chances").font(.forgeDisplay(.title3)).foregroundStyle(Theme.ink)
                Text("The AI reads your profile, essays and uploads, looks at each school’s published admission rates and what it weighs, and counts decisions you already have. Each estimate starts from the school’s published rate for your round and moves at most threefold. Treat it as a rough guide.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.body)
                    .fixedSize(horizontal: false, vertical: true)
                if let error = chances.metadataError {
                    ErrorBanner(message: error.message, retry: { Task { await chances.loadMetadata(store: store) } })
                }
                status
                Button {
                    Task { await chances.run(store: store) }
                } label: {
                    HStack {
                        if chances.isRunning { ProgressView().tint(Theme.canvas) }
                        Text(estimateLabel)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.forgePrimary)
                .disabled(chances.isBusy)
                if !chances.isRunning, let message = chances.metadata(for: store.workspace)?.staleNotice {
                    Text(message).font(.footnote).foregroundStyle(Theme.amber)
                }
            }
            .padding(.vertical, Theme.Spacing.xxs)
        } footer: {
            if chances.isRunning { Text("Keep Forge open until this finishes. It can take a few minutes.") }
        }
    }

    @ViewBuilder private var status: some View {
        if chances.isRunning, !chances.progress.isEmpty {
            ChancesProgress(fraction: chances.fraction, text: chances.progress)
        } else if let outcome = chances.outcome {
            Label(outcome.text, systemImage: outcome.isError ? "exclamationmark.circle" : "checkmark.circle")
                .font(.footnote)
                .foregroundStyle(outcome.isError ? Theme.danger : Theme.success)
        }
    }
}

/// The estimate's progress: a thin bar with the percent, and what it's doing now.
struct ChancesProgress: View {
    let fraction: Double
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
            HStack(spacing: Theme.Spacing.xs) {
                ProgressView(value: max(0.03, fraction))
                    .tint(Theme.coral)
                    .animation(.easeOut, value: fraction)
                Text("\(Int((fraction * 100).rounded()))%")
                    .font(.forgeNumber(.caption))
                    .foregroundStyle(Theme.muted)
                    .frame(minWidth: 36, alignment: .trailing)
            }
            Text(text)
                .font(.footnote)
                .foregroundStyle(Theme.muted)
                .lineLimit(2)
                .contentTransition(.opacity)
                .animation(.easeOut, value: text)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Estimating your chances")
        .accessibilityValue("\(Int((fraction * 100).rounded())) percent. \(text)")
    }
}

/// Why the estimate is what it is: summary, factors, sources and date.
struct ShortlistOddsSheet: View {
    let name: String
    let odds: AdmissionOdds
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(odds.percent)%").font(.forgeDisplay(.largeTitle)).monospacedDigit().foregroundStyle(Theme.ink)
                        Text("Likely range \(odds.low)–\(odds.high)% · from \(odds.baselineSource)")
                            .font(.subheadline)
                            .foregroundStyle(Theme.muted)
                    }
                    if !odds.summary.isEmpty {
                        Text(odds.summary).font(.body).foregroundStyle(Theme.body)
                    }
                }
                if !odds.factors.isEmpty {
                    Section("What moved it") {
                        ForEach(Array(odds.factors.enumerated()), id: \.offset) { _, factor in
                            FactorRow(factor: factor)
                        }
                    }
                }
                let links = odds.sources.compactMap { $0.hasPrefix("https://") ? URL(string: $0) : nil }
                if !links.isEmpty {
                    Section("Sources") {
                        ForEach(links, id: \.self) { url in
                            Link(destination: url) {
                                Label(CollegesFormat.host(url.absoluteString), systemImage: "link")
                            }
                        }
                    }
                }
                Section {
                } footer: {
                    Text("Estimated \(String(odds.estimatedAt.prefix(10))). A rough guide, not a prediction.")
                }
            }
            .navigationTitle(name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}

private struct FactorRow: View {
    let factor: OddsFactor

    private var mark: (String, Color, String) {
        switch factor.effect {
        case "up": ("arrow.up.circle.fill", Theme.success, "Raises")
        case "down": ("arrow.down.circle.fill", Theme.danger, "Lowers")
        default: ("minus.circle.fill", Theme.mutedSoft, "Neutral")
        }
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
            Image(systemName: mark.0).foregroundStyle(mark.1).accessibilityLabel(mark.2)
            VStack(alignment: .leading, spacing: 2) {
                Text(factor.label).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                if !factor.detail.isEmpty {
                    Text(factor.detail).font(.subheadline).foregroundStyle(Theme.body)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}
