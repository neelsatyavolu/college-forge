import Foundation
import Testing
@testable import Forge

// The fixture is synthetic: made-up schools and points, no real student data.

private func apiClient(_ transport: MockTransport) -> APIClient {
    let manager = TokenManager(store: MemoryTokenStore(), devToken: "t") { _ in throw APIError.signedOut }
    return APIClient(config: testConfig, transport: transport, tokens: manager)
}

private func college(_ slug: String, _ name: String, rank: Int? = nil, points: [ScatterPoint] = []) -> CollegeScattergram {
    CollegeScattergram(slug: slug, name: name, rank: rank, points: points)
}

@Suite("Scattergram decoding")
struct ScattergramDecodingTests {
    private func doc() throws -> ScattergramDoc {
        try #require(try Fixture.decode(ScattergramsResponse.self, "scattergrams").data)
    }

    @Test func decodesTheDocLeniently() throws {
        let doc = try doc()
        #expect(doc.importedAt == Date(timeIntervalSince1970: 1_793_577_600))
        #expect(doc.classOfYears == "3")
        #expect(doc.student == ScatterStats(gpa: 3.82, sat: 1480))
        // The non-object entry is skipped; the rest survive.
        #expect(Set(doc.colleges.keys) == ["alder-college", "birch-university", "cedar-institute"])
    }

    @Test func decodesPointsAcceptingStringsAndSkippingBadOnes() throws {
        let alder = try #require(try doc().colleges["alder-college"])
        #expect(alder.rank == 12)
        #expect(alder.n == 5)
        #expect(alder.accepted == 2)
        #expect(alder.averages == ScatterStats(gpa: 3.9, sat: 1500))
        #expect(alder.points.count == 5)
        #expect(alder.points[1] == ScatterPoint(sat: 1390, gpa: 3.6, result: .denied, round: "Regular Decision"))
        #expect(alder.points[2].round == nil)
        #expect(alder.points[3].sat == nil)
    }

    @Test func missingSlugTakesItsKeyAndUnknownOutcomesAreOther() throws {
        let cedar = try #require(try doc().colleges["cedar-institute"])
        #expect(cedar.slug == "cedar-institute")
        #expect(cedar.rank == 40)
        #expect(cedar.averages == ScatterStats())
        #expect(cedar.points.first?.result == .other)
    }

