import SwiftUI

/// Demonstrated interest and interviews for one school: the school's sourced policy, what the student logged,
/// and a sheet to log more. Swipe an entry to delete it.
struct InterestLogSection: View {
    let app: TrackedApplication
    @Environment(WorkspaceStore.self) private var store
    @State private var adding = false
    @State private var error: APIError?

    var body: some View {
        Section {
            if let signal = app.interestSignal {
                policy(signal)
                if let nudge = signal.nudge {
                    Text(nudge).font(.subheadline.weight(.medium)).foregroundStyle(Theme.coral)
                }
            }
            if app.interest.isEmpty {
                Text("Log visits, info sessions, fairs, interviews and emails with your regional admissions officer.")
                    .foregroundStyle(Theme.muted)
            }
            ForEach(app.interest) { event in
                InterestEventRow(event: event, setThankYou: { set(event, InterestEdit(thankYouSent: $0)) }, markDone: { set(event, InterestEdit(done: true)) })
                    .swipeActions {
                        Button(role: .destructive) { set(event, InterestEdit(remove: true)) } label: { Label("Delete", systemImage: "trash") }
                    }
            }
            Button { adding = true } label: { Label("Log a visit or interview", systemImage: "plus") }
        } header: {
            Text("Interest and interviews")
        }
        .sheet(isPresented: $adding) { AddInterestSheet(app: app) }
        .errorAlert($error)
    }

    @ViewBuilder
    private func policy(_ signal: InterestSignal) -> some View {
        let rows: [(String, InterestFact)] = [
            signal.countsLabel.flatMap { label in signal.countsFact.map { (label, $0) } },
            signal.interviewLabel.flatMap { label in signal.interviewFact.map { (label, $0) } },
        ].compactMap { $0 }
        ForEach(rows, id: \.0) { label, fact in
            VStack(alignment: .leading, spacing: 2) {
                if let url = URL(string: fact.sourceUrl), url.scheme == "https" {
                    Link(destination: url) { Label(label, systemImage: "arrow.up.right.square") }
                } else {
                    Text(label).foregroundStyle(Theme.ink)
                }
                Text(fact.text).font(.footnote).foregroundStyle(Theme.muted)
            }
        }
    }

    private func set(_ event: InterestEvent, _ edit: InterestEdit) {
        Task {
            do {
                try await store.perform(.interestSet(id: app.id, interestId: event.id, edit: edit))
                Haptics.success()
            } catch {
                self.error = APIError.wrap(error)
            }
        }
    }
}

private struct InterestEventRow: View {
    let event: InterestEvent
    let setThankYou: (Bool) -> Void
    let markDone: () -> Void
    @State private var showPrep = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(event.kind.label).foregroundStyle(Theme.ink)
                if let who = event.who, !who.isEmpty { Text("· \(who)").foregroundStyle(Theme.body).lineLimit(1) }
                Spacer()
                Text(when).font(.footnote).foregroundStyle(event.done ? Theme.muted : Theme.accent)
            }
            if let notes = event.notes, !notes.isEmpty {
                Text(notes).font(.footnote).foregroundStyle(Theme.muted)
            }
            if let prep = event.prep, !prep.isEmpty {
                DisclosureGroup("Interview prep", isExpanded: $showPrep) {
                    Text(prep).font(.footnote).foregroundStyle(Theme.body).textSelection(.enabled)
                }
                .font(.footnote)
            }
            if !event.done {
                Button("Mark done", action: markDone).buttonStyle(.borderless).font(.footnote)
            } else if event.isInterview {
                Toggle("Thank-you note sent", isOn: Binding(get: { event.thankYouSent == true }, set: { setThankYou($0) }))
                    .font(.footnote)
            }
        }
    }

    private var when: String {
        let day = ForgeDates.short(event.date)
        guard let time = event.time, !time.isEmpty else { return day }
        return "\(day), \(InterestTime.display(time))"
    }
}

enum InterestTime {
    /// "15:30" → "3:30 PM".
    static func display(_ hhmm: String) -> String {
        let parts = hhmm.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return hhmm }
        let hour = (parts[0] + 11) % 12 + 1
        return String(format: "%d:%02d %@", hour, parts[1], parts[0] < 12 ? "AM" : "PM")
    }

    /// The "HH:MM" the server expects for a picked time.
    static func string(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }
}

private struct AddInterestSheet: View {
    let app: TrackedApplication
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var kind: InterestKind = .visit
    @State private var date = ForgeDates.today()
    @State private var hasTime = false
    @State private var time = Date.now
    @State private var who = ""
    @State private var notes = ""
    @State private var saving = false
    @State private var error: APIError?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("What", selection: $kind) {
                        ForEach(InterestKind.all, id: \.self) { Text($0.label).tag($0) }
                    }
                    OptionalDateRow(title: "Date", date: $date)
                    Toggle("Set a time", isOn: $hasTime)
                    if hasTime {
                        DatePicker("Time", selection: $time, displayedComponents: .hourAndMinute)
                    }
                } footer: {
                    if kind == .interview { Text("Booked interviews show on your calendar and Progress page.") }
                }
                Section {
                    TextField(kind == .interview ? "Interviewer" : "Regional officer or event", text: $who)
                    TextField("Notes", text: $notes, axis: .vertical).lineLimit(1...5)
                }
            }
            .navigationTitle("Log interest")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Log", action: save).disabled(saving || ForgeDates.day(date) == nil)
                }
            }
            .errorAlert($error)
        }
        .presentationDetents([.medium, .large])
    }

    private func save() {
        saving = true
        let edit = InterestEdit(
            kind: kind,
            date: date,
            time: hasTime ? InterestTime.string(time) : nil,
            who: who.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : String(who.trimmingCharacters(in: .whitespacesAndNewlines).prefix(120)),
            notes: notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : String(notes.trimmingCharacters(in: .whitespacesAndNewlines).prefix(1000))
        )
        Task {
            defer { saving = false }
            do {
                try await store.perform(.interestAdd(id: app.id, edit: edit))
                Haptics.success()
                dismiss()
            } catch {
                self.error = APIError.wrap(error)
            }
        }
    }
}
