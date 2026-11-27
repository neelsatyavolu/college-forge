import Foundation

/// The wording of "Assess all" on the shortlist, as in public/hub/Shortlist.jsx `onAssessAll`.
enum CollegesAssess {
    struct Outcome: Equatable, Sendable {
        /// What was sorted (and what wasn't), in the muted status line. May be empty.
        var notice: String
        /// Why the run stopped, when it did.
        var error: String?
    }

    /// "1 school", "3 schools".
    static func schools(_ n: Int) -> String {
        "\(n) school\(n == 1 ? "" : "s")"
    }

    /// "Sorted 3 schools into reach, target or likely. Couldn't estimate A, B; run Assess all again or pick a tier yourself."
    static func summary(sorted: Int, left: [String]) -> String {
        let done = sorted > 0 ? "Sorted \(schools(sorted)) into reach, target or likely." : ""
        let rest = left.isEmpty ? "" : " Couldn’t estimate \(left.joined(separator: ", ")); run Assess all again or pick a tier yourself."
        return (done + rest).trimmingCharacters(in: .whitespaces)
    }
}
