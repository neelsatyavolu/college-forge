import Foundation
import Testing
@testable import Forge

@Suite("Decisions")
struct DecisionLogicTests {
    @Test(arguments: [
        ("Congratulations! You have been admitted.", AppStatus.admitted),
        ("We are unable to offer you admission.", .denied),
        ("You were not admitted this year.", .denied),
        ("You have been placed on the wait list.", .waitlisted),
        ("Your application was deferred to Regular Decision.", .deferred),
    ])
    func guessesOutcome(text: String, expected: AppStatus) {
        #expect(DecisionLogic.guess(text) == expected)
    }

    @Test func noGuessForNeutralWords() {
        #expect(DecisionLogic.guess("Your decision is available.") == nil)
        #expect(DecisionLogic.guess("") == nil)
    }

    @Test func suggestedOutcomeLeads() {
        #expect(DecisionLogic.recordOptions(suggested: .waitlisted) == [.waitlisted, .admitted, .denied, .deferred])
        #expect(DecisionLogic.recordOptions(suggested: nil) == DecisionLogic.recordable)
    }

    @Test func sections() {
        let s = DecisionLogic.sections([
            AppFixture.make("h", decision: .hidden),
            AppFixture.make("r", decision: .revealed),
            AppFixture.make("c", status: .admitted, decision: .recorded),
            AppFixture.make("w", status: .complete),
            AppFixture.make("k", status: .inProgress),
        ])
        #expect(s.hidden.map(\.id) == ["h"])
        #expect(s.known.map(\.id) == ["r", "c"])
        #expect(s.waiting.map(\.id) == ["w"])
    }
}

@Suite("Add a school search")
struct SchoolSearchTests {
    private let catalog = [
        CatalogSchool(id: "umich", name: "University of Michigan", state: "MI", monogram: "UM", colors: [], portalName: "Wolverine Access", loginUrl: "", howToLogIn: "", logo: nil),
        CatalogSchool(id: "msu", name: "Michigan State University", state: "MI", monogram: "MSU", colors: [], portalName: "Portal", loginUrl: "", howToLogIn: "", logo: nil),
        CatalogSchool(id: "tamu", name: "Texas A&M University", state: "TX", monogram: "TAMU", colors: [], portalName: "Portal", loginUrl: "", howToLogIn: "", logo: nil),
    ]

    @Test func normalize() {
        #expect(SchoolSearch.normalize("  Texas A&M,  University ") == "texas aandm university")
    }

    @Test func prefixMatchesFirstAndTrackedHidden() {
        var tracked = AppFixture.make("1", name: "Somewhere")
        tracked.collegeId = "umich"
        let r = SchoolSearch.results(query: "mich", tracked: [tracked], shortlist: [], catalog: catalog)
        #expect(r.catalog.map(\.id) == ["msu"])
        #expect(r.offersCustom)
    }

    @Test func exactMatchHidesCustom() {
        let r = SchoolSearch.results(query: "michigan state university", tracked: [], shortlist: [], catalog: catalog)
        #expect(!r.offersCustom)
        #expect(SchoolSearch.results(query: "m", tracked: [], shortlist: [], catalog: catalog).catalog.isEmpty)
    }

    @Test func shortlistWithoutQuery() {
        let shortlist = [College(slug: "rice", name: "Rice University", short: "Rice"), College(slug: "tufts", name: "Tufts University", short: "Tufts")]
        var tracked = AppFixture.make("1", name: "Rice University")
        tracked.slug = "rice"
        let r = SchoolSearch.results(query: "", tracked: [tracked], shortlist: shortlist, catalog: catalog)
        #expect(r.shortlist.map(\.slug) == ["tufts"])
        #expect(!r.offersCustom)
    }
}

@Suite("Application edit form")
struct ApplicationDraftTests {
    @Test func unchangedDraftHasNoEdit() {
        let app = AppFixture.make("a", deadline: "2027-01-01")
        #expect(ApplicationDraft(app).edit(from: app) == nil)
    }

    @Test func onlyChangedFields() {
        var app = AppFixture.make("a", deadline: "2027-01-01")
        app.decisionDate = KeyDate(date: "2027-03-28", kind: "Decision", estimated: true)
        var draft = ApplicationDraft(app)
        #expect(draft.decisionDate == "", "estimated dates aren't the student's own")
        draft.deadline = ""
        draft.portalUrl = " https://apply.example.edu/status "
        let edit = draft.edit(from: app)
        #expect(edit == ApplicationEdit(deadline: "", portalUrl: "https://apply.example.edu/status"))
    }

    @Test func portalRoundIsUnsetInForm() {
        var app = AppFixture.make("a")
        app.round = .ea
        app.roundFromPortal = true
        #expect(ApplicationDraft(app).round == .none)
    }

    @Test func validation() {
        var draft = ApplicationDraft(AppFixture.make("a"))
        #expect(draft.validationError == nil)
        draft.portalUrl = "http://apply.example.edu"
        #expect(draft.validationError != nil)
        draft.portalUrl = "https://apply.example.edu"
        draft.name = "  "
        #expect(draft.validationError == "Enter the school's name.")
    }

    @Test func smallForms() {
        #expect(ApplicationsValidation.canAddFollowUp(" Send scores "))
        #expect(!ApplicationsValidation.canAddFollowUp("   "))
        #expect(!ApplicationsValidation.canAddFollowUp(String(repeating: "x", count: 301)))
        #expect(!ApplicationsValidation.canSaveLogin(username: "sam", password: ""))
        #expect(ApplicationsValidation.isWebLink("http://example.org/award"))
        #expect(!ApplicationsValidation.isWebLink("example.org"))
    }

    @Test func summaries() {
        #expect(ApplicationsValidation.checkSummary(total: 1, failed: 0) == "Checked 1 portal.")
        #expect(ApplicationsValidation.checkSummary(total: 3, failed: 1) == "Checked 3. 1 couldn't be read; see each school for why.")
        #expect(ApplicationsValidation.importSummary(added: 0, linked: 0) == "Everything from College Apps is already here.")
        #expect(ApplicationsValidation.importSummary(added: 1, linked: 2) == "Brought over 1 school and 2 logins for schools already here.")
    }
}
