import SwiftUI

/// A date that may be unset, bound to a "yyyy-mm-dd" string ("" when unset).
/// Shows "Add" until the student picks a date, then a compact picker with a clear button.
struct OptionalDateRow: View {
    let title: String
    @Binding var date: String
    /// Shown under the row when no date is set ("Last year: Mar 28").
    var hint: String?

    var body: some View {
        if let value = ForgeDates.day(date) {
            HStack {
                DatePicker(title, selection: Binding(get: { value }, set: { date = ForgeDates.iso($0) }), displayedComponents: .date)
                Button {
                    date = ""
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.mutedSoft)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Clear \(title.lowercased())")
            }
        } else {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                    if let hint { Text(hint).font(.footnote).foregroundStyle(Theme.muted) }
                }
                Spacer()
                Button("Add") { date = ForgeDates.today() }
                    .buttonStyle(.borderless)
            }
        }
    }
}
