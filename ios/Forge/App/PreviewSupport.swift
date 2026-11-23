import SwiftUI

/// Sample data for SwiftUI previews. Synthetic only.
enum PreviewData {
    static let tracker = TrackerView(
        revision: 3, autocheck: true, emails: true,
        flags: [TrackerFlag(id: "f1", text: "Counselor letter shows Not Started", scope: "All Common App schools", createdAt: 0)],
        apps: [
            app(id: "a1", name: "Rice University", status: .submitted, round: .ed, deadline: "2026-11-01"),
            app(id: "a2", name: "University of Michigan", status: .inProgress, round: .ea, deadline: "2026-11-01"),
            app(id: "a3", name: "Pomona College", status: .admitted, round: .rd, deadline: "2027-01-08"),
        ]
    )

    static var workspace: Workspace {
        var ws = Workspace.empty
        ws.revision = 3
        ws.applicant.name = "Sam Rivera"
        ws.applicant.gpaUnweighted = "3.9"
        ws.colleges = [College(slug: "rice", name: "Rice University", short: "Rice")]
        ws.essays.commonApp = [Essay(id: "ca-1", label: "Prompt 1", prompt: "Some students have a background...")]
        ws.onboarding.completed = true
        return ws
    }

    static func app(id: String, name: String, status: AppStatus, round: ApplicationRound, deadline: String) -> TrackedApplication {
        TrackedApplication(
            id: id, collegeId: nil, slug: nil, name: name, logo: nil, portalName: "Applicant portal", portalUrl: "",
            status: status, statusLabel: status.label, stage: status.stage, round: round, roundFromPortal: false,
            deadline: deadline, decisionDate: nil, nextDate: KeyDate(date: deadline, kind: "Deadline", estimated: false),
            decision: DecisionView(), portal: nil, missing: [], submittedAt: "", followUps: [], lastFailure: nil,
            notes: "", decisionNote: "", login: nil, lastChecked: nil, updatedAt: 0
        )
    }

    @MainActor static let services: AppServices = {
        let services = AppServices(config: AppConfig(baseURL: URL(string: "https://forge.example")!))
        services.store.seed(workspace: workspace, tracker: tracker)
        return services
    }()
}

extension View {
    /// Injects preview services with sample data.
    @MainActor
    func previewEnvironment() -> some View {
        let services = PreviewData.services
        return environment(services.session)
            .environment(services.store)
            .environment(services.router)
            .environment(services.push)
            .tint(Theme.accent)
    }
}
