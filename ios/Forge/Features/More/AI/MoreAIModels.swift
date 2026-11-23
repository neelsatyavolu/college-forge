import Foundation

/// The AI accounts that can run the copilot. Raw values match the server's provider names.
enum MoreAIProvider: String, CaseIterable, Codable, Sendable, Identifiable {
    case grok, codex, opencode

    var id: String { rawValue }

    var label: String {
        switch self {
        case .grok: "Grok"
        case .codex: "ChatGPT"
        case .opencode: "OpenCode"
        }
    }

    /// Grok and ChatGPT sign in with the student's own account; OpenCode is a server key.
    var canConnect: Bool { self != .opencode }
}

/// One model the student can pick for a provider.
struct MoreAIModel: Decodable, Hashable, Sendable, Identifiable {
    var id: String
    var label: String
    var tier: String

    var title: String { tier.isEmpty ? label : "\(label) · \(tier)" }

    init(id: String, label: String, tier: String = "") {
        self.id = id
        self.label = label
        self.tier = tier
    }

    private enum CodingKeys: String, CodingKey { case id, label, tier }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.string(.id)
        guard !id.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "A model needs an id.")
        }
        label = c.string(.label, id)
        tier = c.string(.tier)
    }
}

/// GET /api/ai/status (lib/providers.ts `ProviderStatus`).
struct MoreAIStatus: Decodable, Hashable, Sendable {
    var grokConnected = false
    var codexConnected = false
    var opencodeAvailable = false
    var active: MoreAIProvider?
    var connectionErrors: [String: String] = [:]
    var grokModels: [MoreAIModel] = []
    var codexModels: [MoreAIModel] = []
    var opencodeModels: [MoreAIModel] = []
    var defaultGrokModel = ""
    var defaultCodexModel = ""
    var defaultOpencodeModel = ""
    var webSearchAvailable = false

    init() {}

    private enum CodingKeys: String, CodingKey {
        case grokConnected, codexConnected, opencodeAvailable, active, connectionErrors
        case grokModels, codexModels, opencodeModels, defaultGrokModel, defaultCodexModel, defaultOpencodeModel
        case webSearchAvailable
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        grokConnected = c.bool(.grokConnected)
        codexConnected = c.bool(.codexConnected)
        opencodeAvailable = c.bool(.opencodeAvailable)
        active = c.optionalString(.active).flatMap(MoreAIProvider.init(rawValue:))
        connectionErrors = c.dictionary(.connectionErrors)
        grokModels = c.array(.grokModels)
        codexModels = c.array(.codexModels)
        opencodeModels = c.array(.opencodeModels)
        defaultGrokModel = c.string(.defaultGrokModel)
        defaultCodexModel = c.string(.defaultCodexModel)
        defaultOpencodeModel = c.string(.defaultOpencodeModel)
        webSearchAvailable = c.bool(.webSearchAvailable)
    }

    func isAvailable(_ provider: MoreAIProvider) -> Bool {
        switch provider {
        case .grok: grokConnected
        case .codex: codexConnected
        case .opencode: opencodeAvailable
        }
    }

    func models(for provider: MoreAIProvider) -> [MoreAIModel] {
        switch provider {
        case .grok: grokModels
        case .codex: codexModels
        case .opencode: opencodeModels
        }
    }

    func defaultModel(for provider: MoreAIProvider) -> String {
        switch provider {
        case .grok: defaultGrokModel
        case .codex: defaultCodexModel
        case .opencode: defaultOpencodeModel
        }
    }

    /// The server's own words about connections that failed to refresh, in one line.
    var connectionErrorText: String? {
        let text = connectionErrors.keys.sorted().compactMap { connectionErrors[$0] }.joined(separator: " ")
        return text.isEmpty ? nil : text
    }
}

/// The student's copilot choices, kept on this device like the web keeps them in the browser.
struct MoreAIPreferences: Codable, Equatable, Sendable {
    /// nil means Auto: the first available of Grok, ChatGPT, OpenCode.
    var preferred: MoreAIProvider?
    var models: [MoreAIProvider: String] = [:]

    /// The provider new messages go to: the chosen one, or the server's first available for Auto.
    func chosen(in status: MoreAIStatus?) -> MoreAIProvider? {
        preferred ?? status?.active
    }

    /// Whether a message can be sent right now. A chosen provider that isn't available never falls back.
    func canSend(with status: MoreAIStatus?) -> Bool {
        guard let status, let chosen = chosen(in: status) else { return false }
        return status.isAvailable(chosen)
    }

    /// The model to use for a provider: the saved pick if the server still offers it, else the default.
    func model(for provider: MoreAIProvider, in status: MoreAIStatus) -> String {
        let offered = status.models(for: provider)
        if let saved = models[provider], offered.contains(where: { $0.id == saved }) { return saved }
        let fallback = status.defaultModel(for: provider)
        return fallback.isEmpty ? (offered.first?.id ?? "") : fallback
    }

    /// Short label for the chat header: "Grok", "ChatGPT unavailable", "Not connected".
    func headerLabel(for status: MoreAIStatus?) -> String {
        guard let status else { return "Checking…" }
        guard let chosen = chosen(in: status) else { return "Not connected" }
        return status.isAvailable(chosen) ? chosen.label : "\(chosen.label) unavailable"
    }

    // MARK: Storage

    private static let key = "ForgeAIPreferences"

    static func load(defaults: UserDefaults = .standard) -> MoreAIPreferences {
        defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(Self.self, from: $0) } ?? MoreAIPreferences()
    }

    func save(defaults: UserDefaults = .standard) {
        if let data = try? JSONEncoder().encode(self) { defaults.set(data, forKey: Self.key) }
    }
}
