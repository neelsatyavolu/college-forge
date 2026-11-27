import SwiftUI

/// The draft list: drop or keep each school, then research the kept ones or ask for changes.
struct SetupListTiles: View {
    let schools: [InterviewSchool]
    let edIdea: InterviewEdIdea?
    let warning: String?
    let disabled: Bool
    let approve: (_ keep: [String], _ drop: [String]) -> Void
    let revise: (_ note: String, _ dropped: [String]) -> Void
    @State private var dropped: [String] = []
    @State private var note = ""

    private var kept: [InterviewSchool] { schools.filter { !dropped.contains($0.name) } }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            if let edIdea {
                VStack(alignment: .leading, spacing: 4) {
                    Eyebrow(text: "Early Decision idea")
                    Text(edIdea.school ?? "None for now").font(.headline).foregroundStyle(Theme.ink)
                    Text(edIdea.reason).font(.subheadline).foregroundStyle(Theme.body)
                }
                .padding(Theme.Spacing.sm)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.large, style: .continuous))
            }
            if let warning, !warning.isEmpty {
                Label(warning, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(Theme.amber)
            }
            Text("\(SetupChat.appCount(kept)) applications · \(SetupChat.mix(kept))")
                .font(.forgeNumber(.footnote)).foregroundStyle(Theme.muted)
            group("Write supplements", hint: "Essays for each school (all UC campuses share one set)", schools.filter { $0.supplements != "no" })
            group("No supplements", hint: "Common App or school application only", schools.filter { $0.supplements == "no" })
            PrimaryButton(title: "Research these \(kept.count)") {
                Haptics.tap()
                approve(kept.map(\.name), schools.filter { $0.current && dropped.contains($0.name) }.map(\.name))
            }
            .disabled(disabled || kept.isEmpty)
            HStack(spacing: Theme.Spacing.xs) {
                TextField("Or ask for changes, e.g. more schools on the East Coast", text: $note, axis: .vertical)
                    .lineLimit(1...4)
                    .textFieldStyle(.roundedBorder)
                Button("Ask") {
                    revise(note.trimmingCharacters(in: .whitespacesAndNewlines), dropped)
                    note = ""
                }
                .buttonStyle(.forgeSecondary)
                .fixedSize()
                .disabled(disabled || note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }

    @ViewBuilder
    private func group(_ title: String, hint: String, _ list: [InterviewSchool]) -> some View {
        if !list.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                HStack(alignment: .firstTextBaseline) {
                    Text(title).font(.headline).foregroundStyle(Theme.ink)
                    Text("\(SetupChat.appCount(list.filter { !dropped.contains($0.name) }))").font(.forgeNumber(.subheadline)).foregroundStyle(Theme.muted)
                }
                Text(hint).font(.caption).foregroundStyle(Theme.muted)
                ForEach(SetupChat.sortedByTier(list), id: \.name) { s in
                    SetupSchoolCard(school: s, dropped: dropped.contains(s.name), disabled: disabled) {
                        Haptics.selection()
                        if dropped.contains(s.name) { dropped.removeAll { $0 == s.name } } else { dropped.append(s.name) }
                    }
                }
            }
        }
    }
}

private struct SetupSchoolCard: View {
    let school: InterviewSchool
    let dropped: Bool
    let disabled: Bool
    let toggle: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(school.name).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).strikethrough(dropped)
                Spacer()
                Button(dropped ? "Keep" : "Drop", action: toggle).font(.subheadline).disabled(disabled)
            }
            HStack(spacing: 6) {
                Text(SetupChat.tierLabel(school.tier))
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 8).padding(.vertical, 2)
                    .background(tierColor.opacity(0.15), in: Capsule())
                    .foregroundStyle(tierColor)
                if let ai = school.aiTier, ai != school.tier { tag("Forge's data") }
                if school.current { tag("On your list") }
            }
            if !school.reason.isEmpty {
                Text(school.reason).font(.footnote).foregroundStyle(Theme.body)
            }
            let meta = [school.estChance.map { "Chance \($0)" },
                        school.netPrice.map { "Net \($0)\(school.fitsBudget == "no" ? " · over budget" : "")" }].compactMap { $0 }
            if !meta.isEmpty {
                Text(meta.joined(separator: "  ·  ")).font(.forgeNumber(.caption)).foregroundStyle(Theme.muted)
            }
        }
        .padding(Theme.Spacing.sm)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 0.5))
        .opacity(dropped ? 0.55 : 1)
    }

    private var tierColor: Color {
        switch school.tier {
        case "reach": Theme.coral
        case "likely": Theme.teal
        default: Theme.amber
        }
    }

    private func tag(_ text: String) -> some View {
        Text(text).font(.caption).foregroundStyle(Theme.muted)
    }
}

/// The AI's Early Decision / Early Action recommendation.
struct SetupStrategyTiles: View {
    let strategy: InterviewStrategy
    let disabled: Bool
    let confirm: () -> Void
    let change: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                LabeledValueRow(label: "Early Decision", value: strategy.ed ?? "None")
                LabeledValueRow(label: "Early Action", value: strategy.ea.isEmpty ? "None" : strategy.ea.joined(separator: ", "))
            }
            .forgeCard(padding: Theme.Spacing.sm)
            if !strategy.reasons.isEmpty {
                Text(strategy.reasons).font(.subheadline).foregroundStyle(Theme.body)
            }
            HStack(spacing: Theme.Spacing.xs) {
                SetupTile(label: "Sounds right", hint: "Save these rounds and build my timeline", action: confirm)
                SetupTile(label: "Change something", hint: "Tell the AI what you'd do differently", action: change)
            }
            .disabled(disabled)
        }
    }
}

/// Each school's research progress while the AI works through the list.
struct SetupResearchBoard: View {
    let cards: [SetupResearchCard]

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: Theme.Spacing.xs)], spacing: Theme.Spacing.xs) {
            ForEach(cards) { card in
                VStack(alignment: .leading, spacing: 4) {
                    Text(card.name).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(2)
                    HStack(spacing: 4) {
                        if ["searching", "reading", "saved"].contains(card.stage) { ProgressView().controlSize(.mini) }
                        if card.stage == "done" { Image(systemName: "checkmark.seal.fill").foregroundStyle(Theme.success) }
                        Text(SetupChat.stageLabel(card.stage)).font(.caption).foregroundStyle(Theme.muted)
                    }
                    Text(card.facts > 0 ? "\(card.facts) facts saved" : card.note.isEmpty ? " " : card.note)
                        .font(.forgeNumber(.caption2)).foregroundStyle(Theme.mutedSoft)
                        .lineLimit(2, reservesSpace: true)
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .padding(Theme.Spacing.sm)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 0.5))
                .accessibilityElement(children: .combine)
            }
        }
        .animation(.snappy, value: cards)
    }
}
