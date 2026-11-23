import SwiftUI

/// The Forge mark (public/assets/mark.svg): three crossed coral arms.
struct ForgeMark: View {
    var size: CGFloat = 44
    var color: Color = Theme.coral

    var body: some View {
        ZStack {
            ForEach([0.0, 60, 120], id: \.self) { angle in
                ForgeArm().fill(color).rotationEffect(.degrees(angle))
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// One arm of the mark, from the SVG path in a 32-unit box.
private struct ForgeArm: Shape {
    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 32
        let ox = rect.midX - 16 * s, oy = rect.midY - 16 * s
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }
        var path = Path()
        path.move(to: p(13.4, 4.5))
        path.addLine(to: p(18.6, 4.5))
        path.addLine(to: p(18.1, 16))
        path.addLine(to: p(18.6, 27.5))
        path.addLine(to: p(13.4, 27.5))
        path.addLine(to: p(13.9, 16))
        path.closeSubpath()
        return path
    }
}

#Preview {
    ForgeMark(size: 120).padding()
}
