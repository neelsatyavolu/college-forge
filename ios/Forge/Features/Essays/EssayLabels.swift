import Foundation

/// Display names for the essays list. Mirrors `sidebarLabel` and `schoolTitle` in public/hub/essay-archetypes.js.
enum EssayLabels {
    /// A prompt's list label: without its college prefix (the group's college picker says which college), with
    /// "(optional)" / "(only if this applies to you)" as a short tag instead of label text.
    static func sidebarLabel(_ essay: Essay) -> (text: String, tag: String?) {
        var text = essay.label.trimmingCharacters(in: .whitespacesAndNewlines)
        let applies = text.range(of: #"\s*\(only if this applies to you\)$"#, options: [.regularExpression, .caseInsensitive]) != nil
        let optional = text.range(of: #"\s*\(optional\)$"#, options: [.regularExpression, .caseInsensitive]) != nil
        text = text.replacingOccurrences(of: #"\s*\((only if this applies to you|optional)\)$"#, with: "",
                                         options: [.regularExpression, .caseInsensitive])
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let audience = essay.audience?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        var forCollege = false
        if !audience.isEmpty && text.lowercased().hasPrefix(audience.lowercased() + ":") {
            text = String(text.dropFirst(audience.count + 1)).trimmingCharacters(in: .whitespacesAndNewlines)
            forCollege = true
        } else if !audience.isEmpty && text.lowercased() == audience.lowercased() {
            forCollege = true
        }
        let tag: String? = optional ? "Optional" : applies && !forCollege ? "If it applies" : nil
        return (text, tag)
    }

    /// A school's title and subtitle: the full name when the stored short name is cut mid-word, and no subtitle
    /// when it only repeats the title. "--" in catalog names reads as an en dash.
    static func schoolTitle(name rawName: String, short rawShort: String) -> (title: String, subtitle: String?) {
        let name = rawName.replacingOccurrences(of: #"\s*--\s*"#, with: "–", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let short = rawShort.trimmingCharacters(in: .whitespacesAndNewlines)
        if short.isEmpty { return (name, nil) }
        if rawName.hasPrefix(short) && rawName.count > short.count {
            let next = rawName[rawName.index(rawName.startIndex, offsetBy: short.count)]
            let cutMidWord = next.isASCII && (next.isLetter || next.isNumber)
            return (cutMidWord ? name : short, nil)
        }
        return (short, !name.isEmpty && name != short ? name : nil)
    }
}
