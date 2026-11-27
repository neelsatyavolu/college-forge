import Charts
import SwiftUI

/// Colors and symbols shared by the chart and its legend.
enum ScatterStyle {
    /// Waitlisted uses a fixed blue, as on the website: the theme's teal is too close to the admit green.
    static let waitlisted = Color(light: 0x5B7FD6, dark: 0x8EA7E8)

    static func color(_ outcome: ScatterOutcome) -> Color {
        switch outcome {
        case .accepted: Theme.success
        case .denied: Theme.danger
        case .waitlisted: waitlisted
        case .deferred: Theme.amber
        case .other: Theme.muted
        }
    }

    /// Diamond is the student's own marker, so early decision is a square, early action a triangle, the rest circles.
    static func symbol(_ kind: ScatterRoundKind?) -> BasicChartSymbolShape {
        switch kind {
        case .ed: .square
        case .ea: .triangle
        case nil: .circle
        }
    }
}

/// One school's GPA-versus-SAT plot: past applicants coloured by outcome, Maia's average and the student.
struct ScattergramChart: View {
    private let college: CollegeScattergram
    private let student: ScatterStudentMarker?
    private let points: [ScatterPoint]
    private let domain: ScatterChartDomain

    init(college: CollegeScattergram, student: ScatterStudentMarker?) {
        self.college = college
        self.student = student
        points = ScattergramLogic.plotted(college)
        domain = ScattergramLogic.domain(points: points, student: student)
    }

    var body: some View {
        Chart {
            if let student {
                RuleMark(x: .value("Your SAT", student.sat))
                    .foregroundStyle(Theme.coral)
                    .lineStyle(StrokeStyle(lineWidth: 1.2, dash: [5, 4]))
                RuleMark(y: .value("Your GPA", student.gpa))
                    .foregroundStyle(Theme.coral)
                    .lineStyle(StrokeStyle(lineWidth: 1.2, dash: [5, 4]))
            }
            ForEach(Array(points.enumerated()), id: \.offset) { _, point in
                PointMark(x: .value("SAT", point.sat ?? 0), y: .value("GPA", point.gpa ?? 0))
                    .symbol(ScatterStyle.symbol(ScattergramLogic.roundKind(point.round)))
                    .symbolSize(dotSize)
                    .foregroundStyle(ScatterStyle.color(point.result).opacity(0.8))
            }
            if let sat = college.averages.sat, let gpa = college.averages.gpa {
                PointMark(x: .value("Maia average SAT", sat), y: .value("Maia average GPA", gpa))
                    .symbol(.plus)
                    .symbolSize(140)
                    .foregroundStyle(Theme.ink)
            }
            if let student {
                PointMark(x: .value("Your SAT", student.sat), y: .value("Your GPA", student.gpa))
                    .symbol(.diamond)
                    .symbolSize(150)
                    .foregroundStyle(Theme.coral)
            }
        }
        .chartXScale(domain: domain.sat)
        .chartYScale(domain: domain.gpa)
        .chartXAxis {
            AxisMarks(values: domain.satTicks) { _ in
                AxisGridLine().foregroundStyle(Theme.hairline)
                AxisValueLabel().foregroundStyle(Theme.muted)
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: domain.gpaTicks) { value in
                AxisGridLine().foregroundStyle(Theme.hairline)
                AxisValueLabel {
                    if let gpa = value.as(Double.self) {
                        Text(gpa, format: .number.precision(.fractionLength(2))).foregroundStyle(Theme.muted)
                    }
                }
            }
        }
        .chartXAxisLabel(position: .bottom, alignment: .center) {
            Text("SAT").font(.caption2).foregroundStyle(Theme.muted)
        }
        .frame(height: 240)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(ScattergramLogic.accessibilityLabel(college))
    }

    /// Smaller dots when a school has many applicants, so clusters stay readable.
    private var dotSize: CGFloat { college.n > 200 ? 22 : 34 }
}

/// What the colours and shapes mean.
struct ScattergramLegend: View {
    let hasStudent: Bool

    var body: some View {
        FlowLayout(spacing: Theme.Spacing.sm) {
            ForEach([ScatterOutcome.accepted, .denied, .waitlisted, .deferred], id: \.self) { outcome in
                item(outcome.rawValue, systemImage: "circle.fill", tint: ScatterStyle.color(outcome))
            }
            item("Early Decision", systemImage: "square.fill", tint: Theme.muted)
            item("Early Action", systemImage: "triangle.fill", tint: Theme.muted)
            item("Regular / other", systemImage: "circle.fill", tint: Theme.muted)
            if hasStudent { item("You", systemImage: "diamond.fill", tint: Theme.coral) }
            item("Maia average", systemImage: "plus", tint: Theme.ink)
        }
        .accessibilityElement(children: .combine)
    }

    private func item(_ title: String, systemImage: String, tint: Color) -> some View {
        HStack(spacing: Theme.Spacing.xxs) {
            Image(systemName: systemImage).font(.system(size: 9, weight: .bold)).foregroundStyle(tint)
            Text(title).font(.caption).foregroundStyle(Theme.muted)
        }
    }
}
