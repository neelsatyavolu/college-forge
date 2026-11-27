import Foundation

/// The onboarding chat interview (`InterviewState` in lib/store.ts). Read-only on the app: the server and
/// the AI's tools change it.
struct OnboardingInterview: Decodable, Hashable, Sendable {
    /// interview, list, research, strategy, plan or done.
    var phase = "interview"
    /// basics, school, testing, activities, campus, money, early or deep.
    var section = "basics"
    var transcript: [InterviewTurn] = []
    var listDraftCount = 0

    init() {}

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        phase = c.string(.phase, "interview")
        section = c.string(.section, "basics")
        transcript = c.array(.transcript)
        listDraftCount = c.array(.listDraft, of: JSONValue.self).count
    }

    private enum CodingKeys: String, CodingKey { case phase, section, transcript, listDraft }
}

/// One stored turn. `ui` is the tile set, draft list or early plan the AI showed with it.
struct InterviewTurn: Decodable, Hashable, Sendable {
    var role = "assistant"
    var content = ""
    var ui: InterviewUI?

    init(role: String, content: String, ui: InterviewUI? = nil) {
        self.role = role
        self.content = content
        self.ui = ui
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        role = c.string(.role, "assistant")
        content = c.string(.content)
        ui = c.optional(InterviewUI.self, .ui)
    }

    private enum CodingKeys: String, CodingKey { case role, content, ui }
}

/// What a turn drew under the AI's message (lib/chat-types.ts).
enum InterviewUI: Decodable, Hashable, Sendable {
    case question(InterviewQuestion)
    case list(schools: [InterviewSchool], edIdea: InterviewEdIdea?, warning: String?)
    case strategy(InterviewStrategy)

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let q = c.optional(InterviewQuestion.self, .question) {
            self = .question(q)
        } else if c.contains(.list) {
            self = .list(schools: c.array(.list), edIdea: c.optional(InterviewEdIdea.self, .edIdea), warning: c.optionalString(.warning))
        } else if let s = c.optional(InterviewStrategy.self, .strategy) {
            self = .strategy(s)
        } else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown interview ui"))
        }
    }

    private enum CodingKeys: String, CodingKey { case question, list, edIdea, warning, strategy }
}

/// A question drawn as tiles. kind: single, multi, upload, number, school_search, confirm, activities, intake.
struct InterviewQuestion: Decodable, Hashable, Sendable {
    struct Option: Decodable, Hashable, Sendable {
        var value = ""
        var label = ""
        var hint: String?

        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            label = c.string(.label)
            value = c.string(.value, label)
            hint = c.optionalString(.hint)
        }

        init(value: String, label: String, hint: String? = nil) {
            self.value = value
            self.label = label
            self.hint = hint
        }

        private enum CodingKeys: String, CodingKey { case value, label, hint }
    }

    var id = ""
    var kind = "single"
    var prompt = ""
    var options: [Option] = []
    var min: Double?
    var max: Double?

    init(id: String = "", kind: String, prompt: String, options: [Option] = [], min: Double? = nil, max: Double? = nil) {
        self.id = id
        self.kind = kind
        self.prompt = prompt
        self.options = options
        self.min = min
        self.max = max
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.string(.id)
        kind = c.string(.kind, "single")
        prompt = c.string(.prompt)
        options = c.array(.options)
        min = c.optionalDouble(.min)
        max = c.optionalDouble(.max)
    }

    private enum CodingKeys: String, CodingKey { case id, kind, prompt, options, min, max }
}

/// A school on the draft list. tier: reach, target or likely.
struct InterviewSchool: Decodable, Hashable, Sendable {
    var name = ""
    var tier = "target"
    var reason = ""
    var estChance: String?
    var netPrice: String?
    var fitsBudget: String?
    var current = false
    var supplements: String?
    var aiTier: String?

    init(name: String, tier: String, reason: String = "", current: Bool = false, supplements: String? = nil) {
        self.name = name
        self.tier = tier
        self.reason = reason
        self.current = current
        self.supplements = supplements
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.string(.name)
        tier = c.string(.tier, "target")
        reason = c.string(.reason)
        estChance = c.optionalString(.estChance)
        netPrice = c.optionalString(.netPrice)
        fitsBudget = c.optionalString(.fitsBudget)
        current = c.bool(.current)
        supplements = c.optionalString(.supplements)
        aiTier = c.optionalString(.aiTier)
    }

    private enum CodingKeys: String, CodingKey { case name, tier, reason, estChance, netPrice, fitsBudget, current, supplements, aiTier }
}

struct InterviewEdIdea: Decodable, Hashable, Sendable {
    var school: String?
    var reason = ""

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        school = c.optionalString(.school)
        reason = c.string(.reason)
    }

    private enum CodingKeys: String, CodingKey { case school, reason }
}

struct InterviewStrategy: Decodable, Hashable, Sendable {
    var ed: String?
    var ea: [String] = []
    var reasons = ""

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ed = c.optionalString(.ed)
        ea = c.array(.ea)
        reasons = c.string(.reasons)
    }

    private enum CodingKeys: String, CodingKey { case ed, ea, reasons }
}
