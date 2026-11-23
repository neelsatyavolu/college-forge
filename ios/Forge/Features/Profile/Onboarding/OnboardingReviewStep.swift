import SwiftUI

/// Everything entered, before the hub is built.
struct OnboardingReviewStep: View {
    let answers: OnboardingAnswers
    let mustInclude: [College]
    let uploads: [OnboardingUpload]

    var body: some View {
        let p = answers.prefs
        Form {
            Section {
                Text("Confirm your answers to save your profile and build a starting list from college data and your preferences. Fit labels are estimates, not admission or cost guarantees.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.body)
            }
            Section("You") {
                LabeledValueRow(label: "Name", value: answers.name)
                LabeledValueRow(label: "Grad year", value: answers.gradYear)
                LabeledValueRow(label: "High school", value: answers.hs)
                LabeledValueRow(label: "Intended major", value: answers.intended)
                LabeledValueRow(label: "Location", value: answers.location)
            }
            Section("Academics") {
                LabeledValueRow(label: "GPA (W)", value: answers.gpaWeighted)
                LabeledValueRow(label: "GPA (UW)", value: answers.gpaUnweighted)
                LabeledValueRow(label: "SAT", value: answers.testOptional ? "Test optional" : answers.sat)
            }
            Section("Story") {
                LabeledValueRow(label: "Activities", value: lines(answers.story.activities))
                LabeledValueRow(label: "Awards", value: lines(answers.story.awards))
                LabeledValueRow(label: "Other notes", value: answers.story.other.profileTrimmed.isEmpty ? "" : "Added")
            }
            Section("College list") {
                LabeledValueRow(label: "Strategy", value: OnboardingOptions.title(p.ambition, in: OnboardingOptions.ambition))
                LabeledValueRow(label: "Applications", value: p.appCount.map { "\($0)" } ?? "Auto, about 12")
                LabeledValueRow(label: "Setting", value: titles(p.settings, OnboardingOptions.settings))
                LabeledValueRow(label: "Size", value: OnboardingOptions.title(p.size, in: OnboardingOptions.sizes))
                LabeledValueRow(label: "Regions", value: titles(p.regions, OnboardingOptions.regions))
                LabeledValueRow(label: "Must-include", value: mustInclude.isEmpty ? "None" : mustInclude.map { $0.short.isEmpty ? $0.name : $0.short }.joined(separator: ", "))
                if !p.notes.profileTrimmed.isEmpty {
                    LabeledValueRow(label: "Notes", value: p.notes)
                }
            }
            Section("Documents") {
                LabeledValueRow(label: "Uploads", value: uploads.isEmpty ? "None" : uploads.map(\.name).joined(separator: ", "))
            }
        }
    }

    private func lines(_ text: String) -> String {
        let n = OnboardingAnswers.lineCount(text)
        return n == 0 ? "None yet" : "\(n) line\(n == 1 ? "" : "s")"
    }

    private func titles(_ ids: [String], _ options: [OnboardingOptions.Choice]) -> String {
        ids.isEmpty ? "Any" : ids.map { OnboardingOptions.title($0, in: options) }.joined(separator: ", ")
    }
}
