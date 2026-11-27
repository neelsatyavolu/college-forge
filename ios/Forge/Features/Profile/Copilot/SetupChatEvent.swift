import Foundation

/// One line of the `/api/ai/chat` NDJSON stream in setup mode: the copilot's events plus the tiles,
/// draft list, early plan and research progress the interview tools emit (lib/chat-types.ts).
enum SetupChatEvent: Equatable, Sendable {
    case delta(String)
    case status(String)
    case tool(name: String, path: String)
    case question(InterviewQuestion)
    case list(schools: [InterviewSchool], edIdea: InterviewEdIdea?, warning: String?)
    case strategy(InterviewStrategy)
    case research(slug: String, stage: String, facts: Int)
    case error(String)
    case done
    case other

    /// Parses one line. Blank lines give nil; unreadable lines give `.other`.
    static func parse(_ line: String) -> SetupChatEvent? {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        guard let data = trimmed.data(using: .utf8), let head = try? JSONDecoder().decode(Head.self, from: data) else { return .other }
        let body = (try? JSONDecoder().decode(Body.self, from: data)) ?? Body()
        switch head.type {
        case "delta": return .delta(body.text ?? "")
        case "status": return .status(MoreChatStatus.soften(body.message ?? ""))
        case "tool": return .tool(name: body.name ?? "", path: body.path ?? "")
        case "question": return body.question.map(SetupChatEvent.question) ?? .other
        case "list": return .list(schools: body.schools ?? [], edIdea: body.edIdea, warning: body.warning)
        case "strategy": return body.strategy.map(SetupChatEvent.strategy) ?? .other
        case "research": return .research(slug: body.slug ?? "", stage: body.stage ?? "saved", facts: body.facts ?? 0)
        case "error":
            let message = body.message ?? ""
            return .error(message.isEmpty ? "The AI couldn't finish the reply." : message)
        case "done": return .done
        default: return .other
        }
    }

    private struct Head: Decodable { var type: String }

    private struct Body: Decodable {
        var text: String?
        var message: String?
        var name: String?
        var path: String?
        var question: InterviewQuestion?
        var schools: [InterviewSchool]?
        var edIdea: InterviewEdIdea?
        var warning: String?
        var strategy: InterviewStrategy?
        var slug: String?
        var stage: String?
        var facts: Int?

        init() {}

        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            text = c.optionalString(.text)
            message = c.optionalString(.message)
            name = c.optionalString(.name)
            path = c.optionalString(.path)
            question = c.optional(InterviewQuestion.self, .question)
            schools = c.contains(.schools) ? c.array(.schools) : nil
            edIdea = c.optional(InterviewEdIdea.self, .edIdea)
            warning = c.optionalString(.warning)
            strategy = c.optional(InterviewStrategy.self, .strategy)
            slug = c.optionalString(.slug)
            stage = c.optionalString(.stage)
            facts = c.optionalInt(.facts)
        }

        private enum CodingKeys: String, CodingKey {
            case text, message, name, path, question, schools, edIdea, warning, strategy, slug, stage, facts
        }
    }
}

extension SetupChatEvent {
    /// The tiles this event draws, if any.
    var ui: InterviewUI? {
        switch self {
        case .question(let q): .question(q)
        case .list(let schools, let edIdea, let warning): .list(schools: schools, edIdea: edIdea, warning: warning)
        case .strategy(let s): .strategy(s)
        default: nil
        }
    }
}
