import Foundation

/// The student's imported Maia scattergrams. Importing happens on the website (a bookmark run in Maia);
/// the app only reads and clears them. Never log or cache the reply: it describes real classmates.
extension APIClient {
    /// The imported scattergrams, or nil when none were imported.
    func scattergrams() async throws -> ScattergramDoc? {
        try await get("/api/workspace/scattergrams", as: ScattergramsResponse.self).data
    }

    /// Deletes every imported scattergram from this workspace.
    func deleteScattergrams() async throws {
        let (data, _) = try await send(APIRequest("DELETE", "/api/workspace/scattergrams"))
        try Self.checkEnvelope(data)
    }
}
