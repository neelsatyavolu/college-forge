import Foundation

/// `TrackerView.schedule` (lib/check-schedule.ts `describeSchedule`): when automatic checks run.
struct CheckSchedule: Codable, Hashable, Sendable {
    /// 8, 12 or 24.
    var everyHours: Int
    /// The first check's local hour, 0-23.
    var startHour: Int
    /// IANA time zone the times are in ("America/Los_Angeles").
    var timeZone: String
    /// Local check times as "HH:00", earliest first.
    var times: [String]
    /// The next check, in milliseconds since 1970.
    var nextAt: Double?

    static let frequencies = [8, 12, 24]

    var nextDate: Date? { nextAt.map(Date.init(milliseconds:)) }
}

extension CheckSchedule {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        everyHours = c.int(.everyHours, 12)
        startHour = c.int(.startHour, 7)
        timeZone = c.string(.timeZone, "America/Los_Angeles")
        times = c.array(.times)
        nextAt = c.optionalDouble(.nextAt)
    }
}

/// Words for the check schedule, in the device's own clock style.
enum CheckScheduleText {
    /// "7 AM" for 7.
    static func hour(_ h: Int) -> String {
        var parts = DateComponents()
        parts.hour = h
        let date = Calendar.current.date(from: parts) ?? .now
        return date.formatted(.dateTime.hour())
    }

    /// "Checks around 7 AM, 3 PM and 11 PM", plus the zone when it isn't this device's.
    static func summary(_ s: CheckSchedule) -> String {
        let hours = s.times.compactMap { Int($0.prefix(2)) }.map(hour)
        let list = hours.count < 2 ? hours.joined() : hours.dropLast().joined(separator: ", ") + " and " + (hours.last ?? "")
        let zone = s.timeZone == TimeZone.current.identifier ? "" : " (\(s.timeZone) time)"
        return "Checks around \(list)\(zone)"
    }
}

/// `master` in POST /api/applications replies: the master login's state, never its password.
struct MasterLoginStatus: Codable, Hashable, Sendable {
    var on: Bool
    var username: String
    /// Schools that use it.
    var appCount: Int
}

extension MasterLoginStatus {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        on = c.bool(.on)
        username = c.string(.username)
        appCount = c.int(.appCount)
    }
}

/// The `.setupDetails` reply: what a forwarded set-up email left for the student to finish by hand.
struct SetupDetails: Codable, Hashable, Sendable {
    var username: String
    var password: String
    var pin: String
    var link: String
    /// "set" or "todo".
    var state: String
    var reason: String
}

extension SetupDetails {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        username = c.string(.username)
        password = c.string(.password)
        pin = c.string(.pin)
        link = c.string(.link)
        state = c.string(.state)
        reason = c.string(.reason)
    }
}

/// One entry in `InboxStatus.recent`. Never holds a PIN, link or password.
struct RecentArrival: Codable, Hashable, Sendable {
    var name: String
    /// "verified", "set" or "todo".
    var state: String
    var reason: String
    var receivedAt: Double

    var receivedDate: Date { Date(milliseconds: receivedAt) }

    var stateLabel: String {
        switch state {
        case "verified": "Set up"
        case "set": "Set up, sign-in not confirmed"
        default: "Needs you"
        }
    }
}

extension RecentArrival {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.string(.name)
        state = c.string(.state)
        reason = c.string(.reason)
        receivedAt = c.double(.receivedAt)
    }
}
