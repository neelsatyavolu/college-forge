import Foundation
import Testing
@testable import Forge

@Suite("GPA by school year")
struct GPAYearsTests {
    @Test func validatesEachYearWithTheWebsWording() {
        let tenth = GPAYears.all[1]
        #expect(GPAYears.error("", year: tenth) == nil)
        #expect(GPAYears.error(" 3.7 ", year: tenth) == nil)
        #expect(GPAYears.error("4.1", year: tenth) == "10th grade GPA must be a number from 0 to 4, or left blank.")
        #expect(GPAYears.firstError(["9": "3.5", "11": "abc"]) == "11th grade GPA must be a number from 0 to 4, or left blank.")
        #expect(GPAYears.firstError(["9": "3.5"]) == nil)
    }

    @Test func patchSendsEveryYearAndDashesClearBlanks() {
        let draft = ["9": " 3.5", "10": "", "11": "3.9"]
        #expect(GPAYears.patch(draft) == ["9": "3.5", "10": "—", "11": "3.9", "12": "—"])
        #expect(GPAYears.stored(draft) == ["9": "3.5", "11": "3.9"])
    }

    @Test func summaryListsYearsThenServerTrendAndRecent() {
        var a = Applicant()
        #expect(GPAYears.summary(a) == nil)
        a.gpaTrend = "up"
        #expect(GPAYears.summary(a) == nil, "the trend alone doesn't show the line")
        a.gpaByYear = ["11": "3.9", "9": "3.5", "10": "3.8"]
        a.gpaRecent = "3.85"
        #expect(GPAYears.summary(a) == "Unweighted by year: 9th 3.5 · 10th 3.8 · 11th 3.9 · trending up · 10th–11th 3.85")
        a.gpaTrend = "sideways"
        a.gpaRecent = "—"
        #expect(GPAYears.summary(a) == "Unweighted by year: 9th 3.5 · 10th 3.8 · 11th 3.9")
    }

    @Test func applicantDecodesYearsLeniently() throws {
        let json: JSONValue = [
            "name": "Sample", "gpaTrend": "down", "gpaRecent": "3.6",
            "gpaByYear": ["9": "3.9", "10": "—", "11": 3.5, "12": ""],
        ]
        let a = try json.decode(Applicant.self)
        #expect(a.gpaByYear == ["9": "3.9"])
        #expect(a.gpaTrend == "down")
        #expect(a.gpaRecent == "3.6")

        let old = try (["name": "Sample"] as JSONValue).decode(Applicant.self)
        #expect(old.gpaByYear.isEmpty && old.gpaTrend == nil && old.gpaRecent == nil)
        let odd = try (["gpaByYear": "3.9"] as JSONValue).decode(Applicant.self)
        #expect(odd.gpaByYear.isEmpty)
    }

    @Test func draftLoadsYearsAndBlocksBadOnes() {
        var ws = Workspace.empty
        ws.applicant.gpaByYear = ["10": "3.8"]
        var draft = ProfileIdentityDraft(workspace: ws)
        #expect(draft.gpaByYear == ["10": "3.8"])
        #expect(draft.error == nil)
        draft.gpaByYear["12"] = "5"
        #expect(draft.error == "12th grade GPA must be a number from 0 to 4, or left blank.")
    }

    @Test func intakeSavesTheYearsItWasGiven() {
        var f = SetupIntakeForm()
        f.gpa9 = "3.6"
        f.gpa11 = " 3.9 "
        f.gpa10 = "nope"
        let built = f.build()
        guard case .object(let applicant)? = built.patch["applicant"] else {
            Issue.record("no applicant patch")
            return
        }
        #expect(applicant["gpaByYear"] == .object(["9": .string("3.6"), "11": .string("3.9")]))

        let empty = SetupIntakeForm().build()
        #expect(empty.patch["applicant"] == nil || {
            if case .object(let a)? = empty.patch["applicant"] { return a["gpaByYear"] == nil }
            return true
        }())
    }
}

@Suite("GPA by year saving")
@MainActor
struct GPAYearsStoreTests {
    @Test func savingSendsAllYearsAndKeepsTheServersDerivedTrend() async throws {
        let base = String(decoding: try Fixture.data("workspace"), as: UTF8.self)
        let transport = MockTransport { request in
            let applicant = request.jsonBody?["applicant"] as? [String: Any]
            #expect(applicant?["gpaByYear"] as? [String: String] == ["9": "3.5", "10": "—", "11": "3.9", "12": "—"])
            var ws = try JSONSerialization.jsonObject(with: Data(base.utf8)) as? [String: Any] ?? [:]
            var a = ws["applicant"] as? [String: Any] ?? [:]
            a["gpaByYear"] = ["9": "3.5", "11": "3.9"]
            a["gpaTrend"] = "up"
            ws["applicant"] = a
            return (200, try JSONSerialization.data(withJSONObject: ["success": true, "data": ws]))
        }
        let manager = TokenManager(store: MemoryTokenStore(), devToken: "t") { _ in throw APIError.signedOut }
        let store = WorkspaceStore(api: APIClient(config: testConfig, transport: transport, tokens: manager))
        store.seed(workspace: PreviewData.workspace, tracker: PreviewData.tracker)

        var draft = ProfileIdentityDraft(workspace: store.workspace)
        draft.gpaByYear = ["9": "3.5", "11": "3.9"]
        try await store.saveIdentity(draft)
        #expect(store.workspace.applicant.gpaByYear == ["9": "3.5", "11": "3.9"])
        #expect(store.workspace.applicant.gpaTrend == "up")
    }
}
