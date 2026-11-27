import Foundation

/// Forge sends calendar days as "yyyy-mm-dd" strings and moments as JavaScript milliseconds.
/// These helpers mirror fmtDate / daysUntil / relDays / ago in public/hub/ApplicationParts.jsx.
enum ForgeDates {
    private static let calendar = Calendar(identifier: .gregorian)

    /// Parses "yyyy-mm-dd" as noon local time on that day (noon avoids DST edge cases).
    static func day(_ iso: String) -> Date? {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }

    /// Formats a date as "yyyy-mm-dd" in the device's time zone.
    static func iso(_ date: Date) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    static func today(now: Date = .now) -> String { iso(now) }

    /// "Nov 1", or "Nov 1, 2027" when not this year. Empty for an empty or bad string.
    static func short(_ iso: String, now: Date = .now) -> String {
        guard let date = day(iso) else { return "" }
        let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: now)
        let style = Date.FormatStyle.dateTime.month(.abbreviated).day()
        return sameYear ? date.formatted(style) : date.formatted(style.year())
    }

    /// Whole days from today to `iso` (negative when past), or nil for a bad string.
    static func daysUntil(_ iso: String, now: Date = .now) -> Int? {
        guard let target = day(iso), let start = day(today(now: now)) else { return nil }
        return calendar.dateComponents([.day], from: start, to: target).day
    }

    /// "today", "tomorrow", "in 5 days", "3 days ago".
    static func relative(_ iso: String, now: Date = .now) -> String {
        guard let n = daysUntil(iso, now: now) else { return "" }
        switch n {
        case 0: return "today"
        case 1: return "tomorrow"
        case -1: return "yesterday"
        default: return n > 0 ? "in \(n) days" : "\(-n) days ago"
        }
    }

    /// "just now", "5 min ago", "3 hr ago", "2 days ago" for a millisecond timestamp.
    static func ago(milliseconds: Double, now: Date = .now) -> String {
        let seconds = now.timeIntervalSince(Date(milliseconds: milliseconds))
        switch seconds {
        case ..<60: return "just now"
        case ..<3600: return "\(Int(seconds / 60)) min ago"
        case ..<86_400: return "\(Int(seconds / 3600)) hr ago"
        default:
            let days = Int(seconds / 86_400)
            return days == 1 ? "yesterday" : "\(days) days ago"
        }
    }
}

extension Date {
    /// Forge stores most timestamps as JavaScript milliseconds.
    init(milliseconds: Double) {
        self.init(timeIntervalSince1970: milliseconds / 1000)
    }
}
