import SwiftUI

// School-page sections built from Forge's own sourced data (web public/hub/ExploreNotes.jsx): other
// publications' ranks, research notes, international aid and nursing, net price by income, essay prompts,
// campus grades and the photo credit. Each section hides itself when it has nothing to show.

/// "Photo: Jane Doe, CC BY-SA 4.0, via Wikimedia Commons", linking to the file page, as the license asks.
struct CollegePhotoCreditLine: View {
    let credit: ExplorePhotoCredit?

    var body: some View {
        if let credit, let page = ExploreLinks.safeURL(credit.page) {
            Link(destination: page) {
                Text("Photo: \(credit.by.isEmpty ? "Unknown author" : credit.by), \(credit.license), via Wikimedia Commons")
                    .font(.caption2)
                    .foregroundStyle(Theme.mutedSoft)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            .accessibilityHint("Opens the photo’s Wikimedia Commons page")
        }
    }
}

/// "cds.yale.edu · 2026-08-01 · third-party ↗" under a note.
struct ExploreSourceLink: View {
    let url: String?
    var date: String?
    var thirdParty = false

    var body: some View {
        if let link = ExploreLinks.safeURL(url) {
            Link(destination: link) {
                Text([ExploreLinks.host(url), date, thirdParty ? "third-party" : nil].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · ") + " ↗")
                    .font(.caption)
                    .foregroundStyle(Theme.accent)
                    .lineLimit(1)
            }
        }
    }
}

struct CollegeRankingsSection: View {
    let rankings: [String: Int]
    let rank: Int?
    let lacRank: Int?

    static let lists: [(key: String, publisher: String, list: String)] = [
        ("usn", "U.S. News", "National"),
        ("lac", "U.S. News", "Liberal arts"),
        ("forbes", "Forbes", "America’s Top Colleges"),
        ("niche", "Niche", "Best Colleges"),
        ("wsj", "WSJ", "Best Colleges"),
        ("prPrivate", "Princeton Review", "Best value, private"),
        ("prPublic", "Princeton Review", "Best value, public"),
        ("forge", "Forge", "Career outcomes"),
    ]

    private var rows: [(key: String, publisher: String, list: String, rank: Int)] {
        var ranks = rankings
        if let rank, rank > 0, ranks["usn"] == nil { ranks["usn"] = rank }
        if let lacRank, lacRank > 0, ranks["lac"] == nil { ranks["lac"] = lacRank }
        return Self.lists.compactMap { item in ranks[item.key].map { (item.key, item.publisher, item.list, $0) } }
    }

    var body: some View {
        let rows = rows
        if !rows.isEmpty {
            Section("Rankings") {
                ForEach(rows, id: \.key) { row in
                    LabeledContent {
                        Text("#\(row.rank)").font(.forgeNumber(.body)).foregroundStyle(Theme.ink)
                    } label: {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(row.publisher).foregroundStyle(Theme.ink)
                            Text(row.list).font(.caption).foregroundStyle(Theme.muted)
                        }
                    }
                }
            }
        }
    }
}

/// "What to know": Forge's sourced notes, each with its source.
struct CollegeNotesSection: View {
    let research: ExploreResearch?

    var body: some View {
        if let research, !research.notes.isEmpty {
            Section {
                ForEach(Array(research.notes.enumerated()), id: \.offset) { _, note in
                    ExploreNoteRow(label: note.label, value: note.value) {
                        ExploreSourceLink(url: note.sourceUrl, date: note.checkedAt, thirdParty: note.thirdParty)
                    }
                }
            } header: {
                Text("What to know")
            } footer: {
                Text(research.checkedAt.isEmpty ? "Forge notes" : "Forge notes · checked \(research.checkedAt)")
            }
        }
    }
}

struct ExploreNoteRow<Source: View>: View {
    let label: String
    let value: String
    @ViewBuilder let source: () -> Source

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption.weight(.semibold)).foregroundStyle(Theme.muted)
            Text(value).font(.subheadline).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
            source()
        }
        .padding(.vertical, 2)
    }
}

struct CollegeSpecialNotesSection: View {
    let intlAid: ExploreIntlAid?
    let nursing: ExploreNursing?

    static func nursingLine(_ entry: String) -> String? {
        switch entry {
        case "direct": "First-years are admitted straight into the BSN."
        case "both": "Some first-years get a direct nursing seat; the rest apply later."
        case "competitive": "Pre-nursing first, then a competitive application to the major."
        case "none": "No four-year BSN for first-years."
        default: nil
        }
    }

