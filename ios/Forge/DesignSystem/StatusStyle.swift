import SwiftUI

/// Tone colors for statuses, matching APP_STATUSES tones in public/hub/ApplicationParts.jsx.
extension AppStatus {
    var tone: Color {
        switch self {
        case .planning, .withdrawn: Theme.mutedSoft
        case .inProgress, .deferred, .waitlisted: Theme.amber
        case .finalChecks, .complete: Theme.teal
        case .submitted: Theme.coral
        case .admitted, .committed: Theme.success
        case .denied: Theme.danger
        default: Theme.mutedSoft
        }
    }

    var systemImage: String {
        switch stage {
        case .working: "pencil.line"
        case .waiting: "hourglass"
        case .admitted: "checkmark.seal"
        case .denied: "xmark.circle"
        default: "archivebox"
        }
    }
}

extension AppStage {
    var tone: Color {
        switch self {
        case .working: Theme.amber
        case .waiting: Theme.teal
        case .admitted: Theme.success
        case .denied: Theme.danger
        default: Theme.mutedSoft
        }
    }
}

extension CollegeTier {
    var tone: Color {
        switch self {
        case .reach: Theme.coral
        case .target: Theme.teal
        case .safety: Theme.success
        default: Theme.mutedSoft
        }
    }
}

/// Web tone names used by `Verdict.tone` and `Tag.tone` ("good", "top", "ok", "error"...).
enum ToneName {
    static func color(_ name: String) -> Color {
        switch name.lowercased() {
        case "good", "ok", "success", "green", "safety": Theme.success
        case "warn", "warning", "amber", "hold", "waiting": Theme.amber
        case "bad", "error", "danger", "red": Theme.danger
        case "top", "coral", "accent", "hot": Theme.coral
        case "info", "teal": Theme.teal
        default: Theme.mutedSoft
        }
    }
}
