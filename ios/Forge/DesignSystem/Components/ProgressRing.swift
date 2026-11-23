import SwiftUI

/// A circular progress indicator with an optional center label ("3/8", "62%").
struct ProgressRing: View {
    /// 0...1
    let progress: Double
    var lineWidth: CGFloat = 6
    var tint: Color = Theme.accent
    var label: String?
    var size: CGFloat = 56

    private var clamped: Double { min(max(progress, 0), 1) }

    var body: some View {
        ZStack {
            Circle().stroke(Theme.hairline, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: clamped)
                .stroke(tint, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.smooth, value: clamped)
            if let label {
                Text(label)
                    .font(.system(size: size * 0.24, weight: .semibold).monospacedDigit())
                    .foregroundStyle(Theme.ink)
                    .minimumScaleFactor(0.6)
                    .padding(lineWidth)
            }
        }
        .frame(width: size, height: size)
        .accessibilityElement()
        .accessibilityLabel("Progress")
        .accessibilityValue(label ?? "\(Int(clamped * 100)) percent")
    }
}

#Preview {
    HStack(spacing: 24) {
        ProgressRing(progress: 0.375, label: "3/8")
        ProgressRing(progress: 0.9, tint: Theme.success, label: "90%", size: 72)
        ProgressRing(progress: 0.1, lineWidth: 3, size: 24)
    }
    .padding()
}
