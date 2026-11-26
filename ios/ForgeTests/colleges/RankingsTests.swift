import Foundation
import Testing
@testable import Forge

@Suite("Career rankings")
@MainActor
struct RankingsTests {
    @Test func decodesTheServersRanking() throws {
        let response = try Fixture.decode(RankingsResponse.self, "rankings")
        #expect(response.view == "path")
        #expect(response.isPath)
        #expect(response.tabs.first?.id == "path")
        #expect(response.tabs.contains { $0.id == "admitted" })
        #expect(response.pillars.count == 6)
        let first = try #require(response.rows.first)
        #expect(first.rank == "1")
        #expect(first.logo?.hasPrefix("/logos/") == true)
        #expect(first.measures.count == 6)
        #expect(response.ai == nil)
    }

    @Test func formatsLikeTheWebsite() {
        #expect(RankingsFormat.money(84_400) == "$84k")
        #expect(RankingsFormat.money(nil) == "—")
        #expect(RankingsFormat.percent(0.0123) == "1.2%")
        #expect(RankingsFormat.percent(0.93, digits: 0) == "93%")
        #expect(RankingsFormat.rank(12) == "#12")
    }

    @Test func keepsAtLeastOneTargetMajor() {
        let model = RankingsModel()
        let saved = model.request
        defer { model.request = saved }
        model.toggleTarget("cs", current: ["cs"], order: ["econ", "cs"])
        #expect(model.request.targets == saved.targets)
        model.toggleTarget("econ", current: ["cs"], order: ["econ", "cs"])
        #expect(model.request.targets == ["econ", "cs"])
    }

    @Test func refusesAllZeroWeights() {
        let model = RankingsModel()
        let saved = model.request
        defer { model.request = saved }
        model.setWeight("pay", to: 0, current: ["pay": 10, "campus": 0])
        #expect(model.request.weights == saved.weights)
        model.setWeight("campus", to: 15, current: ["pay": 10, "campus": 0])
        #expect(model.request.weights?["campus"] == 15)
    }

    @Test func sendsTheSettingsTheServerExpects() throws {
        let request = RankingsRequest(view: "cs", weights: ["pay": 20], flags: RankingsFlags(col: false, va: true, stretch: false), targets: ["cs"])
        let json = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any])
        #expect(json["view"] as? String == "cs")
        #expect((json["flags"] as? [String: Bool])?["va"] == true)
        #expect(json["targets"] as? [String] == ["cs"])
    }

    @Test func savesChangedSettingsToTheWorkspaceNotThePhone() {
        let model = RankingsModel()
        let saved = model.request
        defer { model.request = saved }
        model.request = RankingsRequest(view: saved.view)
        #expect(model.request.save == nil)
        model.toggleTarget("econ", current: ["cs"], order: ["econ", "cs"])
        #expect(model.request.save == true)
        // A fresh model keeps only the view; the workspace's saved settings apply.
        let reloaded = RankingsModel()
        #expect(reloaded.request.targets == nil)
        #expect(reloaded.request.view == model.request.view)
    }
}
