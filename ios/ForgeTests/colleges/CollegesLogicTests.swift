import Foundation
import Testing
@testable import Forge

private func college(_ slug: String, _ name: String? = nil, tier: CollegeTier? = nil, supp: String? = nil, scorecardId: Int? = nil) -> College {
    var c = College(slug: slug, name: name ?? slug.capitalized)
    c.tier = tier
    c.supp = supp
    c.scorecardId = scorecardId
    return c
}

@Suite("Shortlist rules")
struct CollegesShortlistTests {
    @Test func sectionsFollowTierOrderAndSkipEmpty() {
        let list = [college("a", tier: .target), college("b"), college("c", tier: .reach), college("d", tier: .target)]
        let sections = CollegesShortlist.sections(list, filter: .all)
        #expect(sections.map(\.id) == ["reach", "target", "unassessed"])
        #expect(sections[1].colleges.map(\.slug) == ["a", "d"])
        #expect(sections.last?.title == "Not assessed yet")
    }

    @Test func filterShowsOneTierWithoutUnassessed() {
        let list = [college("a", tier: .safety), college("b"), college("c", tier: .reach)]
        let sections = CollegesShortlist.sections(list, filter: .safety)
        #expect(sections.map(\.id) == ["safety"])
        #expect(sections.first?.title == "Likely")
        #expect(CollegesShortlist.sections(list, filter: .target).isEmpty)
    }

    @Test func unknownTierCountsAsUnassessed() {
        let list = [college("a", tier: CollegeTier(rawValue: "dream"))]
        #expect(CollegesShortlist.sections(list, filter: .all).map(\.id) == ["unassessed"])
    }

    @Test func ucCampusesShareOneSlot() {
        let list = [
            college("university-of-california-berkeley"),
            college("ucla"),
            college("x", "University of California-Davis"),
            college("rice"),
            college("mit"),
        ]
        #expect(CollegesShortlist.applicationSlots(list) == 3)
        #expect(CollegesShortlist.applicationSlots([college("rice")]) == 1)
        #expect(CollegesShortlist.applicationSlots([]) == 0)
    }

    @Test func supplementCountIgnoresNoSuppsAndBlank() {
        let list = [college("a", supp: "No supps"), college("b", supp: "Supps required"), college("c", supp: "Supps optional"), college("d"), college("e", supp: "")]
        #expect(CollegesShortlist.withSupplements(list) == 2)
    }

    @Test func addingAppendsNewSchool() {
        let list = [college("rice")]
        #expect(CollegesShortlist.adding(college("mit"), to: list).map(\.slug) == ["rice", "mit"])
    }

    @Test func addingMergesSameScorecardIdKeepingSavedFields() {
        var saved = college("rice", "Rice University", tier: .target, scorecardId: 227757)
        saved.major = "Computer Science"
        var incoming = college("rice-university", "Rice University", scorecardId: 227757)
        incoming.admit = "8%"
        let result = CollegesShortlist.adding(incoming, to: [saved])
        #expect(result.count == 1)
        #expect(result[0].major == "Computer Science")
        #expect(result[0].tier == .target)
        #expect(result[0].admit == "8%")
    }

    @Test func movingWithinSectionKeepsOtherPositions() {
        let list = [college("r1", tier: .reach), college("t1", tier: .target), college("r2", tier: .reach), college("r3", tier: .reach)]
        let reaches = list.filter { $0.tier == .reach }
        let moved = CollegesShortlist.moving(list, section: reaches, from: IndexSet(integer: 2), to: 0)
        #expect(moved.map(\.slug) == ["r3", "t1", "r1", "r2"])
    }

    @Test func trackedApplicationMatchesSlugThenName() {
        var bySlug = PreviewData.app(id: "1", name: "Other Name", status: .submitted, round: .rd, deadline: "")
        bySlug.slug = "rice"
        let byName = PreviewData.app(id: "2", name: "Duke University", status: .planning, round: .rd, deadline: "")
        #expect(CollegesShortlist.trackedApplication(for: college("rice"), in: [byName, bySlug])?.id == "1")
        #expect(CollegesShortlist.trackedApplication(for: college("duke", "duke university"), in: [byName, bySlug])?.id == "2")
        #expect(CollegesShortlist.trackedApplication(for: college("mit"), in: [byName, bySlug]) == nil)
    }
}

