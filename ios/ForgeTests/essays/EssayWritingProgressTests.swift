import Testing
@testable import Forge

@Suite("Essay deadlines and writing progress")
struct EssayWritingProgressTests {
    private func college(_ key: String, _ dates: [(String, String)] = []) -> College {
        var c = College(slug: key, name: key)
        c.deadlines = dates.map { PlanDeadline(plan: $0.0, date: $0.1) }
        return c
    }

    private func essay(_ id: String, limit: Int = 10, unit: String = "words") -> Essay {
        Essay(id: id, label: id, prompt: "Sample prompt", limit: limit, unit: unit)
    }

    @Test func orderUsesUpcomingChosenApplicationRoundAndKeepsTiesStable() {
        var chosen = college("chosen", [
            ("ED I", "2030-10-02"), ("ED II scholarship", "2030-10-03"), ("ED II", "2030-12-01"),
        ])
        chosen.deadline = "ED II · Dec 1"
        let colleges = [
            college("unknown"), college("past", [("RD", "2030-09-01")]), chosen,
            college("first", [("EA", "2030-11-01")]), college("second", [("RD", "2030-11-01")]),
        ]
        let groups = EssayCatalog.groups(colleges: colleges, essays: EssaySet(supplements: ["removed": [essay("old")]]),
                                         today: "2030-10-01")
        #expect(groups.map(\.key) == ["common", "first", "second", "chosen", "unknown", "past", "removed"])
        #expect(groups.first?.due == EssayDeadline(date: "2030-11-01", round: "EA", school: "first"))
        #expect(groups[3].due?.date == "2030-12-01")
        #expect(groups[3].due?.round == "ED")
    }

    @Test func progressRanksChoiceSetsAndExcludesOptionalAndRemovedPrompts() {
        let common = [essay("ca-ps-1"), essay("ca-ps-2"), essay("extra (optional)"), essay("extra")]
        let school = [essay("first", limit: 2), essay("second"), essay("tiny", unit: "characters")]
        let sets = EssaySet(commonApp: common, supplements: ["academy": school, "removed": [essay("old")]])
        let groups = EssayCatalog.groups(colleges: [college("academy")], essays: sets)
        let rules = [
            "extra": EssayPromptRule(id: "extra", required: false),
            "first": EssayPromptRule(id: "first", chooseGroup: "pick-one", choose: 1),
            "second": EssayPromptRule(id: "second", chooseGroup: "pick-one", choose: 1),
        ]
        let progress = EssayWritingProgress(groups: groups,
            drafts: ["ca-ps-1": "longer draft", "first": "one two three", "second": "word", "tiny": "🦋", "old": "old draft"],
            status: ["ca-ps-2": "final", "extra": "final"], rules: rules)
        #expect(progress.required == 3)
        #expect(progress.drafted == 3)
        #expect(progress.final == 1)
        #expect(progress.wordsWritten == 2)
        #expect(progress.wordsRequired == 12)
        #expect(progress.unfinishedGroups == ["academy"])
        #expect(progress.next == nil)
    }

    @Test func unfinishedDeadlineWinsAndFinalWorkspaceFallsBackToEarliest() {
        let colleges = [college("early", [("EA", "2030-10-01")]), college("late", [("RD", "2030-12-01")])]
        let essays = EssaySet(supplements: ["early": [essay("a")], "late": [essay("b")]])
        let groups = EssayCatalog.groups(colleges: colleges, essays: essays, today: "2030-10-01")
        let unfinished = EssayWritingProgress(groups: groups, drafts: [:], status: ["a": "final"], rules: [:])
        #expect(unfinished.unfinishedGroups == ["late"])
        #expect(unfinished.next?.school == "late")
        let complete = EssayWritingProgress(groups: groups, drafts: [:], status: ["a": "final", "b": "final"], rules: [:])
        #expect(complete.unfinishedGroups.isEmpty)
        #expect(complete.next?.school == "early")
    }

    @Test func legacyUCRequiresFourAndUsesStartersUntilStudentClearsThem() {
        var prompts = (1...8).map { essay("uc-piq-\($0)") }
        prompts[0].starter = "example"
        prompts[1].starter = "example"
        let groups = [EssayGroup(key: "uc-application", title: "UC", kind: .uc, essays: prompts)]
        let progress = EssayWritingProgress(groups: groups, drafts: ["uc-piq-2": ""], status: [:], rules: [:])
        #expect(progress.required == 4)
        #expect(progress.drafted == 1)
        #expect(progress.wordsWritten == 1)
    }
}
