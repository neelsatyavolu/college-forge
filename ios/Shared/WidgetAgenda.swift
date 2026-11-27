import Foundation

/// One line a widget can show.
struct WidgetItem: Identifiable, Hashable, Sendable {
    enum Kind: String, Sendable {
        case decisionPosted, deadline, followUp, missing, flag, decisionDate, date
    }

    let id: String
    let kind: Kind
    /// Lower is more urgent. See `WidgetAgenda.upNext`.
    let tier: Int
    /// The main line: a school, a follow-up, a flag.
    let title: String
    /// The second line.
    let detail: String
    /// yyyy-mm-dd, or "" for something with no date.
    let date: String
    /// The application a tap opens, if the item belongs to one.
    let applicationID: String?

    /// "Decision posted", "Due in 3 days", "Due today", "Overdue 2 days".
    func headline(now: Date) -> String {
        switch kind {
        case .decisionPosted: return "Decision posted"
        case .flag: return "Needs attention"
        case .missing: return "Missing in portal"
        case .decisionDate: return "Decision \(WidgetAgenda.when(date, now: now))"
        case .date: return WidgetAgenda.when(date, now: now).capitalizedFirst
        case .deadline, .followUp:
            guard !date.isEmpty else { return "To do" }
            return "Due \(WidgetAgenda.when(date, now: now))"
        }
    }
}

/// How the widgets pick and order what to show. Pure functions of a snapshot and the time, so the widget
/// can re-rank at midnight without the app.
enum WidgetAgenda {
    /// Everything worth showing, most urgent first:
    /// 0 a decision is posted and unopened;
    /// 1 an application due within 3 days (or up to 3 days past), a follow-up due within 2 days or overdue;
    /// 2 items the portal says are missing, applications due within 14 days, follow-ups due within a week;
    /// 3 open flags;
    /// 4 everything else ahead: later deadlines and follow-ups, decision dates, the student's own dates.
    /// Ties go to the sooner date.
    static func upNext(_ snapshot: WidgetSnapshot, now: Date = .now) -> [WidgetItem] {
        var items: [WidgetItem] = []
        for app in snapshot.apps {
            if app.decisionPosted {
                items.append(item(.decisionPosted, tier: 0, app.name, "Open Forge to see it", "", app, key: "p"))
                continue
            }
            if app.stage == "working", let days = ForgeDates.daysUntil(app.deadline, now: now), days >= -3 {
                let tier = days <= 3 ? 1 : days <= 14 ? 2 : 4
                let what = app.round.isEmpty ? "Application due" : "\(app.round) application due"
                items.append(item(.deadline, tier: tier, app.name, days < 0 ? "Deadline passed. Submitted?" : what, app.deadline, app, key: "d"))
            }
            if (app.stage == "working" || app.stage == "waiting"), let days = ForgeDates.daysUntil(app.decisionDate, now: now), days >= 0 {
                items.append(item(.decisionDate, tier: 4, app.name, app.decisionEstimated ? "Estimated from last year" : "Decision date", app.decisionDate, app, key: "r"))
            }
            if app.stage == "waiting", let first = app.missing.first {
                let more = app.missing.count > 1 ? " and \(app.missing.count - 1) more" : ""
                items.append(item(.missing, tier: 2, app.name, first + more, "", app, key: "m"))
            }
            for (i, followUp) in app.followUps.enumerated() {
                let days = ForgeDates.daysUntil(followUp.due, now: now)
                let tier = days.map { $0 <= 2 ? 1 : $0 <= 7 ? 2 : 4 } ?? 4
                items.append(item(.followUp, tier: tier, followUp.text, app.name, followUp.due, app, key: "f\(i)"))
            }
        }
        for (i, flag) in snapshot.flags.enumerated() {
            items.append(WidgetItem(id: "flag-\(i)", kind: .flag, tier: 3, title: flag, detail: "Across your schools", date: "", applicationID: nil))
        }
        for (i, date) in snapshot.dates.enumerated() {
            guard let days = ForgeDates.daysUntil(date.date, now: now), days >= 0 else { continue }
            items.append(WidgetItem(id: "date-\(i)", kind: .date, tier: 4, title: date.label, detail: date.detail.isEmpty ? "Your date" : date.detail, date: date.date, applicationID: nil))
        }
        return items.sorted(by: urgency)
    }

    /// Dated things ahead (deadlines, decision dates, follow-ups, the student's dates), soonest first.
    static func upcomingDates(_ snapshot: WidgetSnapshot, now: Date = .now) -> [WidgetItem] {
        let today = ForgeDates.today(now: now)
        return upNext(snapshot, now: now)
            .filter { [.deadline, .decisionDate, .followUp, .date].contains($0.kind) && $0.date >= today }
            .sorted { $0.date == $1.date ? $0.title < $1.title : $0.date < $1.date }
    }

    /// The next application deadline today or later, for the countdown.
    static func nextDeadline(_ snapshot: WidgetSnapshot, now: Date = .now) -> WidgetItem? {
        upcomingDates(snapshot, now: now).first { $0.kind == .deadline }
    }

    struct Tally: Equatable, Sendable {
        var total = 0
        /// Sent in (waiting, admitted or denied).
        var submitted = 0
        var working = 0
        var waiting = 0
        var admitted = 0
        var denied = 0
        /// Decisions posted and not yet opened.
        var posted = 0
    }

    /// Counts by stage. Withdrawn applications aren't counted, and an unopened decision counts as posted,
    /// not under its outcome.
    static func tally(_ snapshot: WidgetSnapshot) -> Tally {
        var t = Tally()
        for app in snapshot.apps where app.stage != "closed" {
            t.total += 1
            if app.decisionPosted { t.posted += 1; t.submitted += 1; continue }
            switch app.stage {
            case "working": t.working += 1
            case "waiting": t.waiting += 1; t.submitted += 1
            case "admitted": t.admitted += 1; t.submitted += 1
            case "denied": t.denied += 1; t.submitted += 1
            default: break
            }
        }
        return t
    }

    /// "today", "tomorrow", "in 5 days", "2 days ago", or "Mar 3" past two weeks out.
    static func when(_ iso: String, now: Date) -> String {
        guard let days = ForgeDates.daysUntil(iso, now: now) else { return "" }
        if days > 14 { return ForgeDates.short(iso, now: now) }
        return ForgeDates.relative(iso, now: now)
    }

    private static func item(_ kind: WidgetItem.Kind, tier: Int, _ title: String, _ detail: String, _ date: String, _ app: WidgetApp, key: String) -> WidgetItem {
        WidgetItem(id: "\(key)-\(app.id)", kind: kind, tier: tier, title: title, detail: detail, date: date, applicationID: app.id)
    }

    private static func urgency(_ a: WidgetItem, _ b: WidgetItem) -> Bool {
        if a.tier != b.tier { return a.tier < b.tier }
        // Undated items sort after dated ones in the same tier.
        let ad = a.date.isEmpty ? "9999" : a.date, bd = b.date.isEmpty ? "9999" : b.date
        return ad == bd ? a.id < b.id : ad < bd
    }
}

extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}
