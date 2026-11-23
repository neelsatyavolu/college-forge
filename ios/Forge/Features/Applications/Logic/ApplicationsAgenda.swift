import Foundation

/// One upcoming date on the "By date" view. Mirrors DatesView in public/hub/Applications.jsx.
struct AgendaItem: Identifiable, Hashable, Sendable {
    let id: String
    /// yyyy-mm-dd
    let date: String
    let title: String
    let detail: String
    let estimated: Bool
    /// The application to open, if the date belongs to one.
    let applicationID: String?
}

struct AgendaMonth: Identifiable, Hashable, Sendable {
    /// yyyy-mm
    let id: String
    let items: [AgendaItem]

    /// "November 2026"
    var title: String {
        guard let date = ForgeDates.day(id + "-01") else { return id }
        return date.formatted(.dateTime.month(.wide).year())
    }
}

enum ApplicationsAgenda {
    static func items(apps: [TrackedApplication], criticalDates: [CriticalDate]) -> [AgendaItem] {
        var rows: [AgendaItem] = []
        for app in apps {
            if !app.deadline.isEmpty, app.stage == .working {
                rows.append(AgendaItem(
                    id: "d-\(app.id)", date: app.deadline, title: "\(app.name) application due",
                    detail: app.round == .none ? "Deadline" : app.round.label, estimated: false, applicationID: app.id
                ))
            }
            if app.stage == .working || app.stage == .waiting, let decision = app.decisionDate, !decision.date.isEmpty {
                rows.append(AgendaItem(
                    id: "r-\(app.id)", date: decision.date, title: "\(app.name) decision",
                    detail: decision.estimated ? "Estimated from last year's release" : "Date from the portal or you",
                    estimated: decision.estimated, applicationID: app.id
                ))
            }
        }
        for (i, date) in criticalDates.enumerated() where ForgeDates.day(date.date) != nil && date.date.count == 10 {
            rows.append(AgendaItem(
                id: "c-\(i)-\(date.date)", date: date.date, title: date.label,
                detail: date.detail.isEmpty ? "Your date" : date.detail, estimated: false, applicationID: nil
            ))
        }
        return rows
    }

    /// Upcoming dates (today onward), soonest first, grouped by month.
    static func months(apps: [TrackedApplication], criticalDates: [CriticalDate], today: String = ForgeDates.today()) -> [AgendaMonth] {
        let upcoming = items(apps: apps, criticalDates: criticalDates)
            .filter { $0.date >= today }
            .sorted { $0.date == $1.date ? $0.title < $1.title : $0.date < $1.date }
        var months: [AgendaMonth] = []
        for item in upcoming {
            let key = String(item.date.prefix(7))
            if let last = months.last, last.id == key {
                months[months.count - 1] = AgendaMonth(id: key, items: last.items + [item])
            } else {
                months.append(AgendaMonth(id: key, items: [item]))
            }
        }
        return months
    }
}
