import Foundation

struct Installation: Decodable {
    let name: String
    let configured: Bool
    var openAdmission: Bool
}

struct Member: Decodable { let id, nickname, role: String }
struct Category: Decodable { let id, name: String }
struct Channel: Decodable {
    let id, name, kind, categoryId: String
    let archived: Bool
}
struct Membership: Decodable {
    let participant: Member
    let channels: [Channel]
    let categories: [Category]
    let account: Bool
}
struct Message: Decodable {
    let id, authorId, nickname, body, createdAt: String
    let sequence, revision: Int64
    let editedAt: String?
}
struct SavedServer: Codable { let name, origin: String }
struct VoiceGrant: Decodable {
    let url, token, identity, channelId: String
    let canPublish: Bool
}
struct VoicePeer { let id, name: String; let speaking, local: Bool }
struct VoiceState {
    let channel: Channel
    let canPublish: Bool
    var connected = false
    var microphone = false
    var deafened = false
    var peers: [VoicePeer] = []
}
struct CommunityState {
    var origin = ""
    var installation: Installation?
    var membership: Membership?
    var channel: Channel?
    var messages: [Message]?
    var hasOlder = false
    var savedServers: [SavedServer] = []
    var voice: VoiceState?
    var connected = false
    var connectionProblem: String?
    var busy = false
    var error: String?
}

protocol CredentialStore {
    func readSecret(key: String) -> String?
    func saveSecret(key: String, value: String) -> Bool
    func removeSecret(key: String)
    func readSetting(key: String) -> String?
    func saveSetting(key: String, value: String)
}

final class MicrophoneIntent {
    private(set) var enabled = false
    private(set) var revision = 0
    func update(enabled: Bool) {
        self.enabled = enabled
        revision += 1
    }
}

func appleText(_ language: String, _ key: String) -> String {
    let resource = Bundle.main.url(forResource: language, withExtension: "lproj").flatMap(Bundle.init(url:))
    let bundle = resource ?? .main
    let fallback = bundle.localizedString(forKey: "service_unavailable", value: nil, table: "Desktop")
    return bundle.localizedString(forKey: key, value: fallback, table: "Desktop")
}

func chatMessageLength(_ body: String) -> Int { body.trimmingCharacters(in: .whitespacesAndNewlines).unicodeScalars.count }
func validChatMessage(_ body: String) -> Bool {
    let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
    return (1...2000).contains(trimmed.unicodeScalars.count) && !trimmed.unicodeScalars.contains {
        ($0.value < 32 || (127...159).contains($0.value)) && $0 != "\n" && $0 != "\t"
    }
}
func appleBool(_ value: Bool) -> Bool { value }
