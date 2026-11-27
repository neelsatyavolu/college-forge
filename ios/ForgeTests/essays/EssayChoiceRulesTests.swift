import Foundation
import Testing
@testable import Forge

/// Parity with tests/essay-archetypes.test.cjs for the choice rules in public/hub/essay-archetypes.js.
@Suite("Essay choices: pick sets, colleges, options and labels")
struct EssayChoiceRulesTests {
    private func essay(_ id: String, audience: String? = nil, limit: Int = 250) -> Essay {
        var e = Essay(id: id, label: id, prompt: "p", limit: limit)
        e.audience = audience
        return e
    }

    @Test func pickSetsFindChooseNSetsAndPickPatchHidesTheOthers() throws {
        let piqs = (1...8).map { essay("uc-piq-\($0)", limit: 350) }
        let sets = EssayChoiceRules.pickSets(piqs + [essay("ca-ps-1", limit: 650)])
        #expect(sets.count == 1, "the Common App set picks one, so it has its own control")
        let set = try #require(sets.first)
        #expect(set.choose == 4)
        #expect(set.essays.map(\.id) == (1...8).map { "uc-piq-\($0)" })
        let patch = EssayChoiceRules.pickPatch(set, picked: ["uc-piq-1", "uc-piq-3", "uc-piq-5", "uc-piq-8"])
        #expect(patch.count == 8)
        #expect(patch["uc-piq-1"] == .some(nil))
        #expect(patch["uc-piq-2"] == .some(true))
        #expect(patch["uc-piq-8"] == .some(nil))
        #expect(patch.values.filter { $0 == true }.count == 4)
    }

    @Test func pickSetsReadChooseGroupFromThePrompt() {
        var a = essay("a"), b = essay("b")
        a.chooseGroup = "mit"; a.choose = 2
        b.chooseGroup = "mit"; b.choose = 2
        #expect(EssayChoiceRules.pickSets([a, essay("why"), b]).map(\.essays.count) == [2])
    }

