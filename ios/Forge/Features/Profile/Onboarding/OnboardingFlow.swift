import SwiftUI

/// Whether the first-run setup should cover the app: the workspace has loaded and is still new
/// (`needsOnboarding` in lib/store.ts).
enum OnboardingGate {
    @MainActor
    static func shouldPresent(_ store: WorkspaceStore) -> Bool {
        store.hasLoaded && store.workspace.needsOnboarding
    }
}

extension View {
    /// Covers this view with the setup wizard while `OnboardingGate.shouldPresent` is true.
    /// Attach once, to the signed-in root (MainTabView).
    func onboardingCover() -> some View {
        modifier(OnboardingCoverModifier())
    }
}

private struct OnboardingCoverModifier: ViewModifier {
    @Environment(WorkspaceStore.self) private var store

    func body(content: Content) -> some View {
        content.fullScreenCover(isPresented: Binding(get: { OnboardingGate.shouldPresent(store) }, set: { _ in })) {
            OnboardingFlow(canCancel: false)
        }
    }
}

/// The setup wizard: basics, academics, story, list preferences, documents, then build.
struct OnboardingFlow: View {
    /// True when re-run from Profile; first-run setup can't be skipped.
    var canCancel = false

    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var step = OnboardingStep.welcome
    @State private var answers = OnboardingAnswers()
    @State private var mustInclude: [College] = []
    @State private var uploads: [OnboardingUpload] = []
    @State private var loaded = false
    @State private var building = false
    @State private var shownError: String?
    @State private var buildError: APIError?

    var body: some View {
        NavigationStack {
            stepContent
                .forgeScreenBackground()
                .navigationTitle(step == .welcome ? "" : step.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { toolbar }
                .safeAreaInset(edge: .top, spacing: 0) { OnboardingProgressBar(step: step) }
                .safeAreaInset(edge: .bottom, spacing: 0) { footer }
                .animation(.snappy, value: step)
        }
        .interactiveDismissDisabled(!canCancel || building)
        .onAppear(perform: prefill)
        .errorAlert($buildError, title: "Couldn't save your answers")
    }

    @ViewBuilder private var stepContent: some View {
        switch step {
        case .welcome: OnboardingWelcomeStep()
        case .identity: OnboardingIdentityStep(answers: $answers)
        case .academics: OnboardingAcademicsStep(answers: $answers)
        case .story: OnboardingStoryStep(story: $answers.story)
        case .prefs: OnboardingPrefsStep(answers: $answers, mustInclude: $mustInclude)
        case .documents: OnboardingDocumentsStep(uploads: $uploads)
        case .review: OnboardingReviewStep(answers: answers, mustInclude: mustInclude, uploads: uploads)
        }
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        if canCancel && !building {
            ToolbarItem(placement: .cancellationAction) {
                Button("Close") { dismiss() }
            }
        }
    }

    private var footer: some View {
        VStack(spacing: Theme.Spacing.xs) {
            if let shownError {
                Text(shownError)
                    .font(.footnote)
                    .foregroundStyle(Theme.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(spacing: Theme.Spacing.sm) {
                if step != .welcome {
                    Button("Back", action: back)
                        .buttonStyle(.forgeSecondary)
                        .disabled(building)
                }
                if step == .review {
                    PrimaryButton(title: "Build my hub", isLoading: building, action: build)
                } else {
                    Button(action: next) {
                        Text(nextTitle).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.forgePrimary)
                }
            }
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, Theme.Spacing.sm)
        .background(.bar)
    }

    private var nextTitle: String {
        switch step {
        case .welcome: "Get started"
        case .documents: uploads.isEmpty ? "Skip" : "Continue"
        default: "Continue"
        }
    }

    private func prefill() {
        guard !loaded else { return }
        let ws = store.workspace
        answers = OnboardingAnswers(workspace: ws)
        let priority = ws.colleges.filter { $0.priority == true }
        mustInclude = Array((priority.isEmpty ? ws.colleges : priority).prefix(5))
        uploads = ws.uploads.map { OnboardingUpload(name: $0.name, chars: $0.chars) }
        loaded = true
    }

    private func next() {
        if let error = answers.error(for: step) {
            shownError = error
            Haptics.warning()
            return
        }
        shownError = nil
        if let following = OnboardingStep(rawValue: step.rawValue + 1) { step = following }
    }

    private func back() {
        shownError = nil
        if let previous = OnboardingStep(rawValue: step.rawValue - 1) { step = previous }
    }

    private func build() {
        if let error = answers.error(for: .review) {
            shownError = "\(error) Go back and fill them in."
            Haptics.warning()
            return
        }
        building = true
        Task {
            defer { building = false }
            do {
                try await store.postAction("complete-onboarding", fields: answers.completionFields)
                Haptics.success()
                if canCancel { dismiss() }
            } catch {
                buildError = APIError.wrap(error)
                Haptics.error()
            }
        }
    }
}

/// A thin bar with the step count, under the navigation bar.
private struct OnboardingProgressBar: View {
    let step: OnboardingStep

    var body: some View {
        let total = OnboardingStep.allCases.count
        VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
            ProgressView(value: Double(step.rawValue + 1), total: Double(total))
                .tint(Theme.accent)
            Text("Step \(step.rawValue + 1) of \(total)")
                .font(.forgeNumber(.caption))
                .foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, Theme.Spacing.xs)
        .background(Theme.canvas)
        .accessibilityElement(children: .combine)
    }
}
