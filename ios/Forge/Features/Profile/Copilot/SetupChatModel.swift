import Foundation
import Observation

/// One message in the setup chat. `board` marks where the research board sits in the thread.
struct SetupChatTurn: Identifiable, Hashable, Sendable {
    let id = UUID()
    var role: String
    var content: String
    var ui: InterviewUI?
    var board = false
}

/// One school on the research board.
struct SetupResearchCard: Identifiable, Hashable, Sendable {
    var slug: String
    var name: String
    var stage: String
    var facts: Int
    var note = ""
    var id: String { slug }
}

/// The onboarding interview: the student's own AI asks questions (tiles come from its tool calls), proposes
/// a list, researches each school while they watch, recommends an ED/EA plan, then builds the timeline.
/// Progress lives in the workspace, so closing the app resumes. Port of public/hub/OnboardingChat.jsx.
@MainActor
@Observable
final class SetupChatModel {
    /// nil while checking, then whether ChatGPT or Grok is connected.
    private(set) var aiConnected: Bool?
    private(set) var turns: [SetupChatTurn] = []
    private(set) var busy = false
    private(set) var status = ""
    private(set) var cards: [SetupResearchCard] = []
    private(set) var finished = false
    var error: String?

    @ObservationIgnored let store: WorkspaceStore
    @ObservationIgnored let ai: MoreAIClient
    @ObservationIgnored private var started = false

    init(store: WorkspaceStore, ai: MoreAIClient) {
        self.store = store
        self.ai = ai
        turns = Self.turns(from: store.workspace.onboarding.interview)
    }

    var interview: OnboardingInterview? { store.workspace.onboarding.interview }
    var phase: String { interview?.phase ?? "interview" }
    var section: String { interview?.section ?? "basics" }
    var composerLocked: Bool { busy || phase == "research" || phase == "plan" }

    /// Turns shown in the thread: messages Forge sent for the student are hidden.
    var shownTurns: [SetupChatTurn] {
        turns.filter { !($0.role == "user" && SetupChat.hidden.contains($0.content)) }
    }

    /// The turn whose tiles can still be answered: the last shown one, if it's the AI's.
    var liveTurnID: UUID? {
        guard phase != "research", let last = shownTurns.last, last.role == "assistant", last.ui != nil else { return nil }
        return last.id
    }

    static func turns(from interview: OnboardingInterview?) -> [SetupChatTurn] {
        (interview?.transcript ?? []).map { SetupChatTurn(role: $0.role, content: $0.content, ui: $0.ui) }
    }

    // MARK: Start

    func checkAI() async {
        do {
            let s = try await ai.status()
            aiConnected = s.codexConnected || s.grokConnected
        } catch {
            aiConnected = false
            self.error = APIError.wrap(error).message
        }
    }

    /// Starts or resumes the interview once the AI is connected.
    func startIfReady() async {
        guard aiConnected == true, !started else { return }
        started = true
        do {
            if interview == nil || interview?.phase == "done" {
                try await store.postAction("start-interview")
                turns = []
            }
            switch phase {
            case "research": await runResearch()
            case "plan": await runPlan()
            default: if interview?.transcript.isEmpty ?? true { await send(SetupChat.kickoff) }
            }
        } catch {
            started = false
            self.error = APIError.wrap(error).message
        }
    }

    // MARK: Sending

    /// Sends one student message and streams the reply. Returns true when the reply arrived.
    @discardableResult
    func send(_ raw: String) async -> Bool {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !busy, !text.isEmpty else { return false }
        error = nil
        busy = true
        status = "Thinking…"
        let history = turns + [SetupChatTurn(role: "user", content: text)]
        turns = history + [SetupChatTurn(role: "assistant", content: "")]
        var shownUI: InterviewUI?
        do {
            let request = history.suffix(SetupChat.historyLimit).map {
                MoreAIClient.ChatTurn(role: $0.role, content: $0.content.isEmpty ? "(shown as tiles)" : $0.content)
            }
            try await stream(Array(request), mode: "onboarding") { [weak self] event in
                guard let self else { return }
                switch event {
                case .status(let message): status = message
                case .delta(let chunk): updateReply { $0.content += chunk }
                default:
                    if let ui = event.ui {
                        shownUI = ui
                        updateReply { $0.ui = ui }
                    }
                }
            }
            await store.refresh()
            busy = false
            status = ""
            // The interview is done but the AI ended its turn without a list: ask for it once.
            if let iv = interview, iv.phase == "list", iv.listDraftCount == 0, !Self.isList(shownUI), text != SetupChat.showList {
                return await send(SetupChat.showList)
            }
            return true
        } catch {
            self.error = Self.message(error)
            turns = history
        }
        busy = false
        status = ""
        return false
    }

    private func updateReply(_ change: (inout SetupChatTurn) -> Void) {
        guard let i = turns.indices.last, turns[i].role == "assistant" else { return }
        change(&turns[i])
    }

    private static func isList(_ ui: InterviewUI?) -> Bool {
        if case .list = ui { return true }
        return false
    }

    private func stream(_ messages: [MoreAIClient.ChatTurn], mode: String?, onEvent: (SetupChatEvent) -> Void) async throws {
        try await ai.setupStream(messages, mode: mode, onEvent: onEvent)
    }

    private static func message(_ error: any Error) -> String {
        (error as? MoreChatError)?.message ?? APIError.wrap(error).message
    }

    // MARK: List

