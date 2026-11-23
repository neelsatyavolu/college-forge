import SwiftUI

/// Bachelor's programs grouped by field, each field expandable.
struct CollegeProgramsSection: View {
    let programs: [CollegesProgram]
    let isLoading: Bool

    var body: some View {
        Section {
            if isLoading {
                HStack { ProgressView(); Text("Loading programs…").foregroundStyle(Theme.muted) }
            } else if programs.isEmpty {
                Text("No bachelor’s program data published for this school.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            } else {
                ForEach(CollegesPrograms.areas(programs)) { area in
                    DisclosureGroup {
                        ForEach(area.programs) { program in
                            LabeledContent {
                                Text(program.awards.map { "\($0.formatted()) · \(program.code)" } ?? program.code)
                                    .font(.forgeNumber(.caption, weight: .regular))
                                    .foregroundStyle(Theme.mutedSoft)
                            } label: {
                                Text(program.title).font(.subheadline).foregroundStyle(Theme.body)
                            }
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(area.area).foregroundStyle(Theme.ink)
                            Text(summary(area)).font(.caption).foregroundStyle(Theme.muted)
                        }
                    }
                }
            }
        } header: {
            HStack {
                Text("Schools & programs")
                Spacer()
                if !programs.isEmpty { Text("\(programs.count) bachelor’s").textCase(nil) }
            }
        }
    }

    private func summary(_ area: CollegesPrograms.Area) -> String {
        let count = "\(area.programs.count) program\(area.programs.count == 1 ? "" : "s")"
        return area.awards > 0 ? "\(count) · \(area.awards.formatted()) awarded" : count
    }
}

/// This school's median earnings by field, against the national median for the same field.
struct CollegeEarningsSection: View {
    let programs: [CollegesProgram]
    let isLoading: Bool

    var body: some View {
        let rows = CollegesPrograms.topEarnings(programs)
        let maxValue = rows.map { max($0.earnings4 ?? 0, $0.national4 ?? 0) }.max() ?? 1
        Section {
            if isLoading {
                HStack { ProgressView(); Text("Loading…").foregroundStyle(Theme.muted) }
            } else if rows.isEmpty {
                Text("No field-of-study earnings published for this school’s bachelor’s programs.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            } else {
                ForEach(rows) { EarningsRow(program: $0, maxValue: maxValue) }
            }
        } header: {
            HStack {
                Text("Field-of-study earnings")
                Spacer()
                if !rows.isEmpty { Text("Median 4 yrs after").textCase(nil) }
            }
        }
    }
}

private struct EarningsRow: View {
    let program: CollegesProgram
    let maxValue: Double

    private var beats: Bool { (CollegesPrograms.versusNational(program) ?? 0) > 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(program.title).font(.subheadline).foregroundStyle(Theme.ink)
                Spacer(minLength: Theme.Spacing.xs)
                Text(CollegesFormat.money(program.earnings4))
                    .font(.forgeNumber(.subheadline))
                    .foregroundStyle(Theme.ink)
            }
            GeometryReader { proxy in
                Capsule().fill(Theme.fill)
                    .overlay(alignment: .leading) {
                        Capsule()
                            .fill(beats ? Theme.teal : Theme.coral)
                            .frame(width: proxy.size.width * fraction)
                    }
            }
            .frame(height: 6)
            if let national = program.national4, let delta = CollegesPrograms.versusNational(program) {
                Text("National median \(CollegesFormat.money(national)) · \(delta > 0 ? "+" : "")\(delta)%")
                    .font(.caption)
                    .foregroundStyle(Theme.mutedSoft)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var fraction: CGFloat {
        guard maxValue > 0, let value = program.earnings4 else { return 0 }
        return CGFloat(min(1, value / maxValue))
    }

    private var accessibilityText: String {
        var text = "\(program.title), \(CollegesFormat.money(program.earnings4))"
        if let delta = CollegesPrograms.versusNational(program) {
            text += ", \(abs(delta)) percent \(delta >= 0 ? "above" : "below") the national median"
        }
        return text
    }
}
