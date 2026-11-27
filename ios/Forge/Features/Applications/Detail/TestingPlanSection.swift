import SwiftUI

/// Whether to send SAT/ACT scores to this school: the sourced policy, Forge's suggestion and the student's
/// plan, method, official send date and AP self-report. Mirrors public/hub/TestingPlan.jsx.
struct TestingPlanSection: View {
    let app: TrackedApplication
    @Environment(WorkspaceStore.self) private var store
    @State private var error: APIError?

    var body: some View {
        if let plan = app.testingPlan {
            Section {
                VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                    Text(plan.recommendation.label)
                        .font(.headline)
                        .foregroundStyle(tone(plan.recommendation.advice))
                    if !plan.recommendation.reason.isEmpty {
                        Text(plan.recommendation.reason)
                            .font(.subheadline)
                            .foregroundStyle(Theme.body)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.vertical, 2)
                Picker("Your plan", selection: Binding(get: { plan.choice.plan }, set: { save(TestingEdit(plan: $0)) })) {
                    ForEach(TestPlanChoice.allCases) { Text($0.label).tag($0) }
                }
                if plan.choice.plan == .send {
                    Picker("How", selection: Binding(get: { plan.choice.method?.rawValue ?? "" }, set: { save(TestingEdit(method: $0)) })) {
                        Text("Not chosen").tag("")
                        // A school that takes only official reports gets no self-report option.
                        ForEach(TestMethod.allCases.filter { $0 != .selfReport || plan.policy.selfReport != false }) { Text($0.label).tag($0.rawValue) }
                    }
                    if plan.choice.method == .official {
                        OptionalDateRow(
                            title: "Official scores sent",
                            date: Binding(get: { plan.choice.officialSent ?? "" }, set: { save(TestingEdit(officialSent: $0)) })
                        )
                    }
                }
                if plan.hasAps {
                    Toggle("AP scores self-reported", isOn: Binding(get: { plan.choice.apSelfReported ?? false }, set: { save(TestingEdit(apSelfReported: $0)) }))
                }
            } header: {
                Text("Testing plan")
            } footer: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(plan.policy.summary)
                    if !plan.policy.text.isEmpty { Text("“\(plan.policy.text)”") }
                    if let url = URL(string: plan.policy.sourceUrl), url.scheme == "https" || url.scheme == "http" {
                        Link("Source", destination: url)
                    }
                }
            }
            .errorAlert($error)
        }
    }

    private func tone(_ advice: String) -> Color {
        switch advice {
        case "send": Theme.success
        case "your_call": Theme.amber
        case "consider_withholding": Theme.coral
        default: Theme.ink
        }
    }

    private func save(_ testing: TestingEdit) {
        Task {
            do {
                try await store.updateApplication(id: app.id, ApplicationEdit(testing: testing))
                Haptics.success()
            } catch {
                self.error = APIError.wrap(error)
                Haptics.error()
            }
        }
    }
}
