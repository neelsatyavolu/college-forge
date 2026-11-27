import Foundation

/// A research request the server wants run for one school (lib/research-plan.ts `ResearchStep`).
struct SetupResearchStep: Decodable, Hashable, Sendable {
    var slug: String
    var name: String
    var prompt: String
}

/// How far a school's research got, read from the workspace's colleges.
struct SetupResearchState: Hashable, Sendable {
    var slug: String
    var name: String
    var complete: Bool
    var needsReview: Bool
    var facts: Int
}

/// One step of the timeline build (lib/build-plan.ts `BuildStep`).
struct SetupBuildStep: Decodable, Hashable, Sendable {
    var label: String
    var prompt: String
}

struct SetupBuildPlan: Decodable, Sendable {
    var schools: [SetupBuildStep]?
    var rounds: SetupBuildStep?
    var milestones: SetupBuildStep?
}

/// Calls the setup chat makes besides `/api/ai/chat`.
extension APIClient {
    /// POST /api/ai/research-plan. "start" copies curated research and lists the steps; "attempt" counts one.
    func setupResearchSteps(action: String, slug: String? = nil) async throws -> [SetupResearchStep] {
        struct Reply: Decodable {
            var steps: [Lossy<SetupResearchStep>]?
            var error: String?
        }
        var body: [String: JSONValue] = ["action": .string(action)]
        if let slug { body["slug"] = .string(slug) }
        let reply = try await post("/api/ai/research-plan", body: body, as: Reply.self)
        if let error = reply.error, !error.isEmpty { throw APIError.server(status: 400, message: error) }
        return (reply.steps ?? []).compactMap(\.value)
    }

    /// GET /api/ai/build-plan: the round and milestone requests that finish setup.
    func setupBuildPlan() async throws -> SetupBuildPlan {
        try await get("/api/ai/build-plan")
    }

    /// Research progress per school. The app's `College` model doesn't carry research, so this reads it alone.
    func setupResearchStates() async throws -> [SetupResearchState] {
        struct Snapshot: Decodable {
            struct Entry: Decodable {
                struct Research: Decodable {
                    var complete: Bool?
                    var needsReview: Bool?
                    var facts: [JSONValue]?
                }
                var slug: String
                var name: String?
                var short: String?
                var research: Research?
            }
            var colleges: [Lossy<Entry>]
        }
        let snapshot = try await get("/api/workspace", as: Snapshot.self)
        return snapshot.colleges.compactMap(\.value).map { c in
            SetupResearchState(
                slug: c.slug,
                name: (c.short?.isEmpty == false ? c.short : c.name) ?? c.slug,
                complete: c.research?.complete == true,
                needsReview: c.research?.needsReview == true,
                facts: c.research?.facts?.count ?? 0
            )
        }
    }

    /// PATCH /api/workspace with a raw body, for fields `WorkspacePatch` doesn't model (the quick-start form).
    func setupPatch(_ body: [String: JSONValue]) async throws {
        _ = try await patch("/api/workspace", body: body, as: DataEnvelope<Workspace>.self)
    }
}

extension MoreAIClient {
    /// Streams one `/api/ai/chat` request with the student's provider choice, calling `onEvent` for each event.
    /// Throws on an error event or a stream that ends before `done`.
    @MainActor
    func setupStream(_ messages: [ChatTurn], mode: String?, onEvent: (SetupChatEvent) -> Void) async throws {
        let prefs = MoreAIPreferences.load()
        let provider = prefs.preferred.flatMap { $0.canConnect ? $0 : nil }
        var model: String?
        if let provider, let s = try? await status() { model = prefs.model(for: provider, in: s) }
        let bytes = try await chat(messages, provider: provider, model: model, mode: mode)
        var failure: String?
        var finished = false
        for try await line in bytes.lines {
            guard let event = SetupChatEvent.parse(line) else { continue }
            if case .error(let message) = event { failure = message }
            if case .done = event { finished = true }
            onEvent(event)
        }
        if let failure { throw MoreChatError(failure) }
        if !finished { throw MoreChatError("The connection ended before the reply finished.") }
    }
}
