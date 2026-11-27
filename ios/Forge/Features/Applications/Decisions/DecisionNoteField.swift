import SwiftUI

struct DecisionNoteField: View {
    let school: String
    @Binding var text: String

    var body: some View {
        TextField("Honors college too, scholarship letter coming", text: Binding(
            get: { text },
            set: { text = Self.limited($0) }
        ), axis: .vertical)
        .accessibilityLabel("Note about the \(school) decision")
    }

    // HTML maxlength counts UTF-16 code units. Keep the last character intact.
    static func limited(_ text: String) -> String {
        guard text.utf16.count > 1000 else { return text }
        var length = 0
        return String(text.prefix { character in
            length += character.utf16.count
            return length <= 1000
        })
    }
}
