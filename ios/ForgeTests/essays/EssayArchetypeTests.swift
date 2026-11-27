import Testing
@testable import Forge

@Suite("Essay prompt types and starting drafts")
struct EssayArchetypeTests {
    @Test(arguments: [
        ("ca-ps-example", "Additional information", "", 20, "words", EssayArchetype.personal),
        ("a", "Why North College", "Anything else to add?", 200, "words", .additional),
        ("b", "Why North College", "Discuss your first-choice major.", 40, "words", .whyMajor),
        ("c", "Supplement", "Why North College?", 40, "words", .whySchool),
        ("d", "Activity", "Describe a challenge.", 50, "words", .short),
        ("e", "", "Your community", 350, "Characters", .short),
        ("f", "", "Your community", 351, "characters", .community),
        ("g", "", "Describe a difficult decision.", 51, "words", .challenge),
        ("h", "Responsibility", "Describe your community.", 100, "words", .activity),
        ("i", "Intellectual curiosity", "Describe a challenge.", 200, "words", .curiosity),
        ("j", "Supplement", "Tell us something.", 0, "words", .other),
    ])
    func matchingAndPrecedence(id: String, label: String, prompt: String, limit: Int,
                               unit: String, expected: EssayArchetype) {
        let essay = Essay(id: id, label: label, prompt: prompt, limit: limit, unit: unit)
        #expect(EssayArchetype.classify(essay) == expected)
    }

    private func item(_ id: String, _ label: String, limit: Int = 650, unit: String = "words",
                      starter: String? = nil) -> EssayItem {
        var essay = Essay(id: id, label: label, prompt: "", limit: limit, unit: unit)
        essay.starter = starter
        return EssayItem(essay: essay, groupKey: "north", groupTitle: "North College")
    }

    @Test func sectionsUseArchetypeOrderAndComparableLimits() {
        let items = [item("a", "Community"), item("b", "Why North", limit: 100),
                     item("c", "Why North", limit: 1500, unit: "characters"),
                     item("d", "Why North", limit: 300), item("e", "Why North", limit: 100)]
        let sections = EssayArchetype.sections(for: items)
        #expect(sections.map(\.label) == ["Why this school", "Community and identity"])
        #expect(sections.first?.items.map(\.id) == ["d", "c", "b", "e"])
    }

    @Test func copiesPreserveTextAndPrioritizeMatchingNonemptyDrafts() {
        let active = item("active", "Community")
        let items = [item("a", "Idea", starter: "Starter text"), active, item("b", "Identity"),
                     item("c", "Community", starter: "Erased"), item("d", "Community"), item("e", "Activity")]
        let drafts = ["active": "Skip self", "b": "  My story\n", "c": "", "d": "Another story", "e": "\n  "]
        let sources = EssayArchetype.copySources(for: active.essay, items: items, drafts: drafts)
        #expect(sources.map(\.id) == ["b", "d", "a"])
        #expect(sources.first?.label == "North College · Identity (2 words)")
        #expect(sources.first?.text == "  My story\n")
        #expect(sources.last?.text == "Starter text")
    }
}
