import SwiftUI

/// How the preliminary list should be built: strategy, count, setting, size, regions, must-includes, notes.
struct OnboardingPrefsStep: View {
    @Binding var answers: OnboardingAnswers
    @Binding var mustInclude: [College]

    var body: some View {
        Form {
            Section {
                ForEach(OnboardingOptions.ambition) { option in
                    Button {
                        answers.prefs.ambition = option.id
                        Haptics.selection()
                    } label: {
                        ChoiceRow(title: option.title, blurb: option.blurb, isOn: answers.prefs.ambition == option.id)
                    }
                    .tint(Theme.ink)
                }
            } header: {
                Text("Strategy")
            } footer: {
                Text("You'll review everything after the list is built.")
            }

            Section {
                Picker("Applications", selection: $answers.prefs.appCount) {
                    Text("Auto (about 12)").tag(Int?.none)
                    ForEach(OnboardingOptions.appCounts, id: \.self) { n in
                        Text(n == 12 ? "12 (recommended)" : "\(n)").tag(Int?.some(n))
                    }
                }
            } header: {
                Text("How many applications?")
            } footer: {
                Text("Count applications, not campuses. All University of California campuses share one UC Application, so 9 UCs count as 1.")
            }

            MultiChoiceSection(title: "Campus setting", options: OnboardingOptions.settings,
                               selected: answers.prefs.settings) { answers.toggleSetting($0) }

            Section("School size") {
                Picker("Size", selection: $answers.prefs.size) {
                    ForEach(OnboardingOptions.sizes) { Text($0.title).tag($0.id) }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }

            MultiChoiceSection(title: "Regions", options: OnboardingOptions.regions,
                               selected: answers.prefs.regions) { answers.toggleRegion($0) }

            OnboardingMustIncludeSection(selected: $mustInclude)

            Section {
                TextField("Strong CS, need-based aid, within 6 hours of home", text: $answers.prefs.notes, axis: .vertical)
                    .lineLimit(3...8)
            } header: {
                Text("Other list constraints")
            } footer: {
                Text("Majors, cost, distance from home, public only, and so on.")
            }
        }
    }
}

private struct ChoiceRow: View {
    let title: String
    var blurb = ""
    let isOn: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body.weight(.medium)).foregroundStyle(Theme.ink)
                if !blurb.isEmpty {
                    Text(blurb).font(.footnote).foregroundStyle(Theme.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "checkmark")
                .font(.body.weight(.semibold))
                .foregroundStyle(Theme.accent)
                .opacity(isOn ? 1 : 0)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

private struct MultiChoiceSection: View {
    let title: String
    let options: [OnboardingOptions.Choice]
    let selected: [String]
    let toggle: (String) -> Void

    var body: some View {
        Section {
            ForEach(options) { option in
                Button {
                    toggle(option.id)
                    Haptics.selection()
                } label: {
                    ChoiceRow(title: option.title, isOn: selected.contains(option.id))
                }
                .tint(Theme.ink)
            }
        } header: {
            Text(title)
        } footer: {
            Text(selected.isEmpty ? "Any. Pick as many as you like." : "Pick as many as you like.")
        }
    }
}
