import Foundation

enum EssayCopilotAction: String, CaseIterable {
    case draft = "Ask copilot to draft"
    case outline = "Outline"
    case tighten = "Tighten to limit"
    case check = "Check against prompt"

    func prompt(for item: EssayItem) -> String {
        let essay = item.essay
        let context = "My \(item.badge) essay \"\(essay.label)\" (id \(essay.id), limit \(essay.limit) \(essay.unit)). Prompt: \(essay.prompt)"
        switch self {
        case .outline:
            return context + " Read my draft with get_essay and help me outline this essay. Ask me about my own experiences before suggesting content, and don't make any up."
        case .tighten:
            return context + " Read my draft with get_essay and cut it to \(essay.limit) \(essay.unit) or fewer without changing my voice or story. Save the shorter version with suggest_essay_edit so I can compare."
        case .check:
            return context + " Read my draft with get_essay and tell me whether it answers every part of the prompt. Quote the sentences that do, and name anything it leaves out."
        case .draft:
            return "Help me draft my \(essay.label) essay. Ask me questions first, then suggest an outline. Don't save anything until I ask."
        }
    }
}
