import Foundation

// Forge's API is written for a JavaScript client: fields go missing, numbers arrive as strings and new
// enum values appear without notice. These helpers never throw on a single bad field, so one odd value
// can't blank out a whole screen. Models use them in `init(from:)` and keep synthesized encoding.

extension KeyedDecodingContainer {
    /// A string, accepting numbers and booleans as their text. Missing, null or other types give `fallback`.
    func string(_ key: Key, _ fallback: String = "") -> String {
        optionalString(key) ?? fallback
    }

    func optionalString(_ key: Key) -> String? {
        if let s = try? decodeIfPresent(String.self, forKey: key) { return s }
        if let i = try? decodeIfPresent(Int.self, forKey: key) { return String(i) }
        if let d = try? decodeIfPresent(Double.self, forKey: key) { return String(d) }
        if let b = try? decodeIfPresent(Bool.self, forKey: key) { return String(b) }
        return nil
    }

    /// An integer, accepting whole doubles and numeric strings.
    func int(_ key: Key, _ fallback: Int = 0) -> Int {
        optionalInt(key) ?? fallback
    }

    func optionalInt(_ key: Key) -> Int? {
        if let i = try? decodeIfPresent(Int.self, forKey: key) { return i }
        if let d = try? decodeIfPresent(Double.self, forKey: key), d.isFinite { return Int(d) }
        if let s = try? decodeIfPresent(String.self, forKey: key) { return Int(s.trimmingCharacters(in: .whitespaces)) }
        return nil
    }

    func optionalDouble(_ key: Key) -> Double? {
        if let d = try? decodeIfPresent(Double.self, forKey: key) { return d }
        if let s = try? decodeIfPresent(String.self, forKey: key) { return Double(s) }
        return nil
    }

    func double(_ key: Key, _ fallback: Double = 0) -> Double {
        optionalDouble(key) ?? fallback
    }

    func bool(_ key: Key, _ fallback: Bool = false) -> Bool {
        optionalBool(key) ?? fallback
    }

    func optionalBool(_ key: Key) -> Bool? {
        if let b = try? decodeIfPresent(Bool.self, forKey: key) { return b }
        if let i = try? decodeIfPresent(Int.self, forKey: key) { return i != 0 }
        return nil
    }

    /// A nested value, or nil when it's missing, null or the wrong shape.
    func optional<T: Decodable>(_ type: T.Type, _ key: Key) -> T? {
        (try? decodeIfPresent(type, forKey: key)) ?? nil
    }

    func value<T: Decodable>(_ key: Key, _ fallback: @autoclosure () -> T) -> T {
        optional(T.self, key) ?? fallback()
    }

    /// An array that skips elements which fail to decode instead of failing the whole list.
    func array<T: Decodable>(_ key: Key, of type: T.Type = T.self) -> [T] {
        guard let items = try? decodeIfPresent([Lossy<T>].self, forKey: key) else { return [] }
        return items.compactMap(\.value)
    }

    /// A string-keyed dictionary that skips entries which fail to decode.
    func dictionary<T: Decodable>(_ key: Key, of type: T.Type = T.self) -> [String: T] {
        guard let items = try? decodeIfPresent([String: Lossy<T>].self, forKey: key) else { return [:] }
        return items.compactMapValues(\.value)
    }
}

/// Wraps one element so a bad element decodes to nil rather than throwing.
struct Lossy<T: Decodable>: Decodable {
    let value: T?

    init(from decoder: any Decoder) throws {
        value = try? T(from: decoder)
    }
}

/// A string-backed enum that keeps unknown values instead of failing. Conformers declare known cases as
/// `static let` constants and switch on `rawValue` or compare with `==`.
protocol OpenEnum: RawRepresentable, Codable, Hashable, Sendable where RawValue == String {
    init(rawValue: String)
}

extension OpenEnum {
    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        self.init(rawValue: (try? container.decode(String.self)) ?? "")
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}
