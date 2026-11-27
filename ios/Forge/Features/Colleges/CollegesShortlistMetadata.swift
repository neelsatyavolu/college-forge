import Foundation

/// Fields used by the web shortlist that the shared workspace model doesn't retain.
struct CollegesShortlistMetadata: Decodable, Sendable {
    let revision: Int
    let draftStorageKey: String
    let listGaps: [CollegesListGap]
    let staleKeys: Set<String>
    let estimateCount: Int

    private enum Keys: String, CodingKey {
        case revision, draftStorageKey, onboarding, listGaps, applicant, profile, testing, act, admissionOdds
    }

    private struct Estimate: Decodable {
        var profileFingerprint: String?
    }

    init(from decoder: any Decoder) throws {
        let fields = try decoder.container(keyedBy: Keys.self)
        revision = fields.int(.revision)
        draftStorageKey = fields.string(.draftStorageKey)
        let onboarding = try? fields.nestedContainer(keyedBy: Keys.self, forKey: .onboarding)
        listGaps = onboarding?.array(.listGaps) ?? []

        let profile = try? fields.nestedContainer(keyedBy: Keys.self, forKey: .profile)
        let testing = try? profile?.nestedContainer(keyedBy: Keys.self, forKey: .testing)
        let fingerprint = try CollegesOdds.profileFingerprint(
            applicant: fields.value(.applicant, Applicant()),
            profile: fields.value(.profile, Profile()),
            act: testing?.string(.act) ?? ""
        )
        let odds = fields.dictionary(.admissionOdds, of: Estimate.self)
        estimateCount = odds.count
        staleKeys = Set(odds.compactMap { key, odds in
            guard let saved = odds.profileFingerprint, !saved.isEmpty, saved != fingerprint else { return nil }
            return key
        })
    }

    var staleNotice: String? {
        guard !staleKeys.isEmpty else { return nil }
        let message = staleKeys.count == estimateCount
            ? "Estimated before your profile changed."
            : "\(staleKeys.count) of \(estimateCount) estimates were made before your profile changed."
        return message + " Re-estimate to use your current scores."
    }
}

extension CollegesOdds {
    // ECMAScript WhiteSpace and LineTerminator used by String.trim().
    private static let fingerprintWhitespace: CharacterSet = {
        var set = CharacterSet(charactersIn: "\u{9}\u{A}\u{B}\u{C}\u{D} \u{A0}\u{1680}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}")
        set.insert(charactersIn: "\u{2000}"..."\u{200A}")
        return set
    }()

    /// Keep the input order, normalization and hash in sync with lib/admission-odds.ts.
    static func profileFingerprint(applicant: Applicant, profile: Profile, act: String) throws -> String {
        func field(_ value: String) -> String {
            let trimmed = value.trimmingCharacters(in: fingerprintWhitespace)
            return trimmed == "—" ? "" : trimmed
        }
        let sat = field(applicant.sat)
        let note = field(applicant.satNote)
        let parts = [
            field(applicant.gpaUnweighted), field(applicant.gpaWeighted),
            sat.isEmpty ? field(profile.testing.sat) : sat, field(act),
            note.isEmpty ? field(profile.testing.satNote) : note,
            field(profile.intended).lowercased(), field(profile.residency).uppercased()
        ]
        let encoder = JSONEncoder()
        encoder.outputFormatting = .withoutEscapingSlashes
        let json = String(decoding: try encoder.encode(parts), as: UTF8.self)
        // JS for…of iterates scalars, then charCodeAt(0) takes the first UTF-16 unit of each.
        var hash: UInt32 = 0x811c9dc5
        for scalar in json.unicodeScalars {
            let firstUnit = scalar.value <= 0xffff ? scalar.value : 0xd800 + ((scalar.value - 0x10000) >> 10)
            hash = (hash ^ firstUnit) &* 0x01000193
        }
        return String(format: "%08x", hash)
    }
}

extension APIClient {
    func collegesShortlistMetadata() async throws -> CollegesShortlistMetadata {
        try await get("/api/workspace")
    }
}
