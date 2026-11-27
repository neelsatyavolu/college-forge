import SwiftUI

/// "Everything on file": headline numbers and a row for each editor.
struct ProfileSummarySections: View {
    @Environment(WorkspaceStore.self) private var store

    var body: some View {
        let ws = store.workspace
        let p = ws.profile
        let overLimit = p.activities.filter { ($0.desc ?? "").count > ProfileRules.descriptionLimit }.count

        Section {
            ProfileStatsGrid(applicant: ws.applicant, profile: p)
            NavigationLink(value: ProfileRoute.about) {
                SummaryRow(title: "About you", systemImage: "person", detail: aboutDetail(ws))
            }
            NavigationLink(value: ProfileRoute.academics) {
                SummaryRow(title: "GPA and SAT", systemImage: "graduationcap", detail: academicsDetail(ws))
            }
            NavigationLink(value: ProfileRoute.apScores) {
                SummaryRow(title: "AP exam scores", systemImage: "checkmark.seal",
                           detail: p.testing.aps.isEmpty ? "None yet" : p.testing.aps.map(\.score).joined(separator: " · "))
            }
            NavigationLink(value: ProfileRoute.coursework) {
                SummaryRow(title: "Coursework", systemImage: "books.vertical", detail: courseworkDetail(p.coursework))
            }
            NavigationLink(value: ProfileRoute.activities) {
                SummaryRow(title: "Activities", systemImage: "figure.run", detail: "\(p.activities.count)/\(ProfileRules.maxActivities)",
                           warning: overLimit > 0 ? "\(overLimit) over \(ProfileRules.descriptionLimit) characters" : nil)
            }
            NavigationLink(value: ProfileRoute.honors) {
                SummaryRow(title: "Honors and awards", systemImage: "star", detail: "\(p.honors.count)/\(ProfileRules.maxHonors)")
            }
        } header: {
            Text("Your profile")
        } footer: {
            Text("Activities follow Common App limits: up to \(ProfileRules.maxActivities), with \(ProfileRules.descriptionLimit)-character descriptions. Up to \(ProfileRules.maxHonors) honors.")
        }
    }

    private func aboutDetail(_ ws: Workspace) -> String {
        let p = ws.profile
        if !p.hs.isEmpty && !p.gradYear.isEmpty { return "\(p.hs) · Class of \(p.gradYear)" }
        if !p.hs.isEmpty { return p.hs }
        return ws.applicant.name.isEmpty ? "Not filled in" : ws.applicant.name
    }

    private func academicsDetail(_ ws: Workspace) -> String {
        let a = ws.applicant
        let parts = [a.gpaWeighted.isPresentStat ? "\(a.gpaWeighted) W" : nil,
                     a.gpaUnweighted.isPresentStat ? "\(a.gpaUnweighted) UW" : nil,
                     ws.profile.testing.sat.isPresentStat ? "SAT \(ws.profile.testing.sat)" : nil].compactMap { $0 }
        return parts.isEmpty ? "Not filled in" : parts.joined(separator: " · ")
    }

    private func courseworkDetail(_ c: Coursework) -> String {
        let n = c.honors.count + c.aps.count + c.senior.count
        return n == 0 ? "None yet" : "\(n) course\(n == 1 ? "" : "s")"
    }
}

private struct SummaryRow: View {
    let title: String
    let systemImage: String
    let detail: String
    var warning: String?

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: systemImage)
                .foregroundStyle(Theme.accent)
                .frame(width: 26)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).foregroundStyle(Theme.ink)
                Text(detail).font(.footnote).foregroundStyle(Theme.muted).lineLimit(2)
                if let warning {
                    Label(warning, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(Theme.coral)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Weighted GPA, SAT, AP exams and honors, like the web's stat cards.
private struct ProfileStatsGrid: View {
    let applicant: Applicant
    let profile: Profile
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: Theme.Spacing.sm, alignment: .topLeading),
                            count: typeSize.isAccessibilitySize ? 1 : 2)
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            LazyVGrid(columns: columns, alignment: .leading, spacing: Theme.Spacing.md) {
                Stat(label: "Weighted GPA", value: applicant.gpaWeighted, hint: "\(applicant.gpaUnweighted.isPresentStat ? applicant.gpaUnweighted : "—") unweighted")
                Stat(label: "SAT", value: profile.testing.sat, hint: profile.testing.satNote.isEmpty ? "From testing" : profile.testing.satNote)
                Stat(label: "AP exams", value: "\(profile.testing.aps.count)", hint: profile.testing.aps.isEmpty ? "None yet" : "Scores on file")
                Stat(label: "Honors", value: "\(profile.honors.count)", hint: "\(profile.honors.filter { $0.top == true }.count) highlighted")
            }
            // GPA by year, with the trend and 10th–11th GPA the server derives from it.
            if let years = GPAYears.summary(applicant) {
                Text(years).font(.footnote).monospacedDigit().foregroundStyle(Theme.body)
            }
        }
        .padding(.vertical, Theme.Spacing.xs)
    }
}

private struct Stat: View {
    let label: String
    let value: String
    let hint: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Eyebrow(text: label)
            Text(value.isPresentStat ? value : "—")
                .font(.forgeNumber(.title2, weight: .semibold))
                .foregroundStyle(value.isPresentStat ? Theme.ink : Theme.mutedSoft)
            Text(hint).font(.caption).foregroundStyle(Theme.muted).lineLimit(2)
        }
        .accessibilityElement(children: .combine)
    }
}
