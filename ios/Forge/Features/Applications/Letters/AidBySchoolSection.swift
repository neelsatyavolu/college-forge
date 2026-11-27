import SwiftUI

/// Which aid forms each school on the Applications tab asks for (GET /api/aid), with its aid dates and a
/// one-tap "Add to-dos" that files the missing forms as follow-ups on that school (public/hub/AidBySchool.jsx).
struct AidBySchoolSection: View {
    @Binding var error: APIError?
    @Environment(WorkspaceStore.self) private var store
    @State private var plan: AidPlan?
    @State private var adding: String?

    var body: some View {
        Section {
            if let plan {
                if plan.schools.isEmpty {
                    Text("Add schools on the Applications tab to see which aid forms each one asks for.")
                        .foregroundStyle(Theme.muted)
                }
                ForEach(plan.schools) { school in
                    AidSchoolRow(school: school, adding: adding == school.appId) { addTodos(school) }
                        .disabled(adding != nil)
                }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        } header: {
            ApplicationsSectionHeader(title: "Aid by school", count: plan?.schools.count, tone: nil)
        } footer: {
            if let totals = plan?.totals, plan?.schools.isEmpty == false {
                Text("\(totals.cssSchools) need the CSS Profile\(totals.idocSchools > 0 ? ", \(totals.idocSchools) use IDOC" : ""). Read from each school's aid pages; open the source to confirm.")
            }
        }
        .task(id: store.workspace.revision) { await load() }
    }

    private func load() async {
        do { plan = try await store.api.aidPlan() } catch { if plan == nil { self.error = APIError.wrap(error) } }
    }

    private func addTodos(_ school: AidSchool) {
        adding = school.appId
        Task {
            defer { adding = nil }
            do {
                // One at a time; the server skips a to-do that is already open.
                for todo in school.todos {
                    _ = try await store.perform(.followUpAdd(id: school.appId, text: todo.text, due: todo.due.isEmpty ? nil : todo.due))
                }
                Haptics.success()
                await load()
            } catch {
                self.error = APIError.wrap(error)
            }
        }
    }
}

private struct AidSchoolRow: View {
    let school: AidSchool
    let adding: Bool
    let onAdd: () -> Void

    private var nextDates: [AidDeadline] {
        let today = ForgeDates.today()
        return Array(school.deadlines.filter { $0.date >= today }.prefix(2))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(school.name).font(.body.weight(.medium)).foregroundStyle(Theme.ink)
                Spacer()
                if school.ignoreAid {
                    Badge(text: "No aid", tone: Theme.mutedSoft)
                } else {
                    Badge(text: school.css.label, tone: school.css == .required ? Theme.amber : Theme.mutedSoft)
                    if school.idoc { Badge(text: "IDOC", tone: Theme.teal) }
                }
            }
            ForEach(nextDates, id: \.self) { d in
                Text("\(d.plan) · \(ForgeDates.short(d.date).isEmpty ? d.date : ForgeDates.short(d.date))")
                    .font(.subheadline).foregroundStyle(Theme.muted)
            }
            ForEach(school.followUps) { f in
                Label(f.text, systemImage: "circle").font(.subheadline).foregroundStyle(Theme.muted)
            }
            HStack {
                if let source = URL(string: school.cssSource), !school.cssSource.isEmpty {
                    Link(destination: source) { Label("Source", systemImage: "arrow.up.right.square") }.font(.subheadline)
                }
                Spacer()
                if !school.todos.isEmpty {
                    Button(adding ? "Adding…" : (school.todos.count == 1 ? "Add to-do" : "Add \(school.todos.count) to-dos"), action: onAdd)
                        .buttonStyle(.bordered).font(.subheadline)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
