import SwiftUI

/// Add or edit one activity, with the Common App 150-character counter.
struct ActivityEditorSheet: View {
    let initial: Activity
    let number: Int
    let onSave: (Activity) async throws -> Void

    @State private var activity = Activity()
    @State private var accomplishments = ""
    @State private var loaded = false

    var body: some View {
        ProfileEditSheet(title: initial.name.isEmpty ? "Activity \(number)" : initial.name,
                         canSave: ProfileRules.activityError(result) == nil,
                         save: { try await onSave(result) }) {
            Section {
                ProfileLabeledField(label: "Name", text: $activity.name, prompt: "Debate team")
                ProfileLabeledField(label: "Type", text: $activity.type, prompt: "Debate/Speech")
                ProfileLabeledField(label: "Organization", text: optional(\.org), prompt: "Lincoln High")
                ProfileLabeledField(label: "Your role", text: optional(\.role), prompt: "Captain")
                ProfileLabeledField(label: "Grades", text: optional(\.years), prompt: "9, 10, 11, 12")
            }
            Section {
                ProfileLabeledField(label: "Hours per week", text: optional(\.hpw), prompt: "8", keyboard: .decimalPad)
                ProfileLabeledField(label: "Weeks per year", text: optional(\.wpy), prompt: "30", keyboard: .decimalPad)
                Toggle("Continue in college", isOn: Binding(get: { activity.college ?? false }, set: { activity.college = $0 }))
            } footer: {
                if let e = timeError { Text(e).foregroundStyle(Theme.danger) }
            }
            Section {
                TextField("What you did and what came of it", text: optional(\.desc), axis: .vertical)
                    .lineLimit(3...8)
            } header: {
                Text("Short description")
            } footer: {
                ProfileDescriptionCounter(text: activity.desc ?? "")
            }
            Section {
                TextField("One per line", text: $accomplishments, axis: .vertical)
                    .lineLimit(3...10)
            } header: {
                Text("Additional accomplishments")
            } footer: {
                Text("Keep details here while you refine the short description.")
            }
        }
        .onAppear {
            guard !loaded else { return }
            activity = initial
            accomplishments = (initial.bullets ?? []).joined(separator: "\n")
            loaded = true
        }
    }

    /// The activity as it will be saved.
    private var result: Activity {
        var a = activity
        a.name = a.name.profileTrimmed
        a.bullets = ProfileRules.lines(accomplishments)
        return a
    }

    private var timeError: String? {
        ProfileRules.amountError(activity.hpw, label: "Hours per week", max: 168)
            ?? ProfileRules.amountError(activity.wpy, label: "Weeks per year", max: 52)
    }

    private func optional(_ key: WritableKeyPath<Activity, String?>) -> Binding<String> {
        Binding(get: { activity[keyPath: key] ?? "" }, set: { activity[keyPath: key] = $0 })
    }
}

/// "132/150 characters", red when over.
struct ProfileDescriptionCounter: View {
    let text: String

    var body: some View {
        let remaining = ProfileRules.descriptionRemaining(text)
        HStack {
            Text(remaining < 0 ? "\(-remaining) over the Common App limit" : "Common App limit")
            Spacer()
            Text("\(text.count)/\(ProfileRules.descriptionLimit)")
                .font(.forgeNumber(.footnote, weight: .semibold))
        }
        .foregroundStyle(remaining < 0 ? Theme.danger : remaining <= 15 ? Theme.amber : Theme.muted)
        .accessibilityElement(children: .combine)
    }
}
