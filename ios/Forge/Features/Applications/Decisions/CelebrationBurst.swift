import SwiftUI

/// A short burst of confetti from the center of its frame each time `trigger` changes, with a success haptic.
/// With Reduce Motion on, only the haptic plays.
struct CelebrationBurst: View {
    let trigger: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pieces: [Piece] = []
    @State private var launched = false

    private struct Piece: Identifiable {
        let id: Int
        let angle: Double
        let distance: CGFloat
        let spin: Double
        let color: Color
        let size: CGSize
    }

    var body: some View {
        ZStack {
            ForEach(pieces) { piece in
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(piece.color)
                    .frame(width: piece.size.width, height: piece.size.height)
                    .rotationEffect(.degrees(launched ? piece.spin : 0))
                    .offset(
                        x: launched ? cos(piece.angle) * piece.distance : 0,
                        y: launched ? sin(piece.angle) * piece.distance + 40 : 0
                    )
                    .opacity(launched ? 0 : 1)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .sensoryFeedback(.success, trigger: trigger)
        .onChange(of: trigger) { fire() }
    }

    private func fire() {
        guard !reduceMotion else { return }
        let colors = [Theme.coral, Theme.success, Theme.amber, Theme.teal, Theme.accent]
        pieces = (0..<28).map { i in
            Piece(
                id: trigger * 100 + i,
                angle: Double.random(in: 0..<(2 * .pi)),
                distance: .random(in: 70...160),
                spin: .random(in: -360...360),
                color: colors[i % colors.count],
                size: CGSize(width: .random(in: 4...7), height: .random(in: 8...12))
            )
        }
        launched = false
        Task { @MainActor in
            await Task.yield()
            withAnimation(.easeOut(duration: 1.1)) { launched = true }
            try? await Task.sleep(for: .seconds(1.2))
            pieces = []
            launched = false
        }
    }
}
