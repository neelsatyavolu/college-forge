import Foundation

/// The student's own point on every chart.
struct ScatterStudentMarker: Hashable, Sendable {
    let gpa: Double
    let sat: Int
    /// True when both numbers came from Maia rather than the Forge profile.
    let fromMaia: Bool
}

/// Early rounds that get their own symbol. Anything else plots as a circle.
enum ScatterRoundKind: String, Sendable {
    case ed = "ED", ea = "EA"
}

/// The visible ranges and grid lines of one chart.
struct ScatterChartDomain: Hashable, Sendable {
    let sat: ClosedRange<Int>
    let gpa: ClosedRange<Double>
    let satTicks: [Int]
    let gpaTicks: [Double]
}

/// What the screen shows, in web order (public/hub/Scattergrams.jsx): schools on the list first, in list
/// order, then imported schools that aren't on it, ranked ones first.
struct ScattergramSections: Hashable, Sendable {
    let onList: [CollegeScattergram]
    /// Names of schools on the list with nothing imported yet.
    let notImported: [String]
    let others: [CollegeScattergram]
}

/// Scattergram rules shared with the website. Pure functions, so they're unit tested.
enum ScattergramLogic {
    static let maxSat = 1600
    /// Points draw in this order, so admits sit on top.
    private static let drawOrder: [ScatterOutcome] = [.denied, .deferred, .waitlisted, .accepted]

