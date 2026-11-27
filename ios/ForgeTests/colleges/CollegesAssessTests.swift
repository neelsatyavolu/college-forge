import Foundation
import Testing
@testable import Forge

@Suite("Assess all and chances per app")
struct CollegesAssessTests {
    private func odds(_ percent: Int) throws -> AdmissionOdds {
        try (["percent": .number(Double(percent)), "low": 1, "high": 99, "estimatedAt": "2026-11-01T00:00:00Z"] as JSONValue)
            .decode(AdmissionOdds.self)
    }

    private func app(_ id: String, _ name: String, slug: String? = nil, collegeId: String? = nil, oddsKey: String? = nil) throws -> TrackedApplication {
        var json: [String: JSONValue] = ["id": .string(id), "name": .string(name)]
        if let slug { json["slug"] = .string(slug) }
        if let collegeId { json["collegeId"] = .string(collegeId) }
        if let oddsKey { json["oddsKey"] = .string(oddsKey) }
        return try JSONValue.object(json).decode(TrackedApplication.self)
    }

    @Test func summaryMatchesTheWebsWording() {
        #expect(CollegesAssess.summary(sorted: 1, left: []) == "Sorted 1 school into reach, target or likely.")
        #expect(CollegesAssess.summary(sorted: 3, left: ["Sample U", "Test College"])
                == "Sorted 3 schools into reach, target or likely. Couldn’t estimate Sample U, Test College; run Assess all again or pick a tier yourself.")
        #expect(CollegesAssess.summary(sorted: 0, left: ["Sample U"])
                == "Couldn’t estimate Sample U; run Assess all again or pick a tier yourself.")
        #expect(CollegesAssess.summary(sorted: 0, left: []).isEmpty)
    }

    @Test func actionResponseCarriesAssessedAndUnknown() throws {
        let r = try (["success": true, "assessed": ["A", "B"], "unknown": ["C"]] as JSONValue).decode(WorkspaceActionResponse.self)
        #expect(r.assessed == ["A", "B"])
        #expect(r.unknown == ["C"])
        let old = try (["success": true] as JSONValue).decode(WorkspaceActionResponse.self)
        #expect(old.assessed.isEmpty && old.unknown.isEmpty)
    }

    @Test func schoolKeyLinesUpNameVariants() {
        #expect(CollegesOdds.schoolKey("University of Michigan--Ann Arbor") == "university of michigan ann arbor")
        #expect(CollegesOdds.schoolKey("The University of Texas at Austin") == "university of texas at austin")
        #expect(CollegesOdds.schoolKey("Theater Academy, Inc.") == "theater academy inc")
    }

    @Test func appFindsItsOwnEstimateFirst() throws {
        var ws = Workspace.empty
        ws.colleges = [College(slug: "unc", name: "University of North Carolina at Chapel Hill")]
        ws.admissionOdds = ["unc": try odds(20), "app:a1": try odds(40)]

        // The server's oddsKey wins over everything.
        #expect(CollegesOdds.forApp(try app("a1", "UNC Chapel Hill", oddsKey: "unc"), in: ws)?.percent == 20)
        // An oddsKey with no estimate falls back to the app's own key.
        #expect(CollegesOdds.forApp(try app("a1", "UNC Chapel Hill", oddsKey: "missing"), in: ws)?.percent == 40)
        // Older servers without oddsKey: no name match, so nothing.
        #expect(CollegesOdds.forApp(try app("a2", "UNC Chapel Hill"), in: ws) == nil)
    }

    @Test func appFallsBackToItsShortlistSchool() throws {
        var ws = Workspace.empty
        var mich = College(slug: "umich", name: "University of Michigan--Ann Arbor")
        mich.short = "Michigan"
        ws.colleges = [mich, College(slug: "cat-1", name: "Sample Institute"), College(slug: "none", name: "No Estimate U")]
        ws.admissionOdds = ["umich": try odds(18), "cat-1": try odds(55)]

        #expect(CollegesOdds.forApp(try app("x", "Anything", slug: "umich"), in: ws)?.percent == 18)
        #expect(CollegesOdds.forApp(try app("x", "Anything", collegeId: "cat-1"), in: ws)?.percent == 55)
        #expect(CollegesOdds.forApp(try app("x", "michigan"), in: ws)?.percent == 18)
        #expect(CollegesOdds.forApp(try app("x", "The University of Michigan"), in: ws)?.percent == 18)
        #expect(CollegesOdds.forApp(try app("x", "No Estimate U"), in: ws) == nil)
        #expect(CollegesOdds.chanceText(try odds(18)) == "18% chance")
    }
}

@Suite("Assess all request")
@MainActor
struct CollegesAssessStoreTests {
    @Test func postsAssessTiersAndAppliesTheWorkspace() async throws {
        let base = String(decoding: try Fixture.data("workspace"), as: UTF8.self)
        let transport = MockTransport { request in
            #expect(request.jsonBody?["action"] as? String == "assess-tiers")
            return (200, .json(#"{"success":true,"assessed":["Sample U"],"unknown":["Test College"],"data":"# + base + "}"))
        }
        let manager = TokenManager(store: MemoryTokenStore(), devToken: "t") { _ in throw APIError.signedOut }
        let store = WorkspaceStore(api: APIClient(config: testConfig, transport: transport, tokens: manager))
        store.seed(workspace: PreviewData.workspace, tracker: PreviewData.tracker)

        let result = try await store.shortlistAssessTiers()
        #expect(result.assessed == ["Sample U"])
        #expect(result.unknown == ["Test College"])
        #expect(store.workspace.revision == 42)
    }

    @Test func missingWorkspaceIsAnError() async throws {
        let transport = MockTransport { _ in (200, .json(#"{"success":true,"assessed":[],"unknown":[]}"#)) }
        let manager = TokenManager(store: MemoryTokenStore(), devToken: "t") { _ in throw APIError.signedOut }
        let store = WorkspaceStore(api: APIClient(config: testConfig, transport: transport, tokens: manager))
        store.seed(workspace: PreviewData.workspace, tracker: PreviewData.tracker)

        await #expect(throws: APIError.server(status: 200, message: "Could not assess your schools. Please try again.")) {
            _ = try await store.shortlistAssessTiers()
        }
    }
}
