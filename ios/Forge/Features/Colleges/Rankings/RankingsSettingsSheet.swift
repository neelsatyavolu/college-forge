import SwiftUI

/// Target majors, weights and adjustments. Changes re-rank right away and are saved with the student’s list, shared with the website.
struct RankingsSettingsSheet: View {
    let response: RankingsResponse
    @Environment(RankingsModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                if current.signedIn { RankingsAiImportSection(response: current) }
                if response.isPath { majorsSection }
                weightsSection
                adjustmentsSection
                Section {
                    Button("Reset weights and adjustments", role: .destructive) {
                        Haptics.selection()
                        model.resetSettings(defaults: current.defaults)
                    }
                }
            }
            .navigationTitle("Adjust the ranking")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .forgeScreenBackground()
        }
    }

    private var current: RankingsResponse { model.response ?? response }

    private var majorsSection: some View {
        Section {
            FlowLayout(spacing: Theme.Spacing.xs) {
                ForEach(current.majors) { major in
                    let isOn = current.targets.contains(major.key)
                    Button {
                        Haptics.selection()
                        model.toggleTarget(major.key, current: model.request.targets ?? current.targets, order: current.majors.map(\.key))
                    } label: {
                        Label(major.label, systemImage: isOn ? "checkmark" : "plus")
                            .font(.subheadline)
                            .padding(.horizontal, Theme.Spacing.sm)
                            .padding(.vertical, 7)
                            .foregroundStyle(isOn ? Theme.canvas : Theme.body)
                            .background(isOn ? Theme.accent : Theme.fill, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(isOn ? .isSelected : [])
                }
            }
            .padding(.vertical, Theme.Spacing.xxs)
        } header: {
            Text("Majors you want to end up in")
        } footer: {
            Text("Each school is scored on the one you can reach where it does best. A major you applied to counts directly. Otherwise it counts if switching in after you enroll is open, has a grade bar, or admits most applicants.")
        }
    }

    private var weightsSection: some View {
        let weights = model.weights(defaults: current.defaults.weights)
        let total = max(1, current.pillars.reduce(0) { $0 + (weights[$1.key] ?? 0) })
        return Section("Weights") {
            ForEach(current.pillars) { pillar in
                let value = weights[pillar.key] ?? 0
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(pillar.label).font(.subheadline.weight(.medium))
                        Text(pillar.sub).font(.caption).foregroundStyle(Theme.muted)
                        Spacer()
                        Text("\(Int((100 * value / total).rounded()))%").font(.forgeNumber(.subheadline)).foregroundStyle(Theme.ink)
                    }
                    Slider(value: Binding(
                        get: { value },
                        set: { model.setWeight(pillar.key, to: $0, current: weights) }
                    ), in: 0...50, step: 5)
                    .tint(Theme.accent)
                    .accessibilityLabel(pillar.label)
                }
            }
        }
    }

    private var adjustmentsSection: some View {
        let flags = model.flags(current: current.flags)
        return Section {
            Toggle("Adjust pay for cost of living", isOn: Binding(get: { flags.col }, set: { var f = flags; f.col = $0; model.setFlags(f) }))
            Toggle("Adjust for who gets in", isOn: Binding(get: { flags.va }, set: { var f = flags; f.va = $0; model.setFlags(f) }))
            Toggle("Count competitive switches", isOn: Binding(get: { flags.stretch }, set: { var f = flags; f.stretch = $0; model.setFlags(f) }))
        } footer: {
            Text("Who gets in compares each school’s pay with what its admit rate predicts. Competitive switches also count majors that need a competitive application after you enroll; long shots never count.")
        }
        .tint(Theme.accent)
    }
}

/// How the ranking is built, in short.
struct RankingsMethodSheet: View {
    let total: Int
    @Environment(\.dismiss) private var dismiss

    private let parts: [(String, String)] = [
        ("Typical pay", "Median pay 1, 4, 5 and 7 years after graduating, from IRS records in the College Scorecard, in the major counted for each school, compared with the same major elsewhere."),
        ("Getting rich", "Top-quarter pay 10 years after starting, and the share of students from middle- and upper-income families who reach the top 1% of earners (Opportunity Insights)."),
        ("Employer pull", "U.S. News rank, QS’s employer survey, LinkedIn’s career-outcomes list, Wall Street and Big Tech hiring, and finance, tech and consulting jobs nearby."),
        ("Jobs", "The share of graduates who are neither working nor in school, and the graduation rate."),
        ("Earnings floor", "Bottom-quarter pay 10 years after starting."),
        ("Campus life", "Niche’s campus, dorm and food grades, with their cost share added back."),
    ]

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("One question: if you went here, how well set up would you be for a good career? Career counts 75% and campus life 25% by default. Cost, aid and debt never count. Each school is scored on the major you can actually reach there where it does best, compared with the same major at the other \(max(0, total - 1)) schools.")
                        .font(.callout)
                }
                Section("What counts") {
                    ForEach(parts, id: \.0) { part in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(part.0).font(.subheadline.weight(.semibold))
                            Text(part.1).font(.footnote).foregroundStyle(Theme.muted)
                        }
                        .padding(.vertical, 2)
                    }
                }
                Section {
                    Text("A rank of T-N means schools within a few points share a place. The small range under a rank is where the school lands if any one career measure is dropped.")
                        .font(.footnote)
                        .foregroundStyle(Theme.muted)
                }
            }
            .navigationTitle("How it works")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .forgeScreenBackground()
        }
    }
}
