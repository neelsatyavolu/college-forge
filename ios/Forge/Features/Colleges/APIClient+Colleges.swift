import Foundation

/// College search, detail, recommendations and the chance-estimate AI steps. None of this lives in the
/// store, so screens call these directly through `store.api`.
extension APIClient {
    /// The Explore catalog (every 4-year public/nonprofit college with 1,000+ undergrads plus every
    /// U.S. News national and liberal arts school), with fit tags for this student.
    func collegesBrowse() async throws -> CollegesSearchResponse {
        try await get("/api/colleges/search", query: [URLQueryItem(name: "browse", value: "1")])
    }

    /// Search: the catalog first, then College Scorecard. Needs at least two characters.
    func collegesSearch(_ query: String) async throws -> CollegesSearchResponse {
        try await get("/api/colleges/search", query: [URLQueryItem(name: "q", value: query)])
    }

    /// The full record for one school, keyed by its College Scorecard id.
    func collegeDetail(scorecardId: Int) async throws -> CollegesDetail {
        try await get("/api/colleges/detail", query: [URLQueryItem(name: "id", value: String(scorecardId))], as: DataEnvelope<CollegesDetail>.self).data
    }

    func collegeRecommendations() async throws -> CollegesRecommendationSet {
        try await get("/api/colleges/recommendations", as: DataEnvelope<CollegesRecommendationSet>.self).data
    }

    func collegesOddsPlan() async throws -> CollegesOddsPlan {
        try await get("/api/ai/odds-plan")
    }

    /// Sends one prompt to the AI and waits for it to finish, reporting status lines as they stream in.
    /// The AI saves its results to the workspace with its own tools; nothing is returned.
    func collegesRunPrompt(_ prompt: String, onProgress: @Sendable (String) async -> Void) async throws {
        let body: [String: JSONValue] = ["messages": [["role": "user", "content": .string(prompt)]]]
        let (bytes, _) = try await stream(.json("POST", "/api/ai/chat", body, timeout: 300))
        do {
            for try await line in bytes.lines {
                guard let data = line.data(using: .utf8),
                      let event = try? JSONDecoder().decode(CollegesChatEvent.self, from: data) else { continue }
                switch event.type {
                case "status": await onProgress(event.message.isEmpty ? "Working…" : event.message)
                case "tool": await onProgress("Updating your hub…")
                case "done": await onProgress("Finishing up…")
                case "error": throw APIError.server(status: 200, message: event.message.isEmpty ? "Something went wrong while estimating." : event.message)
                default: continue
                }
            }
        } catch {
            throw APIError.wrap(error)
        }
    }
}
