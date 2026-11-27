import SwiftUI

/// Add button plus a menu for portal checks, automatic checking and the import flows.
struct ApplicationsToolbar: ToolbarContent {
    @Binding var sheet: ApplicationsSheet?
    @Environment(WorkspaceStore.self) private var store
    @Environment(PortalCheckModel.self) private var checks
    @Environment(Router.self) private var router
    @State private var error: APIError?

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                let withLogin = store.applications.filter(\.hasSavedPassword)
                if !withLogin.isEmpty {
                    Button {
                        Task { await checks.check(withLogin, store: store) }
                    } label: {
                        Label(checks.isChecking ? "Checking portals…" : "Check portals now", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .disabled(checks.isChecking)
                }
                Section("Automatic checks") {
                    Toggle("Check portals automatically", isOn: binding(\.autocheck, action: { .autocheck(on: $0) }))
                    Toggle("Email me when a portal changes", isOn: binding(\.emails, action: { .emails(on: $0) }))
                        .disabled(!store.tracker.autocheck)
                }
                if let schedule = store.tracker.schedule {
                    Section(CheckScheduleText.summary(schedule)) {
                        Picker("How often", selection: scheduleBinding(schedule, \.everyHours)) {
                            ForEach(CheckSchedule.frequencies, id: \.self) { h in
                                Text(h == 24 ? "Once a day" : "Every \(h) hours").tag(h)
                            }
                        }
                        .pickerStyle(.menu)
                        Picker("First check", selection: scheduleBinding(schedule, \.startHour)) {
                            ForEach(0..<24, id: \.self) { h in Text(CheckScheduleText.hour(h)).tag(h) }
                        }
                        .pickerStyle(.menu)
                    }
                    .disabled(!store.tracker.autocheck)
                }
                Section {
                    Button { sheet = .importCollegeApps } label: { Label("Bring schools from College Apps", systemImage: "square.and.arrow.down") }
                    Button { sheet = .forwardEmails } label: { Label("Forward portal emails", systemImage: "envelope.arrow.triangle.branch") }
                    Button { sheet = .masterLogin } label: { Label("Master login", systemImage: "key.horizontal") }
                    Button { router.applicationsPath.append(ApplicationsDestination.lettersAid) } label: {
                        Label("Letters & financial aid", systemImage: "envelope.open")
                    }
                }
            } label: {
                Label("More", systemImage: "ellipsis.circle")
            }
            .errorAlert($error)
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button { sheet = .add } label: { Label("Add a school", systemImage: "plus") }
        }
        if let progress = checks.progress {
            ToolbarItem(placement: .bottomBar) {
                HStack(spacing: Theme.Spacing.xs) {
                    ProgressView().controlSize(.small)
                    Text(progress).font(.footnote).foregroundStyle(Theme.muted)
                }
            }
        }
    }

    /// A schedule field that saves the whole schedule in this device's time zone.
    private func scheduleBinding(_ schedule: CheckSchedule, _ key: WritableKeyPath<CheckSchedule, Int>) -> Binding<Int> {
        Binding {
            schedule[keyPath: key]
        } set: { value in
            var next = schedule
            next[keyPath: key] = value
            next.timeZone = TimeZone.current.identifier
            Task {
                do {
                    try await store.perform(.schedule(everyHours: next.everyHours, startHour: next.startHour, timeZone: next.timeZone)) {
                        $0.schedule?[keyPath: key] = value
                    }
                    Haptics.selection()
                } catch {
                    self.error = APIError.wrap(error)
                }
            }
        }
    }

    /// A toggle bound to a tracker setting that saves through the given action.
    private func binding(_ key: WritableKeyPath<TrackerView, Bool>, action: @escaping (Bool) -> ApplicationAction) -> Binding<Bool> {
        Binding {
            store.tracker[keyPath: key]
        } set: { on in
            Task {
                do {
                    try await store.perform(action(on)) { $0[keyPath: key] = on }
                    Haptics.selection()
                } catch {
                    self.error = APIError.wrap(error)
                }
            }
        }
    }
}