@Suite("Explore and programs")
struct CollegesExploreTests {
    @Test func filtersBySettingAndFavorites() {
        var a = college("a"); a.setting = "urban"
        var b = college("b"); b.setting = "rural"
        let rows = [a, b]
        #expect(CollegesExplore.filter(rows, setting: "all", favoritesOnly: false, favorites: []).count == 2)
        #expect(CollegesExplore.filter(rows, setting: "rural", favoritesOnly: false, favorites: []).map(\.slug) == ["b"])
        #expect(CollegesExplore.filter(rows, setting: "all", favoritesOnly: true, favorites: ["a"]).map(\.slug) == ["a"])
    }

    @Test func searchNeedsTwoCharacters() {
        #expect(CollegesExplore.searchTerm(" u ") == nil)
        #expect(CollegesExplore.searchTerm(" uc ") == "uc")
    }

    @Test func programsGroupByAreaMostAwardedFirst() {
        let programs = [
            CollegesProgram(code: "1", title: "History", area: "Humanities", awards: 10),
            CollegesProgram(code: "2", title: "CS", area: "Engineering", awards: 50),
            CollegesProgram(code: "3", title: "English", area: "Humanities", awards: 15),
            CollegesProgram(code: "4", title: "Art", area: "Arts"),
        ]
        let areas = CollegesPrograms.areas(programs)
        #expect(areas.map(\.area) == ["Engineering", "Humanities", "Arts"])
        #expect(areas[1].awards == 25)
        #expect(areas[1].programs.map(\.code) == ["1", "3"])
    }

    @Test func topEarningsSortsAndSkipsMissing() {
        let programs = (0..<15).map { CollegesProgram(code: "\($0)", title: "P\($0)", area: "A", earnings4: Double($0 * 1000)) }
            + [CollegesProgram(code: "x", title: "None", area: "A")]
        let top = CollegesPrograms.topEarnings(programs)
        #expect(top.count == 12)
        #expect(top.first?.code == "14")
        #expect(!top.contains { $0.code == "x" })
    }

    @Test func versusNationalRounds() {
        let up = CollegesProgram(code: "1", title: "", area: "", earnings4: 75_000, national4: 60_000)
        let down = CollegesProgram(code: "2", title: "", area: "", earnings4: 50_000, national4: 60_000)
        #expect(CollegesPrograms.versusNational(up) == 25)
        #expect(CollegesPrograms.versusNational(down) == -17)
        #expect(CollegesPrograms.versusNational(CollegesProgram(code: "3", title: "", area: "", earnings4: 1)) == nil)
    }
}

@Suite("Odds and formatting")
struct CollegesOddsTests {
    private func odds(_ stamp: String) -> AdmissionOdds {
        AdmissionOdds(percent: 10, low: 5, high: 20, baseline: 8, baselineSource: "", summary: "", factors: [], sources: [], estimatedAt: stamp)
    }

    @Test func missedKeysAreAbsentOrUnchanged() {
        let before = ["rice": odds("2026-10-01"), "mit": odds("2026-10-01")]
        let after = ["rice": odds("2026-11-20"), "mit": odds("2026-10-01")]
        #expect(CollegesOdds.missedKeys(["rice", "mit", "app:9"], before: before, after: after) == ["mit", "app:9"])
    }

    @Test func moneyAndDash() {
        #expect(CollegesFormat.money(nil) == "Not reported")
        #expect(CollegesFormat.money(12345.6) == "$12,346")
        #expect(CollegesFormat.dash("  ") == "—")
        #expect(CollegesFormat.dash("8%") == "8%")
    }

    @Test func placeSkipsMissingParts() {
        var c = college("rice")
        c.location = "Houston, TX · Private"
        c.setting = "urban"
        #expect(CollegesFormat.place(c) == "Houston, TX · Urban campus")
        c.ownership = "Private, nonprofit"
        #expect(CollegesFormat.place(c) == "Houston, TX · Urban campus · Private, nonprofit")
    }