    /// First number in a profile field, e.g. "3.9/4.0" → 3.9, "1,500" → 1500, "—" → nil.
    static func firstNumber(_ text: String) -> Double? {
        let clean = text.replacingOccurrences(of: ",", with: "")
        guard let match = clean.firstMatch(of: #/\d+(\.\d+)?/#) else { return nil }
        return Double(match.output.0)
    }

    /// Maia's marker where it has a number, else the profile's unweighted GPA and SAT.
    static func studentMarker(doc: ScattergramDoc?, applicant: Applicant) -> ScatterStudentMarker? {
        let maia = doc?.student
        let gpa = maia?.gpa ?? firstNumber(applicant.gpaUnweighted)
        let sat = maia?.sat ?? firstNumber(applicant.sat).map { Int($0.rounded()) }
        guard let gpa, gpa <= 5, let sat, (400...maxSat).contains(sat) else { return nil }
        return ScatterStudentMarker(gpa: gpa, sat: sat, fromMaia: maia?.gpa != nil && maia?.sat != nil)
    }

    /// Maia's round labels vary ("Early Decision II", "ED2", "REA", "Restrictive Early Action"), so match loosely.
    static func roundKind(_ round: String?) -> ScatterRoundKind? {
        let text = (round ?? "").lowercased()
        if text.contains(#/early decision|\bed\s*(i{1,2}|[12])?\b/#) { return .ed }
        if text.contains(#/early action|\b(r|sc)?ea\b/#) { return .ea }
        return nil
    }

    /// "ED 3 of 5 accepted · EA 1 of 4 accepted", or "" with no early applicants.
    static func roundSummary(_ points: [ScatterPoint]) -> String {
        [ScatterRoundKind.ed, .ea].compactMap { kind in
            let round = points.filter { roundKind($0.round) == kind }
            guard !round.isEmpty else { return nil }
            return "\(kind.rawValue) \(round.filter { $0.result == .accepted }.count) of \(round.count) accepted"
        }
        .joined(separator: " · ")
    }

    /// "42 applicants · 9 accepted (21%) · ED 3 of 5 accepted".
    static func headline(_ college: CollegeScattergram) -> String {
        guard college.n > 0 else { return "No applicants from your school" }
        let percent = Int((Double(college.accepted) / Double(college.n) * 100).rounded())
        let rounds = roundSummary(college.points)
        return "\(college.n) applicants · \(college.accepted) accepted (\(percent)%)" + (rounds.isEmpty ? "" : " · \(rounds)")
    }

    /// Points with both a GPA and an SAT, in drawing order.
    static func plotted(_ college: CollegeScattergram) -> [ScatterPoint] {
        let rank = { (p: ScatterPoint) in drawOrder.firstIndex(of: p.result) ?? -1 }
        return college.points
            .filter { $0.sat != nil && $0.gpa != nil }
            .enumerated()
            .sorted { rank($0.element) != rank($1.element) ? rank($0.element) < rank($1.element) : $0.offset < $1.offset }
            .map(\.element)
    }

    static func unplotted(_ college: CollegeScattergram) -> Int {
        college.points.filter { $0.sat == nil || $0.gpa == nil }.count
    }

    /// Fits the axes to the points and the student (with a minimum span) so the plot isn't mostly empty.
    static func domain(points: [ScatterPoint], student: ScatterStudentMarker?) -> ScatterChartDomain {
        let sats = points.compactMap(\.sat) + (student.map { [$0.sat] } ?? [])
        let gpas = points.compactMap(\.gpa) + (student.map { [$0.gpa] } ?? [])
        let minSat = min(maxSat - 300, sats.min().map { Int((Double($0 - 20) / 100).rounded(.down)) * 100 } ?? Int.max)
        let maxGpa = max(4, ((gpas.max() ?? 0) * 4).rounded(.up) / 4)
        let minGpa = min(maxGpa - 0.5, gpas.min().map { (($0 - 0.05) * 4).rounded(.down) / 4 } ?? .infinity)
        let satTicks = Array(stride(from: maxSat, through: minSat, by: -200).reversed())
        let gpaTicks = stride(from: minGpa, through: maxGpa + 1e-9, by: 0.25).map { ($0 * 100).rounded() / 100 }
        return ScatterChartDomain(sat: minSat...maxSat, gpa: minGpa...maxGpa, satTicks: satTicks, gpaTicks: gpaTicks)
    }

    static func sections(doc: ScattergramDoc, list: [College], query: String = "") -> ScattergramSections {
        let onListSlugs = Set(list.map(\.slug))
        let onList = list.compactMap { doc.colleges[$0.slug] }
        let notImported = list.filter { doc.colleges[$0.slug] == nil }.map { $0.short.isEmpty ? $0.name : $0.short }
        let others = doc.colleges.values
            .filter { !onListSlugs.contains($0.slug) }
            .sorted { a, b in
                let (ra, rb) = (a.rank ?? .max, b.rank ?? .max)
                return ra != rb ? ra < rb : a.name.localizedCompare(b.name) == .orderedAscending
            }
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return ScattergramSections(onList: onList, notImported: notImported, others: others) }
        let matches = { (c: CollegeScattergram) in c.name.localizedStandardContains(q) }
        return ScattergramSections(onList: onList.filter(matches), notImported: [], others: others.filter(matches))
    }

    /// "Imported 11/2/2026 · last 3 classes".
    static func importedLabel(_ doc: ScattergramDoc) -> String? {
        guard let date = doc.importedAt else { return nil }
        let day = date.formatted(date: .numeric, time: .omitted)
        return "Imported \(day)" + (doc.classOfYears.map { " · last \($0) classes" } ?? "")
    }

    /// "You: SAT 1450, unweighted GPA 3.9 (from Maia). …"
    static func studentLine(_ marker: ScatterStudentMarker) -> String {
        let gpa = marker.gpa.formatted(.number.precision(.fractionLength(0...2)))
        return "You: SAT \(marker.sat), unweighted GPA \(gpa)\(marker.fromMaia ? " (from Maia)" : " (from your profile)"). Your school's history is a rough guide, not a prediction."
    }

    /// The chart's VoiceOver label.
    static func accessibilityLabel(_ college: CollegeScattergram) -> String {
        let summary = college.counts.sorted { $0.key < $1.key }.map { "\($0.value) \($0.key.lowercased())" }.joined(separator: ", ")
        return "\(college.name): GPA versus SAT for \(college.n) past applicants from your school (\(summary))"
    }
}
