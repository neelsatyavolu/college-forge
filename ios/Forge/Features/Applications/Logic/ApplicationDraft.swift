import Foundation

/// The editable fields of one application, as the web's details form has them.
/// Dates are "yyyy-mm-dd" or "" (unset).
struct ApplicationDraft: Equatable, Sendable {
    static let notesLimit = 4000

    var name: String
    /// `.none` means "use the portal's round" when the portal supplied one.
    var round: ApplicationRound
    var deadline: String
    var submittedAt: String
    var decisionDate: String
    var portalUrl: String
    var notes: String

    init(_ app: TrackedApplication) {
        name = app.name
        round = app.roundFromPortal ? .none : app.round
        deadline = app.deadline
        submittedAt = app.submittedAt
        decisionDate = app.ownDecisionDate
        portalUrl = app.portalUrl
        notes = app.notes
    }

    private var trimmedURL: String { portalUrl.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// A message to show when the draft can't be saved, or nil when it can.
    var validationError: String? {
        if trimmedName.isEmpty { return "Enter the school's name." }
        if !trimmedURL.isEmpty, !Self.isHTTPS(trimmedURL) { return "Enter a portal link that starts with https://." }
        if notes.count > Self.notesLimit { return "Notes can be up to \(Self.notesLimit) characters." }
        return nil
    }

    /// Only the fields that changed from `app`, or nil when nothing did.
    func edit(from app: TrackedApplication) -> ApplicationEdit? {
        let original = ApplicationDraft(app)
        var edit = ApplicationEdit()
        if trimmedName != original.name { edit.name = trimmedName }
        if round != original.round { edit.round = round }
        if deadline != original.deadline { edit.deadline = deadline }
        if submittedAt != original.submittedAt { edit.submittedAt = submittedAt }
        if decisionDate != original.decisionDate { edit.decisionDate = decisionDate }
        if trimmedURL != original.portalUrl { edit.portalUrl = trimmedURL }
        if notes != original.notes { edit.notes = notes }
        return edit == ApplicationEdit() ? nil : edit
    }

    static func isHTTPS(_ s: String) -> Bool {
        guard let url = URL(string: s), url.scheme?.lowercased() == "https", let host = url.host(), !host.isEmpty else { return false }
        return true
    }
}

/// Validation for the small add forms (follow-ups, logins, letters and scholarships).
enum ApplicationsValidation {
    static let followUpLimit = 300

    static func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }

    static func canAddFollowUp(_ text: String) -> Bool {
        let t = trimmed(text)
        return !t.isEmpty && t.count <= followUpLimit
    }

    static func canSaveLogin(username: String, password: String) -> Bool {
        !trimmed(username).isEmpty && !password.isEmpty
    }

    /// Scholarship links must be web links (the server rejects anything else).
    static func isWebLink(_ s: String) -> Bool {
        let t = trimmed(s).lowercased()
        return (t.hasPrefix("https://") || t.hasPrefix("http://")) && URL(string: trimmed(s))?.host() != nil
    }

    /// "Checked 3 portals." / "Checked 3. 1 couldn't be read; see each school for why."
    static func checkSummary(total: Int, failed: Int) -> String {
        if failed > 0 { return "Checked \(total). \(failed) couldn't be read; see each school for why." }
        return "Checked \(total) portal\(total == 1 ? "" : "s")."
    }

    /// "Brought over 4 schools and 1 login for schools already here."
    static func importSummary(added: Int, linked: Int) -> String {
        guard added > 0 || linked > 0 else { return "Everything from College Apps is already here." }
        var s = "Brought over \(added) school\(added == 1 ? "" : "s")"
        if linked > 0 { s += " and \(linked) login\(linked == 1 ? "" : "s") for schools already here" }
        return s + "."
    }
}
