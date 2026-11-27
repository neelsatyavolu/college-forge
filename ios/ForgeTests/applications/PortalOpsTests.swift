import Foundation
import Testing
@testable import Forge

@Suite("Portal ops: schedule, master login, set-up details")
struct PortalOpsTests {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }

    @Test func trackerDecodesScheduleAndOlderServersDoNot() throws {
        let t = try decode(TrackerView.self, #"{"revision":3,"autocheck":true,"emails":true,"flags":[],"apps":[],"schedule":{"everyHours":8,"startHour":7,"timeZone":"America/New_York","times":["07:00","15:00","23:00"],"nextAt":1790000000000}}"#)
        #expect(t.schedule?.everyHours == 8)
        #expect(t.schedule?.times == ["07:00", "15:00", "23:00"])
        #expect(t.schedule?.nextDate == Date(timeIntervalSince1970: 1_790_000_000))
        let old = try decode(TrackerView.self, #"{"revision":3,"autocheck":true,"emails":true,"flags":[],"apps":[]}"#)
        #expect(old.schedule == nil)
    }

    @Test func loginSourceAndSetupWaitingDecode() throws {
        let login = try decode(PortalLogin.self, #"{"username":"m","hasPassword":true,"source":"master"}"#)
        #expect(login.isMaster)
        #expect(try decode(PortalLogin.self, #"{"username":"m","hasPassword":true}"#).isMaster == false)
    }

    @Test func responsesCarryMasterAndSetup() throws {
        let r = try decode(ApplicationsResponse.self, #"{"success":true,"master":{"on":true,"username":"stu@example.com","appCount":2},"applied":2,"setup":{"username":"u","password":"p","pin":"123","link":"https://x.edu","state":"todo","reason":"PIN expired"}}"#)
        #expect(r.master?.appCount == 2)
        #expect(r.applied == 2)
        #expect(r.setup?.pin == "123")
        let inbox = try decode(InboxStatus.self, #"{"address":null,"birthdate":false,"useMasterForNew":true,"recent":[{"name":"Purdue","state":"todo","reason":"PIN expired","receivedAt":1000}]}"#)
        #expect(inbox.useMasterForNew)
        #expect(inbox.recent.first?.stateLabel == "Needs you")
    }

    @Test func actionsEncodeTheServerNames() throws {
        func body(_ a: ApplicationAction) throws -> [String: Any] {
            try JSONSerialization.jsonObject(with: JSONEncoder().encode(a)) as? [String: Any] ?? [:]
        }
        let s = try body(.schedule(everyHours: 8, startHour: 7, timeZone: "America/Chicago"))
        #expect(s["action"] as? String == "schedule")
        #expect(s["everyHours"] as? Int == 8)
        #expect(s["timeZone"] as? String == "America/Chicago")
        #expect(try body(.forgetMaster).count == 1)
        #expect(try body(.useMaster(id: "a1", on: true))["action"] as? String == "use-master")
        #expect(try body(.applyMasterAll)["action"] as? String == "apply-master-all")
        #expect(try body(.setupDetails(id: "a1"))["action"] as? String == "setup-details")
        #expect(try body(.inbox(on: true, useMasterForNew: true))["useMasterForNew"] as? Bool == true)
    }

    @Test func scheduleSummaryListsEveryTime() {
        let s = CheckSchedule(everyHours: 12, startHour: 7, timeZone: TimeZone.current.identifier, times: ["07:00", "19:00"], nextAt: nil)
        let text = CheckScheduleText.summary(s)
        #expect(text.hasPrefix("Checks around "))
        #expect(text.contains(" and "))
        #expect(!text.contains("time)"))
    }
}
