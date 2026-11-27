import Foundation

/// `{success, data}` replies.
struct DataEnvelope<T: Decodable>: Decodable {
    var data: T
}

/// Reply to POST /api/workspace actions: the workspace plus action-specific fields.
struct WorkspaceActionResponse: Decodable, Sendable {
    var data: Workspace?
    /// `create-recovery`: the recovery code.
    var code: String?
    /// `create-share`: the new share token.
    var token: String?
    /// `assess-tiers`: list schools given a tier, and those Forge couldn't place.
    var assessed: [String] = []
    var unknown: [String] = []

    private enum CodingKeys: String, CodingKey { case data, code, token, assessed, unknown }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        data = c.optional(Workspace.self, .data)
        code = c.optionalString(.code)
        token = c.optionalString(.token)
        assessed = c.array(.assessed)
        unknown = c.array(.unknown)
    }
}

/// Typed calls for Forge's routes. Screens normally go through `WorkspaceStore`, which applies results to the
/// shared state; call these directly only for data the store doesn't hold (catalog, connections, exports).
extension APIClient {
    func me() async throws -> MeResponse {
        try await get("/api/me")
    }

    /// GET /api/workspace returns the workspace itself (no envelope).
    func workspace() async throws -> Workspace {
        try await get("/api/workspace")
    }

    func patchWorkspace(_ patch: WorkspacePatch) async throws -> Workspace {
        try await self.patch("/api/workspace", body: patch, as: DataEnvelope<Workspace>.self).data
    }

    /// POST /api/workspace {action, ...fields}. Actions: create-share {label, scope:"progress"|"full"},
    /// revoke-share {token}, create-recovery, complete-onboarding {applicant, profile, testing, storyNotes,
    /// listPrefs, activities, honors}. For reset use `resetWorkspace()`.
    func workspaceAction(_ action: String, fields: [String: JSONValue] = [:]) async throws -> WorkspaceActionResponse {
        var body = fields
        body["action"] = .string(action)
        return try await post("/api/workspace", body: body)
    }

    /// POST /api/workspace {action:"reset"} replies with the workspace itself, not `{data}`.
    func resetWorkspace() async throws -> Workspace {
        try await post("/api/workspace", body: ["action": JSONValue.string("reset")])
    }

    func applications() async throws -> TrackerView {
        try await get("/api/applications", as: DataEnvelope<TrackerView>.self).data
    }

    /// The master login's state, from the same GET (`master` beside `data`).
    func masterLogin() async throws -> MasterLoginStatus? {
        try await get("/api/applications", as: ApplicationsResponse.self).master
    }

    /// Portal checks and imports can take up to two minutes, so those get a longer timeout.
    func applications(_ action: ApplicationAction) async throws -> ApplicationsResponse {
        let slow: Bool = switch action {
        case .check, .importCollegeApps: true
        default: false
        }
        return try await post("/api/applications", body: action, timeout: slow ? 150 : 30)
    }

    /// The school catalog for "Add a school". Public and cacheable.
    func catalog() async throws -> [CatalogSchool] {
        let (data, _) = try await send(APIRequest("GET", "/api/applications/catalog"))
        return ((try? JSONDecoder().decode([Lossy<CatalogSchool>].self, from: data)) ?? []).compactMap(\.value)
    }

    func connections() async throws -> [Connection] {
        try await get("/api/connections", as: DataEnvelope<[Lossy<Connection>]>.self).data.compactMap(\.value)
    }

    func revokeConnection(id: String) async throws {
        try await send(.json("POST", "/api/connections", ["id": id]))
    }

    /// Registers this device for push. `environment` is "sandbox" or "production".
    func registerDevice(token: String, environment: String) async throws {
        try await send(.json("POST", "/api/devices", ["token": token, "environment": environment]))
    }

    func unregisterDevice(token: String) async throws {
        try await send(.json("DELETE", "/api/devices", ["token": token]))
    }

    /// GET /api/workspace/calendar: the private calendar subscription link, or nil when there is none.
    func calendarFeed() async throws -> CalendarFeedLink? {
        try await get("/api/workspace/calendar", as: DataEnvelope<CalendarFeedLink?>.self).data
    }

    /// POST /api/workspace/calendar {action}: "create" makes or replaces the link (the old one stops working), "revoke" ends it.
    func calendarFeed(_ action: String) async throws -> CalendarFeedLink? {
        try await post("/api/workspace/calendar", body: ["action": action], as: DataEnvelope<CalendarFeedLink?>.self).data
    }

    /// Downloads an export with auth. Formats: "txt", "brief" (Markdown), "ics" (calendar), "json".
    /// Returns the body and the file name the server suggested.
    func export(format: String) async throws -> (data: Data, filename: String?) {
        let (data, response) = try await send(APIRequest("GET", "/api/workspace/export", query: [URLQueryItem(name: "format", value: format)], timeout: 60))
        let disposition = response.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        let filename = disposition.components(separatedBy: "filename=").dropFirst().first?
            .trimmingCharacters(in: CharacterSet(charactersIn: "\"; "))
        return (data, filename)
    }
}