    func approve(keep: [String], drop: [String]) async {
        guard !busy else { return }
        busy = true
        error = nil
        do {
            try await store.postAction("apply-list", fields: [
                "keep": .array(keep.map(JSONValue.string)), "drop": .array(drop.map(JSONValue.string)),
            ])
            turns += [
                SetupChatTurn(role: "user", content: "Let's research these \(keep.count) schools."),
                SetupChatTurn(role: "assistant", content: "", board: true),
            ]
            busy = false
            await runResearch()
        } catch {
            self.error = Self.message(error)
            busy = false
        }
    }

    func revise(note: String, dropped: [String]) async {
        await send(SetupChat.reviseMessage(note, dropped: dropped))
    }

    // MARK: Research

    /// Researches each school while the student watches, three at a time; resumes where it stopped.
    func runResearch() async {
        busy = true
        error = nil
        status = "Researching your schools…"
        do {
            let steps = try await store.api.setupResearchSteps(action: "start")
            await store.refresh()
            let states = try await store.api.setupResearchStates()
            cards = states.map { SetupResearchCard(slug: $0.slug, name: $0.name, stage: Self.stage($0), facts: $0.facts) }
            researchQueue = steps
            researchRunning = []
            researchFailed = []
            async let a: Void = researchWorker()
            async let b: Void = researchWorker()
            async let c: Void = researchWorker()
            _ = await (a, b, c)
            let failed = researchFailed
            await store.refresh()
            busy = false
            status = ""
            if !failed.isEmpty {
                error = "Research didn't finish for \(failed.count) \(failed.count == 1 ? "school" : "schools") because the AI didn't answer."
                return
            }
            let ok = await send(SetupChat.researchDone)
            // The AI must answer with a recommendation; without one the phase can't move, so offer a retry.
            if ok, phase == "research" { error = "The AI didn't suggest an early plan yet." }
        } catch {
            self.error = Self.message(error)
            busy = false
            status = ""
        }
    }

    @ObservationIgnored private var researchQueue: [SetupResearchStep] = []
    @ObservationIgnored private var researchRunning: Set<String> = []
    @ObservationIgnored private var researchFailed: Set<String> = []

    /// Takes schools off the shared queue until it's empty (three run at once, like the web).
    private func researchWorker() async {
        while !researchQueue.isEmpty {
            let step = researchQueue.removeFirst()
            if researchRunning.contains(step.slug) { continue }
            researchRunning.insert(step.slug)
            let next = await research(step)
            researchRunning.remove(step.slug)
            switch next {
            case .none: researchFailed.insert(step.slug)
            case .some(.some(let again)): researchQueue.append(again)
            case .some(.none): break
            }
        }
    }

    /// Runs one school's research request. nil: the AI didn't answer (stays queued). `.some(step)`: run it
    /// again; `.some(nil)`: finished for now.
    private func research(_ step: SetupResearchStep) async -> SetupResearchStep?? {
        update(step.slug) { $0.stage = "searching" }
        do {
            try await stream([.init(role: "user", content: step.prompt)], mode: "research") { [weak self] event in
                switch event {
                case .tool(let name, _) where name == "web_fetch":
                    self?.update(step.slug) { $0.stage = "reading" }
                case .research(let slug, let stage, let facts):
                    self?.update(slug) { $0.stage = stage; $0.note = "\(facts) facts saved"; $0.facts = 0 }
                default: break
                }
            }
        } catch {
            // A failed AI call (rate limit, network) isn't an attempt: the school stays queued for "Try again".
            update(step.slug) { $0.stage = "queued"; $0.note = "The AI didn't answer. It will retry." }
            return nil
        }
        let after = (try? await store.api.setupResearchSteps(action: "attempt", slug: step.slug)) ?? []
        if let again = after.first(where: { $0.slug == step.slug }) { return .some(again) }
        if let state = try? await store.api.setupResearchStates().first(where: { $0.slug == step.slug }) {
            update(step.slug) { $0.stage = Self.stage(state); $0.facts = state.facts; $0.note = "" }
        } else {
            update(step.slug) { $0.stage = "done"; $0.note = "" }
        }
        return .some(nil)
    }

    private func update(_ slug: String, _ change: (inout SetupResearchCard) -> Void) {
        guard let i = cards.firstIndex(where: { $0.slug == slug }) else { return }
        change(&cards[i])
    }

    private static func stage(_ s: SetupResearchState) -> String {
        s.complete ? "done" : s.needsReview ? "needs_review" : "queued"
    }

    // MARK: Plan

    /// After the student confirms the strategy: save it, then build rounds and the timeline.
    func confirmStrategy() async {
        guard await send(SetupChat.confirm) else { return }
        do {
            try await store.postAction("set-interview-phase", fields: ["phase": .string("plan"), "strategyConfirmed": .bool(true)])
        } catch {
            self.error = Self.message(error)
            return
        }
        await runPlan()
    }

    func runPlan() async {
        busy = true
        error = nil
        do {
            let plan = try await store.api.setupBuildPlan()
            for step in [plan.rounds, plan.milestones].compactMap({ $0 }) {
                status = "\(step.label)…"
                try await stream([.init(role: "user", content: step.prompt)], mode: nil) { _ in }
            }
            try await store.postAction("finish-onboarding")
            await store.refreshApplications()
            finished = true
        } catch {
            self.error = Self.message(error)
        }
        busy = false
        status = ""
    }

    /// What "Try again" does for the current phase.
    func retry() async {
        switch phase {
        case "research": await runResearch()
        case "plan": await runPlan()
        default: error = nil
        }
    }
}
