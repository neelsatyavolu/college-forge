import Foundation

/// One dated item on the student's plan: a key date, a school deadline, a letter or a scholarship.
struct UpcomingDeadline: Hashable, Identifiable, Sendable {
    enum Kind: String, Hashable, Sendable {
        case keyDate, school, application, scholarship, letter
    }

    /// yyyy-mm-dd.
    let date: String
    let title: String
    var detail = ""
    let kind: Kind
    /// Set for tracked applications, so a tap can open them.
    var applicationID: String?

    var id: String { "\(date)|\(kind.rawValue)|\(title)" }

    var systemImage: String {
        switch kind {
        case .keyDate: "calendar"
        case .school: "building.columns"
        case .application: "paperplane"
        case .scholarship: "dollarsign.circle"
        case .letter: "envelope"
        }
    }
}

/// Builds the timeline the share page and Overview show (`ShareApp.jsx` timeline + `deadline-plan.js`).
enum UpcomingDeadlines {
    /// Every dated item from today on, soonest first, without duplicates.
    static func build(workspace: Workspace, tracker: TrackerView, today: String = ForgeDates.today()) -> [UpcomingDeadline] {
        var items: [UpcomingDeadline] = []
        items += workspace.criticalDates.map { UpcomingDeadline(date: $0.date, title: $0.label, detail: $0.detail, kind: .keyDate) }
        for college in workspace.colleges {
            for d in planDeadlines(for: college) {
                items.append(UpcomingDeadline(date: d.date, title: college.short.isEmpty ? college.name : college.short, detail: d.plan, kind: .school))
            }
        }
        for app in tracker.apps where app.stage == .working && !app.deadline.isEmpty {
            let detail = app.round == .none ? "Application" : "\(app.round.label) application"
            items.append(UpcomingDeadline(date: app.deadline, title: app.name, detail: detail, kind: .application, applicationID: app.id))
        }
        for s in workspace.scholarships {
            guard let date = s.deadline, !date.isEmpty, s.status != .won, s.status != .lost, s.status != .skipped else { continue }
            items.append(UpcomingDeadline(date: date, title: s.name, detail: "Scholarship", kind: .scholarship))
        }
        for r in workspace.recommendations {
            guard let date = r.deadline, !date.isEmpty, r.status != .submitted, r.status != .waived else { continue }
            items.append(UpcomingDeadline(date: date, title: r.name, detail: "Letter of recommendation", kind: .letter))
        }

        var seen = Set<String>()
        return items
            .filter { ForgeDates.day($0.date) != nil && $0.date >= today }
            .filter { seen.insert("\($0.date)|\($0.title.lowercased())|\($0.detail.lowercased())").inserted }
            .sorted { $0.date != $1.date ? $0.date < $1.date : $0.title < $1.title }
    }

    // MARK: deadline-plan.js

    private static var kinds: [(String, Regex<AnyRegexOutput>)] { [
        ("aid", try! Regex(#"financial aid|fafsa|css profile|\bcss\b|\baid\b"#).ignoresCase()),
        ("scholarship", try! Regex("scholarship|merit|fellow").ignoresCase()),
        ("program", try! Regex("honors|program|interview|portfolio|audition").ignoresCase()),
        ("docs", try! Regex("materials|supplement|documents|transcript|mid-?year").ignoresCase()),
    ] }

    static func kind(of plan: String) -> String {
        kinds.first { plan.contains($0.1) }?.0 ?? "round"
    }

    /// "ED I" and "ED" are the same round; "ED II" is not.
    static func roundTokens(_ plan: String) -> [String] {
        let pattern = try! Regex(#"\b(ED|EA|REA|SCEA|RD)(?:\s?(II|I|2|1))?\b"#).ignoresCase()
        return plan.matches(of: pattern).map { match in
            let round = (match.output[1].substring.map(String.init) ?? "").uppercased()
            let n = match.output[2].substring.map(String.init) ?? ""
            let second = n.uppercased() == "II" || n == "2"
            return round + (second ? " II" : "")
        }
    }

    private enum Chosen { case token(String), name(String) }

    /// The round in the shortlist's "EA · Nov 1" label, or nil when none is chosen.
    private static func chosenRound(_ college: College) -> Chosen? {
        let label = (college.deadline ?? "").split(separator: "·").first.map { String($0).profileTrimmed } ?? ""
        guard !label.isEmpty else { return nil }
        if let token = roundTokens(label).first { return .token(token) }
        return .name(label.lowercased())
    }

    private static func belongs(_ plan: String, to chosen: Chosen) -> Bool {
        let tokens = roundTokens(plan)
        switch chosen {
        case .token(let t): return tokens.contains(t) || (tokens.isEmpty && kind(of: plan) != "round")
        case .name(let n):
            if kind(of: plan) == "round" { return plan.profileTrimmed.lowercased() == n }
            return tokens.isEmpty
        }
    }

    /// Deadlines for the round the student chose, plus aid, scholarship and program dates that apply to it.
    static func planDeadlines(for college: College) -> [PlanDeadline] {
        let deadlines = college.deadlines ?? []
        guard let chosen = chosenRound(college) else { return deadlines }
        return deadlines.filter { belongs($0.plan, to: chosen) }
    }
}
