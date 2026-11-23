import Foundation

/// Why a submitted application needs a look (`attentionOf` in public/hub/ApplicationParts.jsx).
enum ProgressAttention: String, Hashable, Sendable {
    case decision, check, missing

    static func reasons(for app: TrackedApplication) -> [ProgressAttention] {
        var out: [ProgressAttention] = []
        if app.decision.state == .hidden { out.append(.decision) }
        // After a decision the portal checklist is leftovers, not a to-do.
        guard app.stage == .working || app.stage == .waiting else { return out }
        if !app.missing.isEmpty { out.append(.missing) }
        if app.portal?.ok == false || app.lastFailure != nil { out.append(.check) }
        return out
    }

    func text(for app: TrackedApplication) -> String {
        switch self {
        case .decision: "Decision posted"
        case .missing: "\(app.missing.count) missing"
        case .check: "Check failed"
        }
    }
}

/// One open follow-up with the application it belongs to.
struct ProgressFollowUp: Hashable, Identifiable, Sendable {
    let followUp: FollowUp
    let appID: String
    let appName: String
    var id: String { "\(appID)/\(followUp.id)" }
}

/// The numbers and groups on the Progress overview (`ProgressView.jsx`, Overview tab).
struct ProgressSummary: Sendable {
    let total: Int
    let submitted: Int
    /// Applications still being worked on, soonest deadline first.
    let nextUp: [TrackedApplication]
    /// Submitted applications with an unopened decision, missing documents, a failed check or a follow-up.
    let attention: [TrackedApplication]
    /// Submitted, nothing to do.
    let waiting: [TrackedApplication]
    let followUps: [ProgressFollowUp]
    let decided: Int
    /// The next deadline still ahead among unfinished applications, and how many share it.
    let nextDue: (date: String, count: Int)?

    init(tracker: TrackerView, today: String = ForgeDates.today()) {
        let apps = tracker.apps
        total = apps.count
        submitted = apps.filter { $0.stage != .working && $0.status != .withdrawn }.count
        decided = apps.filter { $0.decision.state != .none }.count

        let working = apps.filter { $0.stage == .working }.sorted(by: Self.byDeadline)
        nextUp = working
        if let next = working.first(where: { !$0.deadline.isEmpty && $0.deadline >= today }) {
            nextDue = (next.deadline, working.filter { $0.deadline == next.deadline }.count)
        } else {
            nextDue = nil
        }

        let attention = apps
            .filter { $0.stage != .working && (!ProgressAttention.reasons(for: $0).isEmpty || !$0.followUps.isEmpty) }
            .sorted { a, b in
                let ha = a.decision.state == .hidden ? 0 : 1
                let hb = b.decision.state == .hidden ? 0 : 1
                return ha != hb ? ha < hb : Self.byDeadline(a, b)
            }
        self.attention = attention
        let attentionIDs = Set(attention.map(\.id))
        waiting = apps.filter { $0.stage == .waiting && !attentionIDs.contains($0.id) }.sorted(by: Self.byDeadline)

        followUps = apps
            .flatMap { app in app.followUps.filter { !$0.done }.map { ProgressFollowUp(followUp: $0, appID: app.id, appName: app.name) } }
            .sorted { Self.sortKey($0.followUp.due) < Self.sortKey($1.followUp.due) }
    }

    /// "3/8 submitted · 2 due Nov 1 · 1 flag · 2 decisions".
    func headline(flags: Int) -> String {
        var parts = ["\(submitted)/\(total) submitted"]
        if let nextDue { parts.append("\(nextDue.count) due \(ForgeDates.short(nextDue.date))") }
        if flags > 0 { parts.append("\(flags) flag\(flags == 1 ? "" : "s")") }
        if decided > 0 { parts.append("\(decided) decision\(decided == 1 ? "" : "s")") }
        return parts.joined(separator: " · ")
    }

    static func byDeadline(_ a: TrackedApplication, _ b: TrackedApplication) -> Bool {
        let da = sortKey(a.deadline), db = sortKey(b.deadline)
        if da != db { return da < db }
        return a.name.localizedCompare(b.name) == .orderedAscending
    }

    /// Empty dates sort last.
    static func sortKey(_ date: String) -> String { date.isEmpty ? "9999" : date }
}

/// The middle column of a progress row: which date matters now (`whenText`).
enum ProgressWhen {
    static func text(for app: TrackedApplication, now: Date = .now) -> (text: String, isSoon: Bool, isLate: Bool) {
        switch app.stage {
        case .working:
            guard !app.deadline.isEmpty, let n = ForgeDates.daysUntil(app.deadline, now: now) else { return ("No deadline set", false, false) }
            let day = ForgeDates.short(app.deadline, now: now)
            if n < 0 { return ("\(day) · passed", false, true) }
            return ("\(day) · \(n == 0 ? "today" : "in \(n)d")", n <= 7, false)
        case .waiting:
            if !app.submittedAt.isEmpty { return ("Submitted \(ForgeDates.short(app.submittedAt, now: now))", false, false) }
            if let d = app.decisionDate {
                return ("Decision \(ForgeDates.short(d.date, now: now))\(d.estimated ? " (est.)" : "")", false, false)
            }
            return ("", false, false)
        default:
            return (app.submittedAt.isEmpty ? "" : "Submitted \(ForgeDates.short(app.submittedAt, now: now))", false, false)
        }
    }
}