    @Test func nullDataMeansNothingImported() throws {
        let reply = try JSONDecoder().decode(ScattergramsResponse.self, from: Data(#"{"success":true,"data":null}"#.utf8))
        #expect(reply.data == nil)
    }

    @Test func getAndDeleteHitTheWorkspaceRoute() async throws {
        let transport = MockTransport { request in
            request.httpMethod == "DELETE" ? (200, Data(#"{"success":true,"data":null}"#.utf8)) : (200, try Fixture.data("scattergrams"))
        }
        let api = apiClient(transport)
        let loaded = try await api.scattergrams()
        #expect(loaded?.colleges.count == 3)
        try await api.deleteScattergrams()
        #expect(transport.requests.map(\.httpMethod) == ["GET", "DELETE"])
        #expect(transport.requests.allSatisfy { $0.url?.path == "/api/workspace/scattergrams" })
    }

    @Test func deleteSurfacesTheServersRefusal() async {
        let api = apiClient(MockTransport { _ in (403, Data(#"{"success":false,"error":"Not allowed."}"#.utf8)) })
        await #expect(throws: APIError.server(status: 403, message: "Not allowed.")) { try await api.deleteScattergrams() }
    }
}

@Suite("Scattergram rules")
struct ScattergramLogicTests {
    @Test func firstNumberReadsProfileFields() {
        #expect(ScattergramLogic.firstNumber("3.9/4.0") == 3.9)
        #expect(ScattergramLogic.firstNumber("1,500") == 1500)
        #expect(ScattergramLogic.firstNumber("—") == nil)
    }

    @Test func studentMarkerPrefersMaiaThenProfile() {
        var applicant = Applicant()
        applicant.gpaUnweighted = "3.7 / 4.0"
        applicant.sat = "1,420"
        let fromProfile = ScattergramLogic.studentMarker(doc: nil, applicant: applicant)
        #expect(fromProfile == ScatterStudentMarker(gpa: 3.7, sat: 1420, fromMaia: false))

        let maia = ScattergramDoc(student: ScatterStats(gpa: 3.9, sat: 1500), colleges: [:])
        #expect(ScattergramLogic.studentMarker(doc: maia, applicant: applicant) == ScatterStudentMarker(gpa: 3.9, sat: 1500, fromMaia: true))

        let halfMaia = ScattergramDoc(student: ScatterStats(gpa: 3.9), colleges: [:])
        #expect(ScattergramLogic.studentMarker(doc: halfMaia, applicant: applicant) == ScatterStudentMarker(gpa: 3.9, sat: 1420, fromMaia: false))

        applicant.sat = "34 ACT"
        #expect(ScattergramLogic.studentMarker(doc: nil, applicant: applicant) == nil)
    }

    @Test func roundKindMatchesMaiaLabelsLoosely() {
        #expect(ScattergramLogic.roundKind("Early Decision II") == .ed)
        #expect(ScattergramLogic.roundKind("ED2") == .ed)
        #expect(ScattergramLogic.roundKind("REA") == .ea)
        #expect(ScattergramLogic.roundKind("Restrictive Early Action") == .ea)
        #expect(ScattergramLogic.roundKind("Regular Decision") == nil)
        #expect(ScattergramLogic.roundKind(nil) == nil)
    }

    @Test func headlineCountsAdmitsAndEarlyRounds() throws {
        let alder = try #require(try Fixture.decode(ScattergramsResponse.self, "scattergrams").data?.colleges["alder-college"])
        #expect(ScattergramLogic.headline(alder) == "5 applicants · 2 accepted (40%) · ED 1 of 1 accepted · EA 1 of 2 accepted")
        #expect(ScattergramLogic.headline(college("x", "X")) == "No applicants from your school")
        #expect(ScattergramLogic.unplotted(alder) == 1)
    }

    @Test func plottedDropsPartialPointsAndDrawsAdmitsLast() {
        let c = college("x", "X", points: [
            ScatterPoint(sat: 1500, gpa: 3.9, result: .accepted),
            ScatterPoint(sat: 1400, gpa: 3.5, result: .denied),
            ScatterPoint(sat: nil, gpa: 3.5, result: .denied),
            ScatterPoint(sat: 1450, gpa: 3.7, result: .other),
            ScatterPoint(sat: 1420, gpa: 3.6, result: .waitlisted),
        ])
        #expect(ScattergramLogic.plotted(c).map(\.result) == [.other, .denied, .waitlisted, .accepted])
    }

    @Test func domainFitsPointsWithMinimumSpans() {
        let points = [ScatterPoint(sat: 1390, gpa: 3.6, result: .denied), ScatterPoint(sat: 1560, gpa: 4.0, result: .accepted)]
        let domain = ScattergramLogic.domain(points: points, student: nil)
        #expect(domain.sat == 1300...1600)
        #expect(domain.gpa == 3.5...4.0)
        #expect(domain.satTicks == [1400, 1600])
        #expect(domain.gpaTicks == [3.5, 3.75, 4.0])

        let wide = ScattergramLogic.domain(points: [ScatterPoint(sat: 1010, gpa: 2.9, result: .accepted)], student: ScatterStudentMarker(gpa: 4.6, sat: 1550, fromMaia: true))
        #expect(wide.sat == 900...1600)
        #expect(wide.gpa == 2.75...4.75)

        let empty = ScattergramLogic.domain(points: [], student: nil)
        #expect(empty.sat == 1300...1600)
        #expect(empty.gpa == 3.5...4.0)
    }

    @Test func sectionsFollowListOrderThenRankedOthers() {
        let doc = ScattergramDoc(colleges: [
            "a": college("a", "Alder", rank: 12),
            "b": college("b", "Birch"),
            "c": college("c", "Cedar", rank: 30),
            "d": college("d", "Aspen"),
        ])
        var onList = College(slug: "b", name: "Birch University")
        onList.short = "Birch"
        let list = [onList, College(slug: "a", name: "Alder"), College(slug: "z", name: "Zelkova College")]
        let sections = ScattergramLogic.sections(doc: doc, list: list)
        #expect(sections.onList.map(\.slug) == ["b", "a"])
        #expect(sections.notImported == ["Zelkova College"])
        #expect(sections.others.map(\.slug) == ["c", "d"])

        let filtered = ScattergramLogic.sections(doc: doc, list: list, query: "as")
        #expect(filtered.onList.isEmpty)
        #expect(filtered.others.map(\.slug) == ["d"])
        #expect(filtered.notImported.isEmpty)
    }

    @Test func importedLabelAndStudentLine() {
        let doc = ScattergramDoc(importedAt: Date(timeIntervalSince1970: 0), classOfYears: "4", colleges: [:])
        #expect(ScattergramLogic.importedLabel(doc)?.hasSuffix(" · last 4 classes") == true)
        #expect(ScattergramLogic.importedLabel(ScattergramDoc(colleges: [:])) == nil)
        #expect(ScattergramLogic.studentLine(ScatterStudentMarker(gpa: 3.9, sat: 1500, fromMaia: true))
            .hasPrefix("You: SAT 1500, unweighted GPA 3.9 (from Maia)."))
    }
}
