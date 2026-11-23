import Foundation

/// The add/edit prompt form's values. Same limits and behavior as the web form.
struct EssayPromptDraft: Equatable, Identifiable, Sendable {
    static let maxTitleLength = 160
    static let limitRange = 1...50_000

    /// nil when adding a new prompt.
    var essayID: String?
    var groupKey: String
    var label = ""
    var prompt = ""
    var limit = 250
    var unit = "words"

    var id: String { essayID ?? "new-\(groupKey)" }
    var isEditing: Bool { essayID != nil }

    static func new(in groupKey: String) -> EssayPromptDraft {
        EssayPromptDraft(groupKey: groupKey)
    }

    static func editing(_ item: EssayItem) -> EssayPromptDraft {
        EssayPromptDraft(essayID: item.essay.id, groupKey: item.groupKey, label: item.essay.label,
                         prompt: item.essay.prompt, limit: item.essay.limit,
                         unit: item.essay.countsCharacters ? "characters" : "words")
    }

    var trimmedLabel: String { label.trimmingCharacters(in: .whitespacesAndNewlines) }
    var trimmedPrompt: String { prompt.trimmingCharacters(in: .whitespacesAndNewlines) }

    var isValid: Bool {
        !trimmedLabel.isEmpty && trimmedLabel.count <= Self.maxTitleLength
            && !trimmedPrompt.isEmpty && Self.limitRange.contains(limit)
    }

    /// The group's prompts after this save, plus the saved essay. Editing keeps the essay's id, group and starter,
    /// so the draft stays attached.
    func applied(to items: [Essay], newID: @autoclosure () -> String = "custom-" + UUID().uuidString.lowercased()) -> (items: [Essay], essay: Essay) {
        if let essayID, let index = items.firstIndex(where: { $0.id == essayID }) {
            var essay = items[index]
            essay.label = trimmedLabel
            essay.prompt = trimmedPrompt
            essay.limit = limit
            essay.unit = unit
            var next = items
            next[index] = essay
            return (next, essay)
        }
        let essay = Essay(id: essayID ?? newID(), label: trimmedLabel, prompt: trimmedPrompt, limit: limit, unit: unit)
        return (items + [essay], essay)
    }

    /// The workspace patch that stores `items` as this group's prompts.
    static func patch(groupKey: String, items: [Essay]) -> WorkspacePatch.EssaysPatch {
        groupKey == EssayCatalog.commonKey
            ? .init(commonApp: items, supplements: nil)
            : .init(commonApp: nil, supplements: [groupKey: items])
    }
}

extension WorkspaceStore {
    /// Adds or edits an essay prompt. Returns the saved essay's id.
    @discardableResult
    func saveEssayPrompt(_ draft: EssayPromptDraft, currentItems: [Essay]) async throws -> String {
        let result = draft.applied(to: currentItems)
        let essays = EssayPromptDraft.patch(groupKey: draft.groupKey, items: result.items)
        try await patch(.with { $0.essays = essays }) { ws in
            if draft.groupKey == EssayCatalog.commonKey {
                ws.essays.commonApp = result.items
            } else {
                ws.essays.supplements[draft.groupKey] = result.items
            }
        }
        return result.essay.id
    }
}
