import Foundation
import Testing
@testable import Forge

@Suite("Essay groups and counts")
struct EssayCatalogTests {
    private func essay(_ id: String, limit: Int = 650, unit: String = "words") -> Essay {
        Essay(id: id, label: "Label \(id)", prompt: "Prompt \(id)", limit: limit, unit: unit)
    }

    @Test func groupsCommonAppThenUCThenSchoolsThenOrphans() {
        let colleges = [
            College(slug: "rice", name: "Rice University", short: "Rice"),
            College(slug: "ucla", name: "University of California, Los Angeles", short: "UCLA"),
            College(slug: "uc-davis", name: "UC Davis"),
            College(slug: "pomona", name: "Pomona College"),
        ]
        var set = EssaySet()
        set.commonApp = [essay("ca-ps-1"), essay("ca-additional-info")]
        set.supplements = [
            "uc-application": [essay("uc-1", limit: 350)],
            "rice": [essay("rice-1")],
            "old-school": [essay("old-1")],
            "empty-orphan": [],
        ]
        let groups = EssayCatalog.groups(colleges: colleges, essays: set)
        #expect(groups.map(\.key) == ["common", "uc-application", "rice", "pomona", "old-school"])
        #expect(groups[1].subtitle == "UCLA · UC Davis")
        #expect(groups[2].subtitle == "Rice University")
        #expect(groups[3].isPlaceholder)
        #expect(groups[4].kind == .orphan)
        #expect(groups[4].title == "old school")
        #expect(groups[4].subtitle == "Removed from list")
    }

    @Test func ucPromptsBecomeOrphanWhenNoCampusListed() {
        var set = EssaySet()
        set.supplements = ["uc-application": [essay("uc-1")]]
        let groups = EssayCatalog.groups(colleges: [College(slug: "rice", name: "Rice")], essays: set)
        let uc = groups.first { $0.key == "uc-application" }
        #expect(uc?.kind == .orphan)
        #expect(uc?.subtitle == "Not on your list")
    }

    @Test func ucCampusOrphanKeysHiddenWhenSharedGroupExists() {
        var set = EssaySet()
        set.supplements = ["university-of-california-berkeley": [essay("ucb-1")]]
        let groups = EssayCatalog.groups(colleges: [College(slug: "ucla", name: "UCLA")], essays: set)
        #expect(!groups.contains { $0.key == "university-of-california-berkeley" })
    }

    @Test(arguments: [
        ("university-of-california-irvine", "Irvine", true),
        ("ucsd", "San Diego", true),
        ("x", "UC Santa Barbara", true),
        ("x", "University of California, Merced", true),
        ("ucf", "University of Central Florida", false),
        ("usc", "University of Southern California", false),
    ])
    func detectsUCCampuses(slug: String, name: String, expected: Bool) {
        #expect(EssayCatalog.isUCCampus(College(slug: slug, name: name)) == expected)
    }

    @Test func itemsCarryTheirGroup() {
        var set = EssaySet()
        set.commonApp = [essay("ca-ps-1")]
        let items = EssayCatalog.items(in: EssayCatalog.groups(colleges: [], essays: set))
        #expect(items.map(\.id) == ["ca-ps-1"])
        #expect(items[0].badge == "Common App")
    }

    @Test func defaultExpansionOpensCommonDraftedAndFirstSchool() {
        let colleges = [College(slug: "a", name: "A"), College(slug: "b", name: "B"), College(slug: "c", name: "C")]
        var set = EssaySet()
        set.supplements = ["a": [essay("a1")], "b": [essay("b1")], "c": [essay("c1")]]
        let groups = EssayCatalog.groups(colleges: colleges, essays: set)
        let open = EssayCatalog.initiallyExpanded(groups, drafts: ["c1": "some words"])
        #expect(open == ["common", "a", "c"])
    }

    @Test func wordCountMatchesWeb() {
        #expect(EssayMetrics.wordCount("") == 0)
        #expect(EssayMetrics.wordCount("   \n\t ") == 0)
        #expect(EssayMetrics.wordCount(" one  two\nthree\tfour ") == 4)
        #expect(EssayMetrics.wordCount("well-known it's") == 2)
    }

    @Test func characterLimitsCountCodePoints() {
        let short = essay("s", limit: 10, unit: "characters")
        #expect(EssayMetrics.count("héllo wörld", for: short) == 11)
        // A family emoji is one character on screen but several code points, as in Array.from.
        #expect(EssayMetrics.count("👨‍👩‍👧", for: short) == 5)
        #expect(EssayMetrics.count("a b", for: essay("w")) == 2)
    }

    @Test func limitsAndMinimum() {
        let personal = essay("ca-ps-2")
        #expect(EssayMetrics.isUnderMinimum(100, personal))
        #expect(!EssayMetrics.isUnderMinimum(0, personal))
        #expect(!EssayMetrics.isUnderMinimum(250, personal))
        #expect(!EssayMetrics.isUnderMinimum(100, essay("rice-1")))
        #expect(EssayMetrics.isOver(651, personal))
        #expect(!EssayMetrics.isOver(650, personal))
        #expect(EssayMetrics.progress(1300, personal) == 1)
        #expect(EssayMetrics.progress(325, personal) == 0.5)
    }
}

@Suite("Essay prompt form")
struct EssayPromptDraftTests {
    @Test func validation() {
        var draft = EssayPromptDraft.new(in: "rice")
        #expect(!draft.isValid)
        draft.label = "  Why Rice  "
        draft.prompt = "Tell us why."
        #expect(draft.isValid)
        draft.limit = 0
        #expect(!draft.isValid)
        draft.limit = 50_001
        #expect(!draft.isValid)
        draft.limit = 150
        draft.label = String(repeating: "x", count: 161)
        #expect(!draft.isValid)
    }

    @Test func addingAppendsTrimmedEssay() {
        var draft = EssayPromptDraft.new(in: "rice")
        draft.label = " Why Rice "
        draft.prompt = " Tell us. "
        draft.limit = 150
        let existing = [Essay(id: "rice-1", label: "Old", prompt: "Old")]
        let result = draft.applied(to: existing, newID: "custom-1")
        #expect(result.items.map(\.id) == ["rice-1", "custom-1"])
        #expect(result.essay.label == "Why Rice")
        #expect(result.essay.prompt == "Tell us.")
        #expect(result.essay.limit == 150)
    }

    @Test func editingKeepsIdGroupAndStarter() {
        var original = Essay(id: "rice-1", label: "Old", prompt: "Old", limit: 250)
        original.group = "Rice"
        original.starter = "Begin here"
        let item = EssayItem(essay: original, groupKey: "rice", groupTitle: "Rice")
        var draft = EssayPromptDraft.editing(item)
        draft.label = "New"
        draft.unit = "characters"
        let result = draft.applied(to: [original], newID: "unused")
        #expect(result.items.count == 1)
        #expect(result.essay.id == "rice-1")
        #expect(result.essay.group == "Rice")
        #expect(result.essay.starter == "Begin here")
        #expect(result.essay.unit == "characters")
    }

    @Test func patchTargetsTheRightGroup() throws {
        let items = [Essay(id: "x", label: "X", prompt: "P")]
        let common = EssayPromptDraft.patch(groupKey: "common", items: items)
        #expect(common.commonApp?.count == 1 && common.supplements == nil)
        let school = EssayPromptDraft.patch(groupKey: "rice", items: items)
        #expect(school.commonApp == nil && school.supplements?["rice"]?.count == 1)
    }
}
