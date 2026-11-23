import SwiftUI

/// "Decisions" view: posted decisions stay covered until the student opens them.
struct DecisionsList: View {
    let picker: ApplicationsModePicker
    @Environment(WorkspaceStore.self) private var store
    @State private var justRevealed: Set<String> = []

    var body: some View {
        let sections = DecisionLogic.sections(store.applications)
        List {
            Section { picker }
            if sections.isEmpty {
                ContentUnavailableView(
                    "No decisions yet",
                    systemImage: "envelope",
                    description: Text("Once you submit, schools you're waiting on show here with their expected dates.")
                )
                .listRowBackground(Color.clear)
            }
            if !sections.hidden.isEmpty {
                Section {
                    ForEach(sections.hidden) { DecisionRow(app: $0, justRevealed: $justRevealed) }
                } header: {
                    ApplicationsSectionHeader(title: "Ready when you are", count: sections.hidden.count, tone: Theme.coral)
                }
            }
            if !sections.known.isEmpty {
                Section {
                    ForEach(sections.known) { DecisionRow(app: $0, justRevealed: $justRevealed) }
                } header: {
                    ApplicationsSectionHeader(title: "Your decisions", count: sections.known.count, tone: nil)
                }
            }
            if !sections.waiting.isEmpty {
                Section {
                    ForEach(sections.waiting) { app in
                        NavigationLink(value: ApplicationRoute(id: app.id)) {
                            ForgeRow(title: app.name, subtitle: DecisionLogic.expectation(app)) {
                                SchoolLogo(name: app.name, path: app.logo, config: store.config, size: 36)
                            }
                        }
                    }
                } header: {
                    ApplicationsSectionHeader(title: "Still waiting", count: sections.waiting.count, tone: nil)
                }
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .refreshable { await store.refreshApplications() }
        .animation(.smooth, value: sections.hidden.map(\.id))
    }
}

private struct DecisionRow: View {
    let app: TrackedApplication
    @Binding var justRevealed: Set<String>
    @Environment(WorkspaceStore.self) private var store

    /// Two rows: the school (opens its detail) and the decision panel, so the panel's buttons
    /// don't trigger the navigation link.
    var body: some View {
        NavigationLink(value: ApplicationRoute(id: app.id)) {
            HStack(spacing: Theme.Spacing.sm) {
                SchoolLogo(name: app.name, path: app.logo, config: store.config, size: 36)
                Text(app.name).font(.body.weight(.medium)).foregroundStyle(Theme.ink)
            }
        }
        DecisionPanel(app: app, justRevealed: $justRevealed)
            .padding(.vertical, Theme.Spacing.xxs)
    }
}

#Preview {
    NavigationStack { DecisionsList(picker: ApplicationsModePicker(mode: .constant(.status))) }.previewEnvironment()
}
