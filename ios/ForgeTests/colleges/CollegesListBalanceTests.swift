import Testing
@testable import Forge

@Suite("Shortlist balance")
struct CollegesListBalanceTests {
    private func school(_ slug: String, _ tier: CollegeTier?) -> College {
        var college = College(slug: slug, name: slug)
        college.tier = tier
        return college
    }

    @Test func exactlyHalfReachesAndTwoLikelyNeedsNoWarning() {
        let list = [school("a", .reach), school("b", .reach), school("c", .safety), school("d", .safety)]
        #expect(CollegesShortlist.balanceWarnings(list).isEmpty)
    }

    @Test func countsUCSlotsPerTierAndAcrossTheEntireList() {
        let list = [
            school("university-of-california-alpha", .safety), school("university-of-california-beta", .safety),
            school("university-of-california-gamma", .reach), school("redwood", .reach), school("spruce", nil)
        ]
        #expect(CollegesShortlist.balanceWarnings(list) == [
            "Your list has 1 likely school. Add at least two you would be glad to attend.",
            "2 of your 3 applications are reaches. Keeping reaches to half the list or fewer leaves room for schools you are likely to get into."
        ])
    }

    @Test func noLikelySchoolsAndNoReachWarningForEmptyList() {
        #expect(CollegesShortlist.balanceWarnings([]) == [
            "Your list has 0 likely schools. Add at least two you would be glad to attend."
        ])
    }

    @Test func gapsRecountCampusesUnlessSavedBeforeGoals() {
        let colleges = [school("a", .target), school("b", .target)]
        #expect(CollegesListGap(tier: .target, missing: 3, goal: 2).message(for: colleges) == nil)
        #expect(CollegesListGap(tier: .safety, missing: 1, goal: nil).message(for: colleges) ==
            "Rebalancing could not find 1 more likely school that fit your preferences. Add your own from Explore.")
    }

    @Test func rebalanceSummariesDescribeActualChanges() {
        let changed = CollegesRebalanceResponse(data: .empty, added: ["A", "B"], removed: ["C"], gaps: [])
        #expect(changed.summary(shiftedTo: .ambitious) == "List balance set to more reaches. Added A, B. Removed C.")
        let unchanged = CollegesRebalanceResponse(data: .empty, added: [], removed: [], gaps: [])
        #expect(unchanged.summary(shiftedTo: nil) ==
            "Nothing changed. Every school on your list is one you or the copilot added, or the list already matches this balance.")
    }
}
