import Foundation
import Observation

enum EssaysMetadataPatch: Encodable, Sendable {
    case final(id: String, marked: Bool)
    case dismiss(id: String)

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case let .final(id, marked):
            try container.encode(["essayStatus": [id: marked ? "final" : "draft"]])
        case let .dismiss(id):
            try container.encode(["essaySuggestions": [id: JSONValue.null]])
        }
    }
}

/// Only the workspace fields that Core doesn't retain for the Essays screen.
struct EssaysMetadataSnapshot: Decodable, Sendable {
    let revision: Int
    let draftStorageKey: String
    let status: [String: String]
    let suggestions: [String: String]
    let rules: [String: EssayPromptRule]

    private enum CodingKeys: CodingKey { case revision, draftStorageKey, essayStatus, essaySuggestions, essays }
    private struct Suggestion: Decodable { let text: String }
    private struct PromptSets: Decodable {
        let commonApp: [Lossy<EssayPromptRule>]?
        let supplements: [String: [Lossy<EssayPromptRule>]]?
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        revision = c.int(.revision)
        draftStorageKey = c.string(.draftStorageKey)
        status = c.dictionary(.essayStatus)
        suggestions = c.dictionary(.essaySuggestions, of: Suggestion.self).mapValues(\.text)
        let prompts = c.optional(PromptSets.self, .essays)
        let all = (prompts?.commonApp ?? []) + (prompts?.supplements?.values.flatMap { $0 } ?? [])
        rules = Dictionary(all.compactMap(\.value).map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    }
}

extension APIClient {
    func essayMetadata() async throws -> EssaysMetadataSnapshot {
        try await get("/api/workspace")
    }

    func patchEssayMetadata(_ patch: EssaysMetadataPatch) async throws -> EssaysMetadataSnapshot {
        try await self.patch("/api/workspace", body: patch, as: DataEnvelope<EssaysMetadataSnapshot>.self).data
    }
}

@MainActor @Observable
final class EssaysMetadata {
    private var snapshot: EssaysMetadataSnapshot?
    var error: APIError?
    var loaded: Bool { snapshot != nil }
    var status: [String: String] { snapshot?.status ?? [:] }
    var suggestions: [String: String] { snapshot?.suggestions ?? [:] }
    var rules: [String: EssayPromptRule] { snapshot?.rules ?? [:] }

    func refresh(store: WorkspaceStore) async {
        let key = store.workspace.draftStorageKey
        do {
            let fresh = try await store.api.essayMetadata()
            try receive(fresh, key: key, store: store)
        } catch {
            let failure = APIError.wrap(error)
            guard failure != .cancelled, store.workspace.draftStorageKey == key else { return }
            if failure == .signedOut { store.onSignedOut?() }
            self.error = failure
        }
    }

    func apply(_ patch: EssaysMetadataPatch, store: WorkspaceStore) async throws {
        let key = store.workspace.draftStorageKey
        guard snapshot?.draftStorageKey == key else { throw APIError.cancelled }
        do {
            let fresh = try await store.api.patchEssayMetadata(patch)
            try receive(fresh, key: key, store: store)
        } catch {
            let failure = APIError.wrap(error)
            if failure == .signedOut, store.workspace.draftStorageKey == key { store.onSignedOut?() }
            throw failure
        }
    }

    private func receive(_ fresh: EssaysMetadataSnapshot, key: String, store: WorkspaceStore) throws {
        guard store.hasLoaded, store.workspace.draftStorageKey == key,
              fresh.draftStorageKey == key else { throw APIError.cancelled }
        if let snapshot, snapshot.revision > fresh.revision { return }
        snapshot = fresh
        error = nil
    }
}
