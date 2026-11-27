import Foundation

/// The Decision board and its AI picks. Nothing here lives in the store; the board screen calls these directly.
extension APIClient {
    func decisionBoard() async throws -> DecisionBoardResponse {
        try await get("/api/decisions/board")
    }

    func decisionPlan() async throws -> DecisionPlanResponse {
        try await get("/api/ai/decision-plan")
    }
}

extension MoreAIClient {
    /// Runs the picks request in chat mode "decision", where saving picks is the only tool the AI has.
    /// Goes through the copilot client so the account's ChatGPT or Grok sign-in cookies are sent.
    func decisionRunPicks(_ prompt: String, provider: MoreAIProvider?, onProgress: @Sendable (String) async -> Void) async throws {
        let bytes = try await chat([ChatTurn(role: "user", content: prompt)], provider: provider, model: nil, mode: "decision")
        do {
            for try await line in bytes.lines {
                guard let data = line.data(using: .utf8),
                      let event = try? JSONDecoder().decode(CollegesChatEvent.self, from: data) else { continue }
                switch event.type {
                case "status": await onProgress(event.message.isEmpty ? "Working…" : event.message)
                case "tool": await onProgress("Saving your picks…")
                case "error": throw APIError.server(status: 200, message: event.message.isEmpty ? "Something went wrong while comparing." : event.message)
                default: continue
                }
            }
        } catch {
            throw APIError.wrap(error)
        }
    }
}
