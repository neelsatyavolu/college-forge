import Foundation
import Observation
import WidgetKit

/// Keeps the widget snapshot in step with the store: writes it whenever the applications or the student's
/// dates change, and clears it on sign-out. Runs in the background too, so a portal push that wakes the
/// app updates the widgets.
@MainActor
final class WidgetSync {
    private let store: WorkspaceStore
    private var lastWritten: WidgetSnapshot?

    init(store: WorkspaceStore) {
        self.store = store
    }

    /// Starts watching the store. Call once.
    func start() {
        lastWritten = WidgetSnapshotStore.load()
        watch()
    }

    /// Forgets the student's data (sign-out).
    func clear() {
        lastWritten = nil
        WidgetSnapshotStore.clear()
        reloadWidgets()
    }

    private func watch() {
        let snapshot = withObservationTracking {
            store.hasLoaded ? Self.snapshot(workspace: store.workspace, tracker: store.tracker) : nil
        } onChange: { [weak self] in
            Task { @MainActor in self?.watch() }
        }
        // Before the first load there is nothing new to say; keep what the widget already shows.
        guard let snapshot, snapshot != lastWritten else { return }
        if WidgetSnapshotStore.save(snapshot) {
            lastWritten = snapshot
            reloadWidgets()
        }
    }

    private func reloadWidgets() {
        WidgetCenter.shared.reloadAllTimelines()
    }

    static func snapshot(workspace: Workspace, tracker: TrackerView) -> WidgetSnapshot {
        WidgetSnapshot(
            firstName: workspace.applicant.name.split(separator: " ").first.map(String.init) ?? "",
            apps: tracker.apps.map(widgetApp),
            flags: tracker.flags.map(\.text),
            dates: workspace.criticalDates
                .filter { $0.date.count == 10 && ForgeDates.day($0.date) != nil }
                .map { WidgetDate(date: $0.date, label: $0.label, detail: $0.detail) }
        )
    }

    private static func widgetApp(_ app: TrackedApplication) -> WidgetApp {
        // An unopened decision keeps its outcome out of the snapshot, even when the status already has it.
        let hidden = app.decision.state == .hidden
        return WidgetApp(
            id: app.id,
            name: app.name,
            stage: hidden ? AppStage.waiting.rawValue : app.stage.rawValue,
            statusLabel: hidden ? "Decision posted" : app.statusLabel,
            round: app.round.short,
            deadline: app.deadline,
            decisionDate: app.decisionDate?.date ?? "",
            decisionEstimated: app.decisionDate?.estimated ?? false,
            decisionPosted: hidden,
            missing: app.missing,
            followUps: app.followUps.filter { !$0.done }.map { WidgetFollowUp(text: $0.text, due: $0.due) }
        )
    }
}
