import Foundation

// Run against a disposable, open-admission loopback server. Keep the two test identities in memory.
final class SmokeStore: CredentialStore {
    var secrets: [String: String] = [:]
    var settings: [String: String] = [:]
    func readSecret(key: String) -> String? { secrets[key] }
    func saveSecret(key: String, value: String) -> Bool { secrets[key] = value; return true }
    func removeSecret(key: String) { secrets.removeValue(forKey: key) }
    func readSetting(key: String) -> String? { settings[key] }
    func saveSetting(key: String, value: String) { settings[key] = value }
}

@main @MainActor
enum CommunitySmoke {
    struct Failure: Error { let step: String }

    static func wait(_ step: String, until ready: () -> Bool) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(15))
        while !ready() {
            guard ContinuousClock.now < deadline else { throw Failure(step: step) }
            try await Task.sleep(for: .milliseconds(40))
        }
    }

    static func main() async throws {
        guard CommandLine.arguments.count == 2,
              let url = URL(string: CommandLine.arguments[1]), ["127.0.0.1", "localhost"].contains(url.host)
        else { throw Failure(step: "Pass the URL of a disposable loopback fixture") }
        guard (try? CommunityTransport.origin(url.absoluteString, debugLoopback: false)) == nil,
              (try? CommunityTransport.origin("https://user:pw@example.org", debugLoopback: false)) == nil,
              try CommunityTransport.origin(" Example.org:443/ ", debugLoopback: false) == "https://example.org",
              validChatMessage(String(repeating: "🙂", count: 2000)), !validChatMessage(String(repeating: "🙂", count: 2001)),
              !validChatMessage("a\u{1}b") else { throw Failure(step: "Origin and Unicode contract") }
        let store = SmokeStore()
        let author = CommunityClient(store: store, debugLoopback: true)
        let reader = CommunityClient(store: SmokeStore(), debugLoopback: true)
        let suffix = String(UUID().uuidString.prefix(8))
        for (index, client) in [author, reader].enumerated() {
            client.connect(address: url.absoluteString)
            try await wait("server selection") { client.state.installation != nil && !client.state.busy }
            client.join(nickname: "Mac-\(index)-\(suffix)", invitation: "")
            try await wait("guest history and event connection") { client.state.connected && client.state.messages != nil && !client.state.busy }
        }
        let text = "macOS smoke \(suffix)"
        author.send(body: text) { _ in }
        try await wait("peer received message") { reader.state.messages?.contains { $0.body == text } == true && !author.state.busy }
        guard let original = author.state.messages?.first(where: { $0.body == text }) else { throw Failure(step: "author timeline") }
        author.edit(message: original, body: text + " edited") { _ in }
        try await wait("peer received edit") { reader.state.messages?.contains { $0.id == original.id && $0.body == text + " edited" } == true && !author.state.busy }
        author.delete(message: original)
        try await wait("peer received deletion") { reader.state.messages?.contains { $0.id == original.id } == false && !author.state.busy }
        let identity = author.state.membership?.participant.id
        author.switchServer()
        author.connect(address: url.absoluteString)
        try await wait("same identity restored") { author.state.membership?.participant.id == identity && author.state.connected && !author.state.busy }
        author.switchServer()
        reader.switchServer()
        print("Passed origin, message validation, two guest admissions, live create/edit/delete, and session restoration.")
    }
}
