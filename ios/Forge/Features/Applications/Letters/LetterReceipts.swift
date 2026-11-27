import Foundation

/// Whether each assigned school's portal shows a recommender's letter. A port of `receiptFor` in
/// public/hub/recommenders.js: match by the recommender's last name when a checklist item names them,
/// otherwise count letters of the same type without guessing which teacher each one is.
enum LetterReceipts {
    /// `unclear`: some same-type letters are in, but the portal doesn't say whose.
    enum State: String { case received, missing, unclear, noPortalData }

    struct Receipt: Hashable, Identifiable {
        var appId: String
        var name: String
        var state: State
        /// True when the result counts letters by type rather than by the recommender's name.
        var byType: Bool
        var done: Int
        var total: Int
        var id: String { appId }
    }

    private static let letterItem = try! NSRegularExpression(
        pattern: #"\b(teacher|counselor|secondary school|school)\s+(evaluation|report|recommendation)s?\b|\bletters? of rec(ommendation)?\b|\brecommendation letters?\b"#,
        options: [.caseInsensitive])
    private static let titles: Set<String> = ["mr", "mrs", "ms", "mx", "miss", "dr", "prof", "professor", "coach", "sr", "sra", "srta"]

    /// The server's email check (lib/recommenders.ts): one @, no spaces, a dot in the domain, at most 254 characters.
    static func isEmail(_ text: String) -> Bool {
        text.count <= 254 && text.range(of: #"^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$"#, options: .regularExpression) != nil
    }

    static func isLetterItem(_ text: String) -> Bool {
        letterItem.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    private static func itemType(_ text: String) -> RecommenderType {
        let t = text.lowercased()
        if t.contains("counselor") || t.contains("school report") { return .counselor }
        if t.contains("teacher") { return .teacher }
        return .other
    }

    static func lastName(_ name: String) -> String {
        let words = name.split(whereSeparator: { $0 == " " || $0 == "," })
            .map { String($0.filter { $0.isLetter || $0 == "'" || $0 == "-" }) }
            .filter { !$0.isEmpty && !titles.contains($0.lowercased()) }
        let last = words.last?.lowercased() ?? ""
        return last.count >= 2 ? last : ""
    }

    private static func names(_ text: String, _ last: String) -> Bool {
        guard !last.isEmpty else { return false }
        let pattern = "(^|[^\\p{L}])" + NSRegularExpression.escapedPattern(for: last) + "($|[^\\p{L}])"
        guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return false }
        return re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    static func receipts(for rec: Recommendation, apps: [TrackedApplication], others: [Recommendation]) -> [Receipt] {
        let last = lastName(rec.name)
        let peers = others.filter { $0.id != rec.id }
        let otherLasts = peers.map { lastName($0.name) }.filter { !$0.isEmpty && $0 != last }
        return (rec.schools ?? []).compactMap { id in
            guard let app = apps.first(where: { $0.id == id }) else { return nil }
            var r = Receipt(appId: app.id, name: app.name, state: .noPortalData, byType: false, done: 0, total: 0)
            guard let portal = app.portal, portal.ok else { return r }
            // An empty optional slot isn't a missing letter.
            let letters = portal.checklist.filter { isLetterItem($0.item) && !($0.optional && !$0.done) }
            let named = letters.filter { names($0.item, last) }
            if !named.isEmpty {
                r.done = named.filter(\.done).count
                r.total = named.count
                r.state = r.done == r.total ? .received : .missing
                return r
            }
            let counted = letters.filter { item in
                !otherLasts.contains(where: { names(item.item, $0) }) && fits(rec.type, itemType(item.item))
            }
            guard !counted.isEmpty else { return r }
            let sharing = 1 + peers.filter { $0.type == rec.type && $0.status != .waived && ($0.schools ?? []).contains(app.id) }.count
            r.byType = true
            r.done = counted.filter(\.done).count
            r.total = counted.count
            r.state = r.done == 0 ? .missing : (r.done == r.total && r.total >= sharing ? .received : .unclear)
            return r
        }
    }

    /// Teachers also take generic "Letter of Recommendation" slots; other types only their own.
    private static func fits(_ recType: RecommenderType, _ itemKind: RecommenderType) -> Bool {
        recType == .teacher ? (itemKind == .teacher || itemKind == .other) : itemKind == recType
    }
}