    var body: some View {
        let aid = intlAid.flatMap { $0.label.isEmpty ? nil : $0 }
        let nursingText = nursing.flatMap { n in Self.nursingLine(n.entry).map { [$0, n.note].compactMap { $0 }.joined(separator: " ") } }
        if aid != nil || nursingText != nil {
            Section("International students & nursing") {
                if let aid {
                    ExploreNoteRow(label: "International students", value: aid.label.prefix(1).uppercased() + aid.label.dropFirst() + ".") {
                        ExploreSourceLink(url: aid.source)
                    }
                }
                if let nursingText {
                    ExploreNoteRow(label: "Nursing", value: nursingText) {
                        ExploreSourceLink(url: nursing?.sourceUrl)
                    }
                }
            }
        }
    }
}

/// Net price by family income from the college's own figures, and the earnings spread.
struct CollegeIncomeSection: View {
    let research: ExploreResearch?
    let earningsRange: ExploreEarningsRange?

    var body: some View {
        let bands = research?.byIncome ?? []
        if !bands.isEmpty || earningsRange != nil {
            Section {
                ForEach(bands, id: \.band) { band in
                    LabeledValueRow(label: band.band, value: band.value)
                        .font(.forgeNumber(.body, weight: .regular))
                }
                if let source = bands.first?.sourceUrl { ExploreSourceLink(url: source) }
            } header: {
                Text(bands.isEmpty ? "Earnings" : "Net price by family income")
            } footer: {
                if let range = earningsRange {
                    Text("Ten years after starting, the middle half of former students earned $\(range.p25.formatted())–$\(range.p75.formatted()).")
                }
            }
        }
    }
}

struct CollegeEssaysSection: View {
    let essays: [ExploreEssay]

    var body: some View {
        if !essays.isEmpty {
            Section {
                ForEach(Array(essays.enumerated()), id: \.offset) { _, essay in
                    VStack(alignment: .leading, spacing: 4) {
                        let meta = [essay.label, essay.limit.map { "\($0) \(essay.unit ?? "words")" }, essay.required == false ? "Optional" : nil]
                            .compactMap { $0?.isEmpty == false ? $0 : nil }
                        if !meta.isEmpty {
                            Text(meta.joined(separator: " · ")).font(.caption.weight(.semibold)).foregroundStyle(Theme.muted)
                        }
                        Text(essay.prompt).font(.subheadline).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.vertical, 2)
                }
            } header: {
                Text("Supplemental essays")
            } footer: {
                Text("\(essays.count) prompt\(essays.count == 1 ? "" : "s"). Confirm prompts for your application year.")
            }
        }
    }
}

struct CollegeCampusLifeSection: View {
    let niche: ExploreNiche?

    var body: some View {
        let grades = [("Overall", niche?.overall), ("Campus", niche?.campus), ("Dorms", niche?.dorms), ("Food", niche?.food)]
            .compactMap { label, value in value?.isEmpty == false ? (label, value!) : nil }
        if !grades.isEmpty {
            Section {
                ForEach(grades, id: \.0) { LabeledValueRow(label: $0.0, value: $0.1).font(.forgeNumber(.body, weight: .regular)) }
            } header: {
                Text("Campus life")
            } footer: {
                Text("Niche grades")
            }
        }
    }
}

/// Research deadlines from the college's site, shown when nothing is saved for the school.
struct ExploreDeadlineRows: View {
    let deadlines: [ExploreDeadline]

    var body: some View {
        ForEach(Array(deadlines.enumerated()), id: \.offset) { _, deadline in
            VStack(alignment: .leading, spacing: 2) {
                LabeledValueRow(label: deadline.plan, value: deadline.date, systemImage: "calendar")
                if let note = deadline.note, !note.isEmpty {
                    Text(note).font(.caption).foregroundStyle(Theme.muted)
                }
            }
        }
    }
}

/// Forge's read of how hard it is to switch into each major.
struct ExploreSwitchingRows: View {
    let switching: [ExploreSwitch]

    private func tone(_ level: Double) -> Color {
        switch level {
        case ..<2: Theme.success
        case ..<3: Theme.amber
        default: Theme.coral
        }
    }

    var body: some View {
        ForEach(switching, id: \.major) { item in
            LabeledContent {
                Badge(text: item.label, tone: tone(item.level))
            } label: {
                Text(item.major).foregroundStyle(Theme.body)
            }
        }
    }
}
