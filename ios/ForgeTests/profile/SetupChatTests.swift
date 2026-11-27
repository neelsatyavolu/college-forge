import Foundation
import Testing
@testable import Forge

@Suite("Setup chat: stream events and interview state")
struct SetupChatEventTests {
    @Test func parsesQuestionTiles() throws {
        let line = #"{"type":"question","question":{"id":"q1","kind":"single","prompt":"What year?","options":[{"value":"2027","label":"Class of 2027","hint":"senior"},{"value":"2028","label":"Class of 2028"}]}}"#
        guard case .question(let q)? = SetupChatEvent.parse(line) else { Issue.record("not a question"); return }
        #expect(q.kind == "single")
        #expect(q.options.map(\.label) == ["Class of 2027", "Class of 2028"])
        #expect(q.options.first?.hint == "senior")
    }

    @Test func parsesListWithIdeaAndWarning() {
        let line = #"{"type":"list","schools":[{"name":"Example State","tier":"likely","reason":"Strong fit","supplements":"no","current":true}],"edIdea":{"school":"Sample College","reason":"Top pick"},"warning":"Only one likely school."}"#
        guard case .list(let schools, let idea, let warning)? = SetupChatEvent.parse(line) else { Issue.record("not a list"); return }
        #expect(schools.first?.current == true)
        #expect(schools.first?.supplements == "no")
        #expect(idea?.school == "Sample College")
        #expect(warning == "Only one likely school.")
    }

    @Test func parsesStrategyResearchAndBasics() {
        #expect(SetupChatEvent.parse(#"{"type":"research","slug":"sample","name":"Sample","stage":"done","facts":12}"#) == .research(slug: "sample", stage: "done", facts: 12))
        #expect(SetupChatEvent.parse(#"{"type":"delta","text":"Hi"}"#) == .delta("Hi"))
        #expect(SetupChatEvent.parse(#"{"type":"done","provider":"codex"}"#) == .done)
        #expect(SetupChatEvent.parse("   ") == nil)
        #expect(SetupChatEvent.parse("not json") == .other)
        guard case .strategy(let s)? = SetupChatEvent.parse(#"{"type":"strategy","strategy":{"ed":"Sample","ea":["A","B"],"reasons":"Because"}}"#) else {
            Issue.record("not a strategy"); return
        }
        #expect(s.ea == ["A", "B"])
    }

