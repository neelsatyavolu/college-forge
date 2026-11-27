import Foundation

/// What the home-screen widgets know about the student, written by the app after every data change and
/// read by the widget extension. It holds only what the widgets draw: never an outcome the student
/// hasn't opened, never a portal login.
struct WidgetSnapshot: Codable, Equatable, Sendable {
    /// Bumped when the shape changes; the widget ignores a snapshot it can't read.
    static let currentVersion = 1

    var version = WidgetSnapshot.currentVersion
    var firstName: String
    var apps: [WidgetApp]
    /// Open flags (problems across schools), oldest first.
    var flags: [String]
    /// The student's own dates (lib/store.ts `criticalDates`).
    var dates: [WidgetDate]
}

struct WidgetApp: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var name: String
    /// AppStage raw value: working, waiting, admitted, denied, closed.
    var stage: String
    var statusLabel: String
    /// "ED", "RD", or "" when not set.
    var round: String
    /// yyyy-mm-dd or "".
    var deadline: String
    /// yyyy-mm-dd or "".
    var decisionDate: String
    var decisionEstimated: Bool
    /// The portal posted a decision the student hasn't opened. The widget says so and nothing more.
    var decisionPosted: Bool
    /// Required items the portal shows as missing.
    var missing: [String]
    var followUps: [WidgetFollowUp]
}

struct WidgetFollowUp: Codable, Equatable, Sendable {
    var text: String
    /// yyyy-mm-dd or "".
    var due: String
}

struct WidgetDate: Codable, Equatable, Sendable {
    /// yyyy-mm-dd.
    var date: String
    var label: String
    var detail: String
}

extension WidgetSnapshot {
    /// Made-up data for the widget gallery and previews.
    static let sample = WidgetSnapshot(
        firstName: "Sam",
        apps: [
            WidgetApp(id: "s1", name: "Northfield University", stage: "waiting", statusLabel: "Under review", round: "EA",
                      deadline: "", decisionDate: "", decisionEstimated: false, decisionPosted: true, missing: [], followUps: []),
            WidgetApp(id: "s2", name: "Lakeside College", stage: "working", statusLabel: "Writing", round: "RD",
                      deadline: ForgeDates.iso(.now.addingTimeInterval(3 * 86_400)), decisionDate: "", decisionEstimated: false,
                      decisionPosted: false, missing: [], followUps: [WidgetFollowUp(text: "Ask Ms. Rivera for a second letter", due: ForgeDates.iso(.now.addingTimeInterval(86_400)))]),
            WidgetApp(id: "s3", name: "Westbrook Institute", stage: "waiting", statusLabel: "Submitted", round: "RD",
                      deadline: "", decisionDate: ForgeDates.iso(.now.addingTimeInterval(40 * 86_400)), decisionEstimated: true,
                      decisionPosted: false, missing: ["Mid-year report"], followUps: []),
            WidgetApp(id: "s4", name: "Harbor State", stage: "admitted", statusLabel: "Admitted", round: "EA",
                      deadline: "", decisionDate: "", decisionEstimated: false, decisionPosted: false, missing: [], followUps: []),
            WidgetApp(id: "s5", name: "Pinecrest University", stage: "working", statusLabel: "Not started", round: "RD",
                      deadline: ForgeDates.iso(.now.addingTimeInterval(12 * 86_400)), decisionDate: "", decisionEstimated: false,
                      decisionPosted: false, missing: [], followUps: []),
        ],
        flags: [],
        dates: [
            WidgetDate(date: ForgeDates.iso(.now.addingTimeInterval(9 * 86_400)), label: "SAT scores to send", detail: "Your date"),
            WidgetDate(date: ForgeDates.iso(.now.addingTimeInterval(20 * 86_400)), label: "FAFSA priority date", detail: ""),
            WidgetDate(date: ForgeDates.iso(.now.addingTimeInterval(30 * 86_400)), label: "CSS Profile due", detail: ""),
        ]
    )
}
