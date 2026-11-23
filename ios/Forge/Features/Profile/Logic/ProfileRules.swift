import Foundation

/// Common App limits and the profile validation rules from public/hub/Profile.jsx and Onboarding.jsx.
/// Every check returns the web's own message, or nil when the value is fine.
enum ProfileRules {
    static let descriptionLimit = 150
    static let maxActivities = 10
    static let maxHonors = 5
    static let maxMustInclude = 8

    /// "4", "3.85". No signs, no exponents, like the web's `/^\d+(?:\.\d+)?$/`.
    static func isDecimal(_ value: String) -> Bool {
        value.wholeMatch(of: /\d+(?:\.\d+)?/) != nil
    }

    static func isNumber(_ value: String, in range: ClosedRange<Double>) -> Bool {
        guard isDecimal(value), let n = Double(value) else { return false }
        return range.contains(n)
    }

    static func weightedGPAError(_ raw: String) -> String? {
        let v = raw.profileTrimmed
        return v.isEmpty || isNumber(v, in: 0...6) ? nil : "Weighted GPA must be a number from 0 to 6, or left blank."
    }

    static func unweightedGPAError(_ raw: String) -> String? {
        let v = raw.profileTrimmed
        return v.isEmpty || isNumber(v, in: 0...4) ? nil : "Unweighted GPA must be a number from 0 to 4, or left blank."
    }

    static func satError(_ raw: String) -> String? {
        let v = raw.profileTrimmed
        guard !v.isEmpty else { return nil }
        let whole = v.wholeMatch(of: /\d+/) != nil
        return whole && isNumber(v, in: 400...1600) ? nil : "SAT must be a whole number from 400 to 1600, or left blank."
    }

    static func gradYearError(_ raw: String) -> String? {
        let v = raw.profileTrimmed
        guard !v.isEmpty else { return nil }
        guard v.wholeMatch(of: /\d{4}/) != nil, let n = Int(v), (1900...2100).contains(n) else {
            return "Graduation year must be a four-digit year from 1900 to 2100, or left blank."
        }
        return nil
    }

    /// Hours per week (0–168) or weeks per year (0–52). Blank is fine.
    static func amountError(_ raw: String?, label: String, max: Double) -> String? {
        let v = (raw ?? "").profileTrimmed
        guard !v.isEmpty else { return nil }
        guard let n = Double(v), n.isFinite, (0...max).contains(n) else {
            return "\(label) must be between 0 and \(Int(max))."
        }
        return nil
    }

    static func activityError(_ activity: Activity) -> String? {
        if activity.name.profileTrimmed.isEmpty { return "Give this activity a name." }
        if (activity.desc ?? "").count > descriptionLimit {
            return "Shorten the description to \(descriptionLimit) characters."
        }
        return amountError(activity.hpw, label: "Hours per week", max: 168)
            ?? amountError(activity.wpy, label: "Weeks per year", max: 52)
    }

    static func honorError(_ honor: Honor) -> String? {
        honor.title.profileTrimmed.isEmpty ? "Give this honor a title." : nil
    }

    static func apScoreError(_ score: APScore) -> String? {
        let validScore = score.score.profileTrimmed.wholeMatch(of: /[1-5]/) != nil
        guard !score.course.profileTrimmed.isEmpty, validScore else {
            return "An AP exam needs a course name and a score from 1 to 5. Put planned exams in coursework."
        }
        return nil
    }

    /// Characters left for an activity description (negative when over).
    static func descriptionRemaining(_ text: String) -> Int {
        descriptionLimit - text.count
    }

    /// Non-empty trimmed lines, as the web splits coursework and accomplishments.
    static func lines(_ text: String) -> [String] {
        text.split(whereSeparator: \.isNewline).map { String($0).profileTrimmed }.filter { !$0.isEmpty }
    }

    /// Activities in their new order with `rank` 1...n.
    static func ranked(_ activities: [Activity]) -> [Activity] {
        activities.enumerated().map { index, activity in
            var copy = activity
            copy.rank = index + 1
            return copy
        }
    }

    /// Stats are stored as "—" when unset; editors show them blank.
    static func editable(_ stat: String) -> String {
        stat.isPresentStat ? stat : ""
    }

    static func stored(_ value: String) -> String {
        let v = value.profileTrimmed
        return v.isEmpty ? "—" : v
    }
}

extension String {
    var profileTrimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
