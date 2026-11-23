import Foundation

/// Decision helpers that mirror public/hub/Decisions.jsx.
enum DecisionLogic {
    /// The outcomes a student can record from the Decisions screen.
    static let recordable: [AppStatus] = [.admitted, .denied, .waitlisted, .deferred]

    /// Guesses the outcome from the portal's words. Negative phrases are checked first:
    /// "Not admitted" contains "admitted".
    static func guess(_ text: String) -> AppStatus? {
        let rules: [(String, AppStatus)] = [
            (#"\b(not admitted|not accepted|not offered|deny|denied|rejected|not csu eligible|unable to offer)\b"#, .denied),
            (#"\bwait ?list(ed)?\b"#, .waitlisted),
            (#"\bdefer(red)?\b"#, .deferred),
            (#"\b(admit|admitted|accept|accepted|congratulations|offered)\b"#, .admitted),
        ]
        return rules.first { text.range(of: $0.0, options: [.regularExpression, .caseInsensitive]) != nil }?.1
    }

    /// Record buttons in display order: the suggested outcome first.
    static func recordOptions(suggested: AppStatus?) -> [AppStatus] {
        guard let suggested, recordable.contains(suggested) else { return recordable }
        return [suggested] + recordable.filter { $0 != suggested }
    }

    struct Sections: Equatable {
        var hidden: [TrackedApplication] = []
        var known: [TrackedApplication] = []
        var waiting: [TrackedApplication] = []
        var isEmpty: Bool { hidden.isEmpty && known.isEmpty && waiting.isEmpty }
    }

    static func sections(_ apps: [TrackedApplication]) -> Sections {
        Sections(
            hidden: apps.filter { $0.decision.state == .hidden },
            known: apps.filter { $0.decision.state == .revealed || $0.decision.state == .recorded },
            waiting: apps.filter { $0.decision.state == .none && $0.stage == .waiting }
                .sorted(by: ApplicationsOrdering.bySoonest)
        )
    }

    /// "Expected Mar 28, going by last year" / "No decision date yet".
    static func expectation(_ app: TrackedApplication) -> String {
        guard let date = app.decisionDate, !date.date.isEmpty else { return "No decision date yet" }
        return "Expected \(ForgeDates.short(date.date))" + (date.estimated ? ", going by last year" : "")
    }
}
