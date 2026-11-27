import Foundation

/// A merit award a decision letter names ("Presidential Scholarship", "$25,000", "per year").
struct DecisionAward: Codable, Hashable, Sendable {
    var name: String
    /// "$25,000" or "Full tuition"; "" when the letter gives no amount.
    var amount: String
    var period: String

    /// "$25,000 per year".
    var amountText: String { [amount, period].filter { !$0.isEmpty }.joined(separator: " ") }
}

extension DecisionAward {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.string(.name)
        amount = c.string(.amount)
        period = c.string(.period)
    }
}

/// How a saved letter can be shown.
struct LetterKind: OpenEnum {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }
    static let html = Self(rawValue: "html")
    static let pdf = Self(rawValue: "pdf")
    static let text = Self(rawValue: "text")
}

/// A decision letter Forge saved (`TrackedApplication.letter` / `letterHistory`). Present only once the
/// student revealed its decision. The body comes from `.letter(id:letterId:)`.
struct DecisionLetterMeta: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var kind: LetterKind
    /// Milliseconds since 1970.
    var capturedAt: Double
    /// The outcome the letter names; nil when it names none clearly.
    var result: AppStatus?
    var awards: [DecisionAward]
}

extension DecisionLetterMeta {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.string(.id)
        kind = c.value(.kind, .text)
        capturedAt = c.double(.capturedAt)
        result = c.optionalString(.result).flatMap { $0.isEmpty ? nil : AppStatus(rawValue: $0) }
        awards = c.array(.awards)
    }
}

/// A letter's body from POST /api/applications {action:"letter"}. `html` is already sanitized by the server
/// and must still be shown with JavaScript off.
struct DecisionLetter: Codable, Hashable, Sendable {
    var id: String
    var kind: LetterKind
    var text: String
    var html: String?
    var pdfBase64: String?
    var capturedAt: Double
    var result: AppStatus?
    var awards: [DecisionAward]

    var capturedDate: Date { Date(milliseconds: capturedAt) }
    var pdfData: Data? { pdfBase64.flatMap { Data(base64Encoded: $0) } }
}

extension DecisionLetter {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.string(.id)
        kind = c.value(.kind, .text)
        text = c.string(.text)
        html = c.optionalString(.html)
        pdfBase64 = c.optionalString(.pdfBase64)
        capturedAt = c.double(.capturedAt)
        result = c.optionalString(.result).flatMap { $0.isEmpty ? nil : AppStatus(rawValue: $0) }
        awards = c.array(.awards)
    }
}
