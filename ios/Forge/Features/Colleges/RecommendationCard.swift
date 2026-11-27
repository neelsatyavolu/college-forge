import SwiftUI

/// One recommended school: provisional category, career rank, earnings and price, reasons and cautions.
struct RecommendationCard: View {
    let recommendation: CollegesRecommendation

    @Environment(WorkspaceStore.self) private var store
    @Environment(Router.self) private var router
    @State private var showsCautions = false
    @State private var isSaving = false
    @State private var error: APIError?

    private var college: College { recommendation.college }
    private var fit: CollegesFit { recommendation.fit }
    private var evidence: CollegesEvidence { recommendation.evidence }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            header
            NavigationLink(value: CollegesDetailRoute(college: college)) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(college.name).font(.forgeDisplay(.title3)).foregroundStyle(Theme.ink)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Theme.mutedSoft)
                    }
                    Text([college.location, CollegesFormat.capitalized(college.setting)].compactMap { $0 }.joined(separator: " · "))
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                }
            }
            .buttonStyle(.plain)
            metrics
            reasons
            cautions
            actions
            Button("Ask AI") {
                router.openChat(prompt: "Use the recommendation evidence to explain whether \(college.name) fits my profile. Use the published evidence and flag uncertainty. Do not change my shortlist.")
            }
            .font(.subheadline.weight(.medium))
        }
        .forgeCard()
        .errorAlert($error)
    }

    private var header: some View {
        HStack {
            Badge(text: fit.label + (fit.tier != nil ? " · provisional" : " · needs info"), tone: fit.tier?.tone ?? Theme.mutedSoft)
            Spacer()
            if let rank = evidence.fairRank {
                Text("Career rank #\(rank)").font(.forgeNumber(.caption)).foregroundStyle(Theme.muted)
            }
        }
    }

    private var metrics: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.md) {
            metric(value: CollegesFormat.money(evidence.adjustedEarnings), label: "Purchasing-power earnings", note: "historical, 2024 dollars")
            metric(value: CollegesFormat.money(evidence.netPrice), label: "Average net price", note: "historical, after grants")
        }
        .padding(.vertical, Theme.Spacing.xxs)
    }

    private func metric(value: String, label: String, note: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.forgeNumber(.title3, weight: .semibold)).foregroundStyle(Theme.ink)
            Text(label).font(.caption.weight(.medium)).foregroundStyle(Theme.body)
            Text(note).font(.caption2).foregroundStyle(Theme.mutedSoft)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var reasons: some View {
        if !fit.reasons.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Eyebrow(text: "Why it’s here", tone: Theme.muted)
                ForEach(fit.reasons, id: \.self) { CollegesBullet(text: $0, tone: Theme.accent) }
            }
        }
    }

    private var cautions: some View {
        DisclosureGroup(isExpanded: $showsCautions) {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(fit.cautions, id: \.self) { CollegesBullet(text: $0, tone: Theme.amber) }
                if let low = evidence.rankLow, let high = evidence.rankHigh {
                    CollegesBullet(text: "Rank interval: \(low)–\(high). Overlapping intervals don’t support a precise ordering.", tone: Theme.amber)
                }
                CollegesBullet(text: "Net price is not your financial-aid offer. Check the school’s net price calculator.", tone: Theme.amber)
            }
            .padding(.top, Theme.Spacing.xs)
        } label: {
            Text("What to verify before applying").font(.subheadline.weight(.medium)).foregroundStyle(Theme.ink)
        }
        .tint(Theme.muted)
    }

    private var actions: some View {
        let saved = store.shortlistContains(college)
        return HStack(spacing: Theme.Spacing.sm) {
            Button {
                Task { await add() }
            } label: {
                Group {
                    if isSaving {
                        ProgressView().tint(Theme.canvas)
                    } else {
                        Label(saved ? "Saved" : "Add to shortlist", systemImage: saved ? "checkmark" : "plus")
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.forgePrimary)
            .disabled(saved || isSaving)
            if let url = URL(string: evidence.scorecardUrl), !evidence.scorecardUrl.isEmpty {
                Link(destination: url) {
                    Label("Scorecard", systemImage: "arrow.up.right.square").frame(maxWidth: .infinity)
                }
                .buttonStyle(.forgeSecondary)
            }
        }
        .padding(.top, Theme.Spacing.xxs)
    }

    private func add() async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await store.shortlistAdd(college)
            Haptics.success()
        } catch {
            self.error = APIError.wrap(error)
            Haptics.error()
        }
    }
}
