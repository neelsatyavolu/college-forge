import Foundation
import Testing
@testable import Forge

@Suite("More: copilot chat")
struct MoreChatTests {
    @Test func parsesStreamLines() {
        #expect(MoreChatEvent.parse("") == nil)
        #expect(MoreChatEvent.parse(#"{"type":"delta","text":"Hi"}"#) == .delta("Hi"))
        #expect(MoreChatEvent.parse(#"{"type":"status","stage":"context","message":"Loading your hub…"}"#) == .status("Loading your hub…"))
        #expect(MoreChatEvent.parse(#"{"type":"tool","name":"web_search","path":"rice deadlines"}"#) == .tool(name: "web_search", path: "rice deadlines"))
        #expect(MoreChatEvent.parse(#"{"type":"error","message":""}"#) == .error("The provider couldn't finish the reply."))
        #expect(MoreChatEvent.parse(#"{"type":"done","provider":"grok"}"#) == .done)
        #expect(MoreChatEvent.parse("not json") == .other)
        #expect(MoreChatEvent.parse(#"{"type":"usage"}"#) == .other)
    }

    @Test func softensTechnicalStatus() {
        #expect(MoreChatStatus.soften("Continuing (round 3)") == "Putting it together…")
        #expect(MoreChatStatus.soften("Continuing round 40") == "Nearly done…")
        #expect(MoreChatStatus.soften("Thinking: planning") == "Thinking it through…")
        #expect(MoreChatStatus.soften("Writing answer…") == "Writing a reply…")
        #expect(MoreChatStatus.soften("Updating hub: upsert_college (Rice)") == "Updating Rice…")
        #expect(MoreChatStatus.soften("updating your hub: set_testing") == "Saving test scores…")
        #expect(MoreChatStatus.soften("  ") == "Working…")
        #expect(MoreChatStatus.soften("Loading your hub…") == "Loading your hub…")
    }

    @Test func toolMessagesTruncateLongDetail() {
        let long = String(repeating: "a", count: 70)
        #expect(MoreChatStatus.tool("web_fetch", path: long) == "Reading page \(String(repeating: "a", count: 48))……")
        #expect(MoreChatStatus.tool("mystery") == "Updating your hub…")
    }

    @Test func outgoingTextMentionsAttachments() {
        #expect(MoreChatModel.outgoingText(typed: "Hi", files: []) == "Hi")
        #expect(MoreChatModel.outgoingText(typed: "", files: ["a.pdf", "b.txt"]) == "I uploaded a.pdf, b.txt. Please read them and populate my hub.")
        #expect(MoreChatModel.outgoingText(typed: "Use this", files: ["a.pdf"]) == "Use this\n\n(Attached files: a.pdf — read them and update my hub.)")
    }

    @Test func emptyHubSuggestsBuildingProfileAndList() {
        let ws = Workspace.empty
        #expect(MoreChatSuggestions.prompts(for: ws) == [
            "Here's my transcript and resume — build my profile.",
            "Build me a balanced college list from my profile and preferences.",
            "Add schools I'm interested in and tier them as reach / target / safety.",
        ])
        #expect(MoreChatSuggestions.intro(for: ws).hasPrefix("I build and maintain your hub."))
    }

    @Test func listWithoutEDOrDraftsAsksAboutThem() {
        var ws = Workspace.empty
        ws.applicant.gpaUnweighted = "3.9"
        ws.profile.activities = [Activity(rank: 1, name: "Robotics", type: "Club")]
        var rice = College(slug: "rice", name: "Rice University", short: "Rice")
        rice.tier = .reach
        ws.colleges = [rice]
        let prompts = MoreChatSuggestions.prompts(for: ws, limit: 10)
        #expect(prompts.first == "Add my awards and honors — I'll list them next.")
        #expect(prompts.contains("What's my strongest Early Decision option — is Rice realistic?"))
        #expect(prompts.contains("Find target and safety schools that fit my major and stats."))
        #expect(prompts.contains("Outline my Common App personal statement from my activities and story."))
        #expect(MoreChatSuggestions.intro(for: ws) == "You have 1 school on the list. I can rebalance tiers, pick an ED, draft essays, or fill any empty section.")
    }

    @Test func promptsAreUniqueAndLimited() {
        let prompts = MoreChatSuggestions.prompts(for: .empty, limit: 50)
        #expect(Set(prompts).count == prompts.count)
        #expect(MoreChatSuggestions.prompts(for: .empty).count == 3)
    }
}

@Suite("More: exports")
struct MoreExportTests {
    @Test func calendarMessageCountsEvents() {
        #expect(MoreExport.message(for: .ics, events: 1, skipped: 0) == "Calendar has 1 dated event.")
        #expect(MoreExport.message(for: .ics, events: 4, skipped: 2).hasPrefix("Calendar has 4 dated events. 2 dates were skipped"))
        #expect(MoreExport.message(for: .ics, events: nil, skipped: 1).contains("1 date was skipped"))
        #expect(MoreExport.message(for: .json, events: nil, skipped: nil) == "Ready to save or share.")
    }

    @Test func filenamesAreSafe() {
        #expect(MoreExport.suggestedFilename(fromDisposition: #"attachment; filename="counselor-brief-sam.md""#) == "counselor-brief-sam.md")
        #expect(MoreExport.suggestedFilename(fromDisposition: "attachment") == nil)
        #expect(MoreExport.filename(suggested: "../../etc/passwd", format: .txt) == "passwd")
        #expect(MoreExport.filename(suggested: nil, format: .brief) == "college-forge.md")
        #expect(MoreExport.filename(suggested: ".hidden", format: .ics) == "college-forge.ics")
    }

    @Test func shareScopeReadsServerValues() {
        #expect(MoreShareScope(serverValue: "progress") == .progress)
        #expect(MoreShareScope(serverValue: nil) == .full)
        #expect(MoreShareScope(serverValue: "full") == .full)
    }
}
