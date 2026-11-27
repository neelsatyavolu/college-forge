import SwiftUI

/// "Rebuild hub": the AI re-researches deadlines and this year's prompts for every school still missing them,
/// then balances rounds and sets milestones, from answers already saved. Mirrors `runPlanSteps` in
/// public/hub/Onboarding.jsx and the Settings panel that runs it.
@MainActor
@Observable
final class HubRebuildModel {
    private(set) var running = false
    private(set) var log = ""
    private(set) var message: String?
    var error: String?

    @ObservationIgnored private var queue: [SetupBuildStep] = []
    @ObservationIgnored private var failed: [String] = []
    @ObservationIgnored private var finishedCount = 0

    func run(store: WorkspaceStore, ai: MoreAIClient) async {
        guard !running else { return }
        error = nil
        message = nil
        do {
            let status = try await ai.status()
            guard status.codexConnected || status.grokConnected || status.opencodeAvailable else {
                error = "Connect an AI provider in More › AI providers to rebuild your hub."
                return
            }
        } catch {
            self.error = APIError.wrap(error).message
            return
        }
        running = true
        log = "Starting…"
        defer { running = false; log = "" }
        do {
            let plan = try await store.api.setupBuildPlan()
            let steps = plan.schools ?? []
            queue = steps
            failed = []
            finishedCount = 0
            async let a: Void = worker(ai: ai, total: steps.count)
            async let b: Void = worker(ai: ai, total: steps.count)
            async let c: Void = worker(ai: ai, total: steps.count)
            _ = await (a, b, c)
            if !steps.isEmpty, failed.count == steps.count {
                throw MoreChatError("The AI couldn't research any schools. Check your AI connection and try again.")
            }
            for step in [plan.rounds, plan.milestones].compactMap({ $0 }) {
                try await ai.setupStream([.init(role: "user", content: step.prompt)], mode: nil) { event in
                    if let line = Self.progress(event) { log = "\(step.label): \(line)" }
                }
            }
            log = "Loading your hub…"
            await store.refresh()
            await store.refreshApplications()
            message = failed.isEmpty
                ? "Hub rebuilt. Check Deadlines for dates and Essays for prompts."
                : "Hub rebuilt, but the AI couldn't finish \(failed.joined(separator: ", ")). Rebuild again to retry just those."
            Haptics.success()
        } catch {
            self.error = (error as? MoreChatError)?.message ?? APIError.wrap(error).message
            Haptics.error()
        }
    }

    private func worker(ai: MoreAIClient, total: Int) async {
        while !queue.isEmpty {
            let step = queue.removeFirst()
            do {
                try await ai.setupStream([.init(role: "user", content: step.prompt)], mode: nil) { event in
                    if let line = Self.progress(event) { log = "Schools \(finishedCount) of \(total) done · \(step.label): \(line)" }
                }
            } catch {
                failed.append(step.label)
            }
            finishedCount += 1
        }
    }

    private static func progress(_ event: SetupChatEvent) -> String? {
        switch event {
        case .status(let message): message.isEmpty ? "Working…" : message
        case .tool(let name, let path): MoreChatStatus.tool(name, path: path)
        case .done: "Finishing up…"
        default: nil
        }
    }
}

/// The Profile row that runs a rebuild, with live progress.
struct HubRebuildSection: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(SessionModel.self) private var session
    @State private var model = HubRebuildModel()

    var body: some View {
        Section {
            Button {
                Haptics.tap()
                Task { await model.run(store: store, ai: MoreAIClient(api: store.api, accountEmail: session.user?.email ?? "")) }
            } label: {
                HStack {
                    Label(model.running ? "Rebuilding…" : "Rebuild hub", systemImage: "wand.and.stars")
                    if model.running { Spacer(); ProgressView() }
                }
            }
            .disabled(model.running)
            if !model.log.isEmpty {
                Text(model.log).font(.footnote).foregroundStyle(Theme.body).contentTransition(.opacity)
            }
            if let error = model.error {
                Text(error).font(.footnote).foregroundStyle(Theme.danger)
            } else if let message = model.message {
                Text(message).font(.footnote).foregroundStyle(Theme.body)
            }
        } footer: {
            Text("Have the AI rebuild your plan from the answers you already saved. It fills in deadlines, milestones and this year's essay prompts. Your school list, edits and drafts are kept. This takes a few minutes; keep the app open.")
        }
    }
}