    @Test func preferenceToggleAndMerge() {
        #expect(CollegesPreferenceDraft.toggled(["west"], "south", on: true) == ["west", "south"])
        #expect(CollegesPreferenceDraft.toggled(["west", "south"], "west", on: false) == ["south"])
        var saved = ListPrefs()
        saved.appCount = 10
        saved.notes = "near family"
        var draft = CollegesPreferenceDraft()
        draft.ambition = "ambitious"
        draft.regions = ["west"]
        let merged = draft.listPrefs(merging: saved)
        #expect(merged.appCount == 10)
        #expect(merged.notes == "near family")
        #expect(merged.ambition == "ambitious")
        #expect(merged.regions == ["west"])
    }
}

@Suite("College response decoding")
struct CollegesDecodingTests {
    @Test func decodesRecommendations() throws {
        let json = """
        {"success":true,"data":{"generatedAt":"2026-05-01","methodology":"m","sources":[{"label":"S","url":"/data/x.md"}],
        "limitations":["l1"],"profileGaps":["g1"],"recommendations":[{"college":{"slug":"sample-u","name":"Sample University",
        "short":"Sample","scorecardId":"123","tier":"target"},"fit":{"tier":null,"label":"Research","reasons":["r"],"cautions":["c"]},
        "onList":false,"evidence":{"fairRank":12,"rankLow":8,"rankHigh":20,"adjustedEarnings":81234.5,"netPrice":null,
        "scorecardUrl":"https://collegescorecard.ed.gov/school/?123"}}]}}
        """
        let set = try JSONDecoder().decode(DataEnvelope<CollegesRecommendationSet>.self, from: Data(json.utf8)).data
        let row = try #require(set.recommendations.first)
        #expect(row.college.scorecardId == 123)
        #expect(row.fit.tier == nil)
        #expect(row.evidence.fairRank == 12)
        #expect(row.evidence.netPrice == nil)
        #expect(set.sources.first?.url == "/data/x.md")
    }

    @Test func decodesDetailWithPrograms() throws {
        let json = """
        {"success":true,"data":{"slug":"sample-u","name":"Sample University","short":"Sample","rank":null,"onList":true,
        "coa":"$80,000","programs":[{"code":"1107","title":"Computer Science","area":"Computing","credential":"Bachelor's",
        "awards":120,"earnings4":110000,"national4":85000},{"bad":true}]}}
        """
        let detail = try JSONDecoder().decode(DataEnvelope<CollegesDetail>.self, from: Data(json.utf8)).data
        #expect(detail.college.coa == "$80,000")
        #expect(detail.college.rank == nil)
        #expect(detail.programs.count == 2)
        #expect(detail.programs.first?.awards == 120)
    }

    @Test func decodesBrowseWithEdition() throws {
        let json = #"{"success":true,"data":[{"slug":"a","name":"A","rank":1},{"slug":"b","name":"B"}],"edition":"2027"}"#
        let response = try JSONDecoder().decode(CollegesSearchResponse.self, from: Data(json.utf8))
        #expect(response.colleges.map(\.slug) == ["a", "b"])
        #expect(response.edition == "2027")
    }
}

@Suite("Shortlist remove confirm")
struct CollegesRemovalMessageTests {
    private func app(_ json: String) throws -> TrackedApplication {
        try JSONDecoder().decode(TrackedApplication.self, from: Data(json.utf8))
    }

    @Test func untrackedUntouchedAndStartedApplications() throws {
        #expect(CollegesShortlist.removalMessage(for: nil) == "Saved essay drafts will remain.")
        let fresh = try app(#"{"id":"a","name":"A","untouched":true}"#)
        #expect(CollegesShortlist.removalMessage(for: fresh).hasPrefix("Its Not started application leaves Applications"))
        let started = try app(#"{"id":"b","name":"B","statusLabel":"Writing"}"#)
        #expect(CollegesShortlist.removalMessage(for: started).contains("(Writing) stays on Applications"))
    }
}