    @Test func decodesStoredTranscriptWithUI() throws {
        let json = #"{"phase":"list","section":"deep","listDraft":[{"name":"A","tier":"reach"}],"transcript":[{"role":"user","content":"Hi! I'm ready to set up Forge.","at":1},{"role":"assistant","content":"Pick one","ui":{"question":{"id":"x","kind":"confirm","prompt":"OK?"}},"at":2},{"role":"assistant","content":"List","ui":{"list":[{"name":"A","tier":"reach","reason":"r"}]},"at":3}]}"#
        let iv = try JSONDecoder().decode(OnboardingInterview.self, from: Data(json.utf8))
        #expect(iv.phase == "list")
        #expect(iv.listDraftCount == 1)
        #expect(iv.transcript.count == 3)
        if case .question(let q)? = iv.transcript[1].ui { #expect(q.kind == "confirm") } else { Issue.record("no question ui") }
        if case .list(let schools, _, _)? = iv.transcript[2].ui { #expect(schools.count == 1) } else { Issue.record("no list ui") }
    }

    @Test func interviewInProgressKeepsSetupOpen() throws {
        var ws = Workspace.empty
        ws.applicant.name = "Test Student"
        #expect(!ws.needsOnboarding)
        ws.onboarding.interview = try JSONDecoder().decode(OnboardingInterview.self, from: Data(#"{"phase":"research"}"#.utf8))
        #expect(ws.needsOnboarding)
        ws.onboarding.interview?.phase = "done"
        #expect(!ws.needsOnboarding)
    }

    @Test func interviewIsNeverEncodedBack() throws {
        var state = OnboardingState()
        state.interview = OnboardingInterview()
        let text = String(decoding: try JSONEncoder().encode(state), as: UTF8.self)
        #expect(!text.contains("interview"))
    }
}

@Suite("Setup chat: rules")
@MainActor
struct SetupChatLogicTests {
    @Test func dedupeDropsRepeatedParagraph() {
        let text = "Great, thanks for sharing your grades today.\n\nGreat, thanks for sharing your grades today!\n\nNext: testing."
        #expect(SetupChat.dedupe(text) == "Great, thanks for sharing your grades today.\n\nNext: testing.")
    }

    @Test func ucCampusesCountAsOneApplication() {
        let list = [
            InterviewSchool(name: "University of California, Berkeley", tier: "reach"),
            InterviewSchool(name: "UC Davis", tier: "target"),
            InterviewSchool(name: "Sample College", tier: "likely"),
        ]
        #expect(SetupChat.appCount(list) == 2)
        #expect(SetupChat.mix(list) == "1 reach · 1 target · 1 likely")
        #expect(SetupChat.sortedByTier(list.reversed()).map(\.tier) == ["reach", "target", "likely"])
    }

    @Test func leadAndLabels() {
        #expect(SetupChat.leadSays("So, what's your GPA? Be rough.", prompt: "What's your GPA?"))
        #expect(!SetupChat.leadSays("Hello", prompt: "What's your GPA?"))
        #expect(SetupChat.stepLabel(phase: "interview", section: "money") == "Money")
        #expect(SetupChat.stepLabel(phase: "strategy", section: "deep") == "Early plan")
        #expect(SetupChat.hidden.contains(SetupChat.kickoff))
        #expect(SetupChat.reviseMessage("More East Coast", dropped: ["A", "B"]) == "More East Coast (I'd drop: A, B)")
    }

    @Test func activitiesSummary() {
        var a = Activity()
        a.name = "Robotics"; a.role = "Lead"; a.years = "9–12"; a.hpw = "8"
        var h = Honor()
        h.title = "Science fair"; h.level = "State"
        #expect(SetupActivitiesTile.summary([a], [h]) == "I saved my list: 1 activity and 1 honor.\n1. Robotics, Lead, grades 9–12, 8 hrs/wk\nHonors:\n- Science fair, State")
        #expect(SetupActivitiesTile.padded([1], blank: 0, min: 3, max: 10) == [1, 0, 0])
    }
}

@Suite("Setup chat: quick-start form")
struct SetupIntakeTests {
    @Test func buildsPatchAndSummary() {
        var f = SetupIntakeForm()
        f.name = " Test Student "
        f.gradYear = "2027"
        f.residency = "CA"
        f.gpaUnweighted = "3.9"
        f.gpaWeighted = "9.0" // over 6: dropped
        f.sat = "1500"
        f.incomeBracket = "48-75"
        f.needAid = "yes"
        f.recommendCounts = true
        f.ambition = "ambitious"
        f.settings = ["urban"]
        let built = f.build()
        #expect(built.patch["applicant"] == .object(["name": .string("Test Student"), "gpaUnweighted": .string("3.9")]))
        #expect(built.patch["profile"] == .object(["gradYear": .number(2027), "residency": .string("CA"), "testing": .object(["sat": .string("1500")])]))
        guard case .object(let lp)? = built.patch["listPrefs"] else { Issue.record("no listPrefs"); return }
        #expect(lp["suppCount"] == .number(9))
        #expect(lp["noSuppCount"] == .number(3))
        #expect(lp["needAid"] == .bool(true))
        #expect(lp["countsRecommended"] == .bool(true))
        #expect(built.said.contains("9 schools with supplements and 3 without (Forge's suggestion; I wasn't sure)"))
        #expect(built.blanks.contains("budget"))
        #expect(!built.blanks.contains("GPA"))
        #expect(built.message.hasPrefix("I filled in the quick start:\n- Name: Test Student"))
    }

    @Test func testOptionalAndInternational() {
        var f = SetupIntakeForm()
        f.testOptional = true
        f.sat = "1500"
        f.residency = "INTL"
        f.citizenship = "unsure"
        let built = f.build()
        #expect(built.patch["profile"] == .object(["testing": .object(["satNote": .string("Test optional")])]))
        guard case .object(let lp)? = built.patch["listPrefs"] else { Issue.record("no listPrefs"); return }
        #expect(lp["citizenship"] == .string("international"))
        #expect(built.said.contains("Applying test-optional"))
        #expect(!built.blanks.contains("test scores"))
    }

    @Test func anyClearsOtherChips() {
        #expect(SetupIntakeForm.toggled(["urban", "rural"], "any") == ["any"])
        #expect(SetupIntakeForm.toggled(["any"], "urban") == ["urban"])
        #expect(SetupIntakeForm.toggled(["urban"], "urban") == [])
    }
}