    @Test func audienceSetPicksTheCollegeAndKeepsSharedPrompts() throws {
        let items = [essay("why"), essay("cals-1", audience: "CALS"), essay("cals-2", audience: "CALS"),
                     essay("eng-1", audience: "Engineering"), essay("as-1", audience: "Arts and Sciences")]
        let set = try #require(EssayChoiceRules.audienceSet(items))
        #expect(set.audiences == ["CALS", "Engineering", "Arts and Sciences"])
        #expect(set.shared && !set.single)
        #expect(EssayChoiceRules.audiencePatch(items, audience: "CALS")
            == ["cals-1": Bool?.none, "cals-2": Bool?.none, "eng-1": true, "as-1": true])
        #expect(EssayChoiceRules.audiencePatch(items, audience: "")
            == ["cals-1": true, "cals-2": true, "eng-1": true, "as-1": true], "none of these hides every program prompt")
        #expect(EssayChoiceRules.chosenAudience(items, hidden: [:]) == nil, "nothing chosen while every program prompt shows")
        #expect(EssayChoiceRules.chosenAudience(items, hidden: ["eng-1": true, "as-1": true]) == "CALS")
        #expect(EssayChoiceRules.chosenAudience(items, hidden: ["cals-1": true, "cals-2": true, "eng-1": true, "as-1": true]) == "")
    }

    @Test func aSingleProgramIsAnOptIn() {
        let items = [essay("why"), essay("h1", audience: "Honors College"), essay("h2", audience: "Honors College")]
        #expect(EssayChoiceRules.audienceSet(items) == EssayAudienceSet(audiences: ["Honors College"], shared: true, single: true))
        #expect(EssayChoiceRules.audiencePatch(items, audience: "") == ["h1": true, "h2": true])
        #expect(EssayChoiceRules.chosenAudience(items, hidden: [:]) == nil)
        #expect(EssayChoiceRules.chosenAudience(items, hidden: ["h1": true, "h2": true]) == "")
        #expect(EssayChoiceRules.audienceSet([essay("a", audience: "X"), essay("b", audience: "X")]) == nil,
                "every prompt for one program is just that school, not an opt-in")
    }

    @Test func aChosenOptionWithItsOwnLimitSetsTheEssayLimit() {
        var it = Essay(id: "wake-2", label: "Written supplement", prompt: "p", limit: 300)
        it.options = [
            "List five books you’ve read that have intrigued you. (150 character limit per book title)",
            "Tell us what piques your intellectual curiosity. (150 word limit)",
            "Choose one of Dr. Angelou’s quotes. (300 word limit)",
            "Give us your Top Ten List. (100 character limit per line)",
            "Describe a moment. 250 characters maximum.",
        ]
        let one = EssayChoiceRules.withChosenOption(it, choice: 1)
        #expect(one.limit == 150 && one.unit == "words")
        #expect(EssayChoiceRules.withChosenOption(it, choice: 2).limit == 300)
        #expect(EssayChoiceRules.withChosenOption(it, choice: 0) == it, "a per-title limit is not a total")
        #expect(EssayChoiceRules.withChosenOption(it, choice: 3) == it)
        let four = EssayChoiceRules.withChosenOption(it, choice: 4)
        #expect(four.limit == 250 && four.unit == "characters")
        #expect(EssayChoiceRules.withChosenOption(it, choice: nil) == it)
        #expect(EssayChoiceRules.withChosenOption(it, choice: 9) == it)
        var plain = it
        plain.options = nil
        #expect(EssayChoiceRules.withChosenOption(plain, choice: 1).limit == 300)
    }

    @Test func catalogAppliesThePickedOptionsLimit() throws {
        var it = Essay(id: "wake-2", label: "Written supplement", prompt: "p", limit: 300)
        it.options = ["A", "Tell us. (150 word limit)"]
        let groups = EssayCatalog.groups(colleges: [], essays: EssaySet(commonApp: [it]), essayOption: ["wake-2": 1])
        #expect(try #require(groups.first?.essays.first).limit == 150)
    }

    @Test func promptPartsSplitIntroOptionsAndNotes() {
        let text = "Answer one.\n\nOption 1: First thing\n\nOption 2: Second thing\n\n(Keep it short.)"
        let parts = EssayChoiceRules.promptParts(Essay(id: "x", label: "x", prompt: text))
        #expect(parts.intro == ["Answer one."])
        #expect(parts.options == ["First thing", "Second thing"])
        #expect(parts.notes == ["(Keep it short.)"])
        var listed = Essay(id: "y", label: "y", prompt: "Pick one.")
        listed.options = ["A", "B"]
        #expect(EssayChoiceRules.promptParts(listed) == EssayPromptParts(intro: ["Pick one."], options: ["A", "B"], notes: []))
    }

    @Test func sidebarLabelDropsTheCollegePrefixAndTagsOptionalPrompts() {
        func label(_ text: String, _ audience: String? = nil) -> (String, String?) {
            var e = Essay(id: "x", label: text, prompt: "p")
            e.audience = audience
            let out = EssayLabels.sidebarLabel(e)
            return (out.text, out.tag)
        }
        let engineering = "Cornell David A. Duffield College of Engineering"
        #expect(label("\(engineering): Question 2 (only if this applies to you)", engineering) == ("Question 2", nil))
        #expect(label("DC Start essay (only if this applies to you)", "Brooks School") == ("DC Start essay", "If it applies"))
        #expect(label("Written supplement (optional)") == ("Written supplement", "Optional"))
        #expect(label("Why Wake?") == ("Why Wake?", nil))
        #expect(label("College of Arts and Sciences (only if this applies to you)", "College of Arts and Sciences")
            == ("College of Arts and Sciences", nil))
    }

    @Test func schoolTitleUsesTheFullNameWhenTheShortOneIsCut() {
        func title(_ short: String, _ name: String) -> (String, String?) {
            let out = EssayLabels.schoolTitle(name: name, short: short)
            return (out.title, out.subtitle)
        }
        #expect(title("University of Southern Calif", "University of Southern California") == ("University of Southern California", nil))
        #expect(title("University of Illinois Urban", "University of Illinois Urbana-Champaign") == ("University of Illinois Urbana-Champaign", nil))
        #expect(title("University of Michigan", "University of Michigan--Ann Arbor") == ("University of Michigan", nil))
        #expect(title("UCLA", "University of California, Los Angeles") == ("UCLA", "University of California, Los Angeles"))
        #expect(title("", "Binghamton University--SUNY") == ("Binghamton University–SUNY", nil))
    }
}
