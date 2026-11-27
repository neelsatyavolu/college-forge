import SwiftUI

/// Photo and its credit, rank eyebrow, name, place and badges.
struct CollegeDetailHero: View {
    let college: College
    let config: AppConfig
    var extras: ExploreDetailExtras?

    private var eyebrow: String {
        if let rank = college.rank, rank > 0 { return "U.S. News #\(rank) · National Universities" }
        if let lac = extras?.lacRank, lac > 0 { return "U.S. News #\(lac) · Liberal Arts Colleges" }
        return "U.S. Dept. of Education data"
    }

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 0) {
                CollegePhoto(name: college.name, url: config.resolve(college.photo))
                    .frame(maxWidth: .infinity)
                    .frame(height: 190)
                    .clipped()
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    CollegePhotoCreditLine(credit: extras?.credit)
                    Eyebrow(text: eyebrow)
                    Text(college.name)
                        .font(.forgeDisplay(.title))
                        .foregroundStyle(Theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    let place = CollegesFormat.place(college)
                    if !place.isEmpty {
                        Text(place).font(.subheadline).foregroundStyle(Theme.muted)
                    }
                    badges
                }
                .padding(Theme.Spacing.md)
            }
            .listRowInsets(EdgeInsets())
        }
    }

    @ViewBuilder private var badges: some View {
        let tags = college.tags ?? []
        if college.verdict != nil || college.tier?.isPlanning == true || !tags.isEmpty || college.priority == true {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.Spacing.xs) {
                    if college.priority == true { Badge(text: "Priority", tone: Theme.coral) }
                    if let verdict = college.verdict, !verdict.label.isEmpty {
                        Badge(text: verdict.label, tone: ToneName.color(verdict.tone))
                    }
                    if let tier = college.tier, tier.isPlanning { CollegesTierBadge(tier: tier) }
                    ForEach(Array(tags.enumerated()), id: \.offset) { _, tag in
                        Badge(text: tag.label, tone: ToneName.color(tag.tone), showsDot: false)
                    }
                }
            }
            .scrollClipDisabled()
            .padding(.top, Theme.Spacing.xxs)
        }
    }
}

struct CollegeAdmissionsSection: View {
    let college: College

    var body: some View {
        Section("Admissions") {
            row("Admit rate", college.admit)
            row("SAT middle 50%", college.satRange)
            row("ACT middle 50%", college.act)
            row("Average GPA", college.gpa)
            row("Undergraduates", college.size)
        }
    }

    private func row(_ label: String, _ value: String?) -> some View {
        LabeledValueRow(label: label, value: value ?? "")
            .font(.forgeNumber(.body, weight: .regular))
    }
}

/// "At a glance": only the values that are known, plus the school's links.
struct CollegeGlanceSection: View {
    let college: College
    var extras: ExploreDetailExtras?

    private var rows: [(String, String)] {
        let place = college.location?.components(separatedBy: " · ").first
        let pairs: [(String, String?)] = [
            ("Location", place),
            ("Campus", CollegesFormat.capitalized(college.setting)),
            ("Type", college.ownership),
            ("SAT/ACT policy", college.testPolicy),
            ("Pell grant recipients", college.pellRate),
            ("Meets full need", extras?.facets.meetsNeed == true ? "Yes" : nil),
            ("HBCU", extras?.hbcu == true || extras?.facets.hbcu == true ? "Yes" : nil),
            ("Women’s college", extras?.women == true || extras?.facets.women == true ? "Yes" : nil),
        ]
        return pairs.compactMap { label, value in value?.isEmpty == false ? (label, value!) : nil }
    }

    var body: some View {
        let website = college.url.flatMap(URL.init(string:))
        let calculator = college.priceCalcUrl.flatMap(URL.init(string:))
        if !rows.isEmpty || website != nil || calculator != nil {
            Section("At a glance") {
                ForEach(rows, id: \.0) { LabeledValueRow(label: $0.0, value: $0.1) }
                if let website {
                    Link(destination: website) { Label("College website", systemImage: "safari") }
                }
                if let calculator {
                    Link(destination: calculator) { Label("Net price calculator", systemImage: "dollarsign.circle") }
                }
            }
        }
    }
}

struct CollegeCostSection: View {
    let college: College
    let isLoading: Bool

    var body: some View {
        Section {
            row("Average net price", college.netPrice)
            row("Cost of attendance", college.coa)
            row("Tuition, in-state", college.tuitionIn)
            row("Tuition, out-of-state", college.tuitionOut)
            row("4-year graduation", college.grad4)
            row("6-year graduation", college.grad6)
            row("Freshman retention", college.retention)
            row("Median earnings, 10 yrs", college.earnings)
        } header: {
            HStack {
                Text("Cost & outcomes")
                Spacer()
                if isLoading { ProgressView().controlSize(.mini) }
            }
        } footer: {
            Text("Average net price is what families paid after grants, not your aid offer. Use the college’s net price calculator for an estimate.")
        }
    }

    private func row(_ label: String, _ value: String?) -> some View {
        LabeledValueRow(label: label, value: value ?? "")
            .font(.forgeNumber(.body, weight: .regular))
    }
}

struct CollegePlansSection: View {
    let college: College
    /// Deadlines from Forge's notes, used when nothing is saved for the school.
    var researchDeadlines: [ExploreDeadline] = []

    var body: some View {
        let plans = college.plans ?? []
        let deadlines = college.deadlines ?? []
        let fromNotes = plans.isEmpty && deadlines.isEmpty ? researchDeadlines : []
        Section {
            if !fromNotes.isEmpty {
                ExploreDeadlineRows(deadlines: fromNotes)
            } else if plans.isEmpty, deadlines.isEmpty {
                Text("Plan-specific admit rates and deadlines aren’t in the federal dataset. The overall admit rate (\(CollegesFormat.dash(college.admit))) describes a past applicant pool, not your odds. Confirm plans and deadlines on the college’s admissions website.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            }
            ForEach(Array(plans.enumerated()), id: \.offset) { _, plan in
                LabeledValueRow(label: "\(plan.plan) admit rate", value: plan.rate)
            }
            ForEach(Array(deadlines.enumerated()), id: \.offset) { _, deadline in
                LabeledValueRow(label: "\(deadline.plan) deadline", value: deadline.date, systemImage: "calendar")
            }
        } header: {
            Text("Admission plans & deadlines")
        } footer: {
            if !fromNotes.isEmpty { Text("From the college’s site, via Forge’s notes.") }
        }
    }
}

struct CollegeTransferSection: View {
    let college: College
    var switching: [ExploreSwitch] = []

    var body: some View {
        Section {
            ExploreSwitchingRows(switching: switching)
            if let transfer = college.transfer, !transfer.isEmpty {
                Text(transfer).font(.subheadline).foregroundStyle(Theme.ink)
            } else if switching.isEmpty {
                Text("Check \(college.short.isEmpty ? college.name : college.short)’s official department and admissions pages for restrictions on changing majors or colleges.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            }
        } header: {
            Text(switching.isEmpty ? "Switching majors" : "Switching majors · Forge’s read of each school’s rules")
        } footer: {
            Text("A dash means the data is unavailable. Verify testing policies and deadlines for your application year.")
                .padding(.bottom, Theme.Spacing.md)
        }
    }
}
