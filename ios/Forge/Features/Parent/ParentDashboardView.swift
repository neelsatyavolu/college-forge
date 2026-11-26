import SwiftUI

/// One student's dashboard for a parent, read-only. The server already cut it to the student's chosen level;
/// sections it left out don't show.
struct ParentDashboardView: View {
    let studentID: String
    @Environment(WorkspaceStore.self) private var store
    @State private var data: ParentDashboardData?
    @State private var error: APIError?

    var body: some View {
        Group {
            if let data {
                ParentDashboardList(data: data, config: store.config)
                    .refreshable { await load() }
            } else if let error {
                ErrorStateView(error: error) { await load() }
            } else {
                LoadingView(label: "Loading…")
            }
        }
        .task { await load() }
    }

    private func load() async {
        do {
            data = try await store.api.parentDashboard(id: studentID)
            error = nil
        } catch {
            self.error = APIError.wrap(error)
            data = nil
        }
    }
}

private struct ParentDashboardList: View {
    let data: ParentDashboardData
    let config: AppConfig

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    Text("\(data.firstName)’s applications")
                        .font(.forgeDisplay(.title))
                        .foregroundStyle(Theme.ink)
                    Text(intro)
                        .font(.subheadline)
                        .foregroundStyle(Theme.body)
                }
                .padding(.vertical, Theme.Spacing.xs)
            }

            Section("Applications") {
                if data.progress.apps.isEmpty {
                    Text("No applications yet.").foregroundStyle(Theme.muted)
                }
                ForEach(data.progress.apps) { app in
                    ParentApplicationRow(app: app, logo: config.resolve(app.logo))
                }
            }

            if !data.progress.flags.isEmpty {
                Section("Needs attention") {
                    ForEach(data.progress.flags) { Label($0.text, systemImage: "flag").foregroundStyle(Theme.ink) }
                }
            }

            Section("Deadlines") {
                let rows = data.deadlines
                if rows.isEmpty { Text("No deadlines yet.").foregroundStyle(Theme.muted) }
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
                        Text(row.date).font(.footnote.monospaced()).foregroundStyle(Theme.muted).frame(width: 92, alignment: .leading)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.title).foregroundStyle(Theme.ink)
                            if !row.detail.isEmpty { Text(row.detail).font(.subheadline).foregroundStyle(Theme.muted) }
                        }
                    }
                }
            }

            if let colleges = data.colleges {
                Section("College list") {
                    if colleges.isEmpty { Text("No colleges on the list yet.").foregroundStyle(Theme.muted) }
                    ForEach(colleges) { college in
                        ForgeRow(title: college.name, subtitle: college.location) {
                            EmptyView()
                        } trailing: {
                            if let tier = college.tier, !tier.label.isEmpty {
                                Badge(text: tier == .safety ? "Likely" : tier.label, tone: tier.tone)
                            }
                        }
                    }
                }
            }

            if let aid = data.financialAid {
                Section("Money and letters") {
                    LabeledContent("FAFSA", value: aid.fafsaStatus.label)
                    LabeledContent("CSS Profile", value: aid.cssStatus.label)
                    ForEach(data.scholarships ?? []) { s in
                        LabeledContent { Text(s.status.label) } label: {
                            Text(s.name)
                            if let amount = s.amount, !amount.isEmpty { Text(amount) }
                        }
                    }
                    ForEach(data.recommendations ?? []) { r in
                        LabeledContent { Text(r.status.label) } label: {
                            Text("Letter: \(r.name)")
                            if let subject = r.subject, !subject.isEmpty { Text(subject) }
                        }
                    }
                }
            }

            if let profile = data.profile, let applicant = data.applicant {
                Section("Profile") {
                    LabeledContent("GPA (weighted)", value: applicant.gpaWeighted)
                    LabeledContent("GPA (unweighted)", value: applicant.gpaUnweighted)
                    LabeledContent("SAT", value: applicant.sat)
                    if !profile.intended.isEmpty { LabeledContent("Intended major", value: profile.intended) }
                    if !profile.hs.isEmpty { LabeledContent("High school", value: profile.hs) }
                    ForEach(profile.activities.sorted { $0.rank < $1.rank }, id: \.rank) { activity in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(activity.name).font(.body.weight(.medium)).foregroundStyle(Theme.ink)
                            if let desc = activity.desc, !desc.isEmpty {
                                Text(desc).font(.subheadline).foregroundStyle(Theme.muted)
                            }
                        }
                    }
                }
            }

            if let essays = data.essays {
                Section("Essays") {
                    if essays.all.isEmpty { Text("No essays yet.").foregroundStyle(Theme.muted) }
                    ForEach(essays.all) { essay in
                        let draft = data.essayDrafts[essay.id] ?? ""
                        NavigationLink {
                            ParentEssayView(essay: essay, draft: draft)
                        } label: {
                            ForgeRow(title: essay.label, subtitle: "\(essay.length(of: draft))/\(essay.limit) \(essay.unit)") { EmptyView() }
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .forgeScreenBackground()
    }

    private var intro: String {
        let cycle = data.student.cycle.isEmpty ? "" : "\(data.student.cycle) · "
        return "\(cycle)\(data.firstName) shares \(data.levelLabel): \(data.levelSummary). A decision shows here once \(data.firstName) has opened it."
    }
}

private struct ParentApplicationRow: View {
    let app: TrackedApplication
    let logo: URL?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            HStack(spacing: Theme.Spacing.sm) {
                SchoolLogo(name: app.name, url: logo, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text(app.name).font(.body.weight(.medium)).foregroundStyle(Theme.ink)
                    Text(subtitle).font(.subheadline).foregroundStyle(Theme.muted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                StatusBadge(status: app.status)
            }
            if app.decision.state == .revealed || app.decision.state == .recorded, !app.decision.portalText.isEmpty {
                Text(app.decision.portalText).font(.subheadline).foregroundStyle(Theme.ink)
            } else if let portal = app.portal, !portal.statusText.isEmpty {
                Text(portal.statusText).font(.subheadline).foregroundStyle(Theme.body).lineLimit(3)
            }
            ForEach(app.followUps) { followUp in
                Label(followUp.due.isEmpty ? followUp.text : "\(followUp.text) · \(followUp.due)", systemImage: "circle")
                    .font(.subheadline)
                    .foregroundStyle(Theme.body)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        let round = app.round == .none ? "" : app.round.label
        let date = app.deadline.isEmpty ? "" : "Due \(app.deadline)"
        return [round, date].filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

private struct ParentEssayView: View {
    let essay: Essay
    let draft: String

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                Text(essay.prompt).font(.subheadline).foregroundStyle(Theme.muted)
                Text(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "No draft yet." : draft)
                    .font(.body)
                    .foregroundStyle(Theme.body)
                    .textSelection(.enabled)
            }
            .padding(Theme.Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle(essay.label)
        .navigationBarTitleDisplayMode(.inline)
        .forgeScreenBackground()
    }
}
