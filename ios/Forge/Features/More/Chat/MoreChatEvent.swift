import Foundation

/// One line of the `/api/ai/chat` NDJSON stream.
enum MoreChatEvent: Equatable, Sendable {
    case delta(String)
    case status(String)
    case tool(name: String, path: String)
    case error(String)
    case done
    /// A line this version doesn't know; ignored.
    case other

    /// Parses one line. Blank lines give nil; unreadable lines give `.other`.
    static func parse(_ line: String) -> MoreChatEvent? {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        guard let data = trimmed.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String else { return .other }
        let string = { (key: String) in object[key] as? String ?? "" }
        switch type {
        case "delta": return .delta(string("text"))
        case "status": return .status(MoreChatStatus.soften(string("message")))
        case "tool": return .tool(name: string("name"), path: string("path"))
        case "error":
            let message = string("message")
            return .error(message.isEmpty ? "The provider couldn't finish the reply." : message)
        case "done": return .done
        default: return .other
        }
    }
}

/// Friendly progress lines while the copilot works. Mirrors public/hub/chat-status.js.
enum MoreChatStatus {
    static let rounds = [
        "Thinking…", "Looking things up…", "Putting it together…", "Still working…", "Almost there…",
        "Finishing touches…", "Double-checking…", "Wrapping up…", "One more step…", "Nearly done…",
    ]

    static func round(_ n: Int) -> String {
        guard n > 1 else { return rounds[0] }
        return rounds[min(n - 1, rounds.count - 1)]
    }

    static func tool(_ name: String, path: String = "") -> String {
        let detail = path.isEmpty ? "" : (path.count < 60 ? path : String(path.prefix(48)) + "…")
        switch name {
        case "web_search": return detail.isEmpty ? "Searching the web…" : "Searching the web for “\(detail)”…"
        case "web_fetch": return detail.isEmpty ? "Reading a web page…" : "Reading page \(detail)…"
        case "read_upload", "read_file": return detail.isEmpty ? "Reading your file…" : "Reading \(detail)…"
        case "set_applicant_snapshot": return "Updating your overview snapshot…"
        case "set_profile_identity": return "Saving your profile…"
        case "set_testing": return "Saving test scores…"
        case "set_coursework": return "Saving coursework…"
        case "set_activities": return "Saving activities…"
        case "set_honors": return "Saving awards & honors…"
        case "upsert_college": return detail.isEmpty ? "Updating your school list…" : "Updating \(detail)…"
        case "remove_college": return "Updating your school list…"
        case "set_early_decision": return "Setting early-decision school…"
        case "set_application_rounds": return "Balancing your application rounds…"
        case "set_critical_dates": return "Updating important dates…"
        case "set_essays": return "Updating essay prompts…"
        case "set_recommendations": return "Updating recommenders…"
        case "set_scholarships": return "Updating scholarships…"
        case "set_financial_aid": return "Updating financial aid…"
        case "read_application": return "Reading your profile and essays…"
        case "set_application_read": return "Saving what stood out in your application…"
        case "set_admission_odds": return "Saving a chance estimate…"
        case "set_application_status": return "Updating application status…"
        default: return "Updating your hub…"
        }
    }

    /// Softens technical status lines from older servers.
    static func soften(_ message: String) -> String {
        let m = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !m.isEmpty else { return "Working…" }
        let lower = m.lowercased()
        if lower.hasPrefix("continuing"), lower.contains("round") {
            let digits = lower.components(separatedBy: "round").dropFirst().first?
                .trimmingCharacters(in: .whitespaces).prefix { $0.isNumber } ?? ""
            return round(Int(digits) ?? 2)
        }
        if lower.range(of: #"^thinking\s*:"#, options: .regularExpression) != nil { return "Thinking it through…" }
        if lower.hasPrefix("writing answer") { return "Writing a reply…" }
        if let range = m.range(of: #"updating (your )?hub:\s*"#, options: [.regularExpression, .caseInsensitive]) {
            let rest = String(m[range.upperBound...])
            let name = rest.prefix { !$0.isWhitespace && $0 != "(" }
            var path = ""
            if let open = rest.firstIndex(of: "("), let close = rest[open...].firstIndex(of: ")") {
                path = String(rest[rest.index(after: open)..<close])
            }
            return tool(String(name), path: path)
        }
        if lower.contains("tool-read budget") || lower.contains("tool round") { return "That took a lot of steps…" }
        return m
    }
}
