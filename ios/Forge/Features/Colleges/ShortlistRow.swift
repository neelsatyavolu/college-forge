import SwiftUI

/// One shortlist school: name and badges, major and place, supplements, deadline, admit rate and the
/// saved chance estimate.
struct ShortlistRow: View {
    let college: College
    let odds: AdmissionOdds?

    @Environment(WorkspaceStore.self) private var store
    @State private var showsOdds = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(college.name.isEmpty ? college.short : college.name)
                    .font(.forgeDisplay(.headline))
                    .foregroundStyle(Theme.ink)
                Spacer(minLength: Theme.Spacing.xs)
                if let verdict = college.verdict, !verdict.label.isEmpty {
                    Badge(text: verdict.label, tone: ToneName.color(verdict.tone))
                }
            }
            if !subtitle.isEmpty {
                Text(subtitle).font(.subheadline).foregroundStyle(Theme.body)
            }
            badges
            if let admit = college.admit, !admit.isEmpty {
                Text("Overall admission rate: \(admit)")
                    .font(.forgeNumber(.caption, weight: .regular))
                    .foregroundStyle(Theme.muted)
            }
            if let odds { oddsLine(odds) }
            if let app = store.shortlistTrackedApplication(for: college) {
                Label("Applying · \(app.statusLabel)", systemImage: "paperplane.fill")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Theme.accent)
            }
        }
        .padding(.vertical, 4)
        .sheet(isPresented: $showsOdds) {
            if let odds { ShortlistOddsSheet(name: college.name, odds: odds) }
        }
    }

    private var subtitle: String {
        [college.major ?? "", college.location ?? ""]
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    private var badges: some View {
        HStack(spacing: Theme.Spacing.xs) {
            if college.priority == true { Badge(text: "Priority", tone: Theme.coral) }
            if CollegesShortlist.isUCCampus(college) { Badge(text: "UC App", tone: Theme.teal, showsDot: false) }
            CollegesSuppBadge(load: college.supp)
            if let deadline = college.deadline, !deadline.isEmpty {
                Text(deadline).font(.caption.weight(.medium)).foregroundStyle(Theme.muted).lineLimit(1)
            }
        }
    }

    private func oddsLine(_ odds: AdmissionOdds) -> some View {
        Button { showsOdds = true } label: {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(odds.percent)% chance").font(.forgeNumber(.subheadline, weight: .semibold)).foregroundStyle(Theme.ink)
                Text("range \(odds.low)–\(odds.high)%").font(.forgeNumber(.caption, weight: .regular)).foregroundStyle(Theme.muted)
                Text("Why").font(.caption.weight(.medium)).foregroundStyle(Theme.accent)
            }
        }
        .buttonStyle(.borderless)
        .accessibilityLabel("\(odds.percent) percent chance, likely range \(odds.low) to \(odds.high) percent. Show why.")
    }
}

/// Tier, tracking and removal for a shortlist row's context menu.
struct ShortlistRowMenu: View {
    let college: College
    let remove: () -> Void
    let track: () -> Void
    let setTier: (CollegeTier) -> Void

    @Environment(WorkspaceStore.self) private var store
    @Environment(Router.self) private var router

    var body: some View {
        CollegesTierMenu(current: college.tier, choose: setTier) {
            Label("Tier: \(college.tier?.isPlanning == true ? college.tier!.displayLabel : "Not assessed")", systemImage: "flag")
        }
        if let app = store.shortlistTrackedApplication(for: college) {
            Button { router.openApplication(id: app.id) } label: { Label("Open application", systemImage: "arrow.right.circle") }
        } else {
            Button(action: track) {
                Label("Track application", systemImage: "paperplane")
            }
        }
        Button(role: .destructive, action: remove) { Label("Remove school", systemImage: "trash") }
    }
}
