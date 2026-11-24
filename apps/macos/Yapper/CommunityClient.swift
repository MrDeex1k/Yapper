import CryptoKit
import Foundation

@MainActor
final class CommunityClient {
    struct Session {
        let id = UUID()
        let origin, cookie: String
        let staff: Bool
    }

    let store: CredentialStore
    let transport = CommunityTransport()
    let debugLoopback: Bool
    private var session: Session?
    private var token: (sessionID: UUID, value: String, expires: ContinuousClock.Instant)?
    private var eventLoop: Task<Void, Never>?
    private var socket: URLSessionWebSocketTask?
    private var history: Task<Void, Error>?
    private var latestMembershipRead = UUID()
    private var historyID = UUID()
    private var before: Int64 = 0
    private var revision: Int64?
    private var grant: VoiceGrant?
    private var voiceID = UUID()
    private var observer: ((CommunityState) -> Void)?
    private(set) var state = CommunityState() { didSet { observer?(state) } }

    init(store: CredentialStore, debugLoopback: Bool) {
        self.store = store
        self.debugLoopback = debugLoopback
        if let value = store.readSetting(key: "servers"),
           let saved = try? JSONDecoder().decode([SavedServer].self, from: Data(value.utf8)) { state.savedServers = saved }
    }

    func observe(_ update: @escaping (CommunityState) -> Void) { observer = update; update(state) }

    func action(_ work: @escaping () async throws -> Void) {
        guard !state.busy else { return }
        state.busy = true
        state.error = nil
        Task {
            defer { state.busy = false }
            do { try await work() }
            catch is CancellationError { }
            catch { state.error = (error as? ServiceError)?.code ?? "network_error" }
        }
    }

    private func cookieName(_ origin: String, staff: Bool) -> String {
        if staff { return (origin.hasPrefix("https:") ? "__Secure-" : "") + "better-auth.session_token" }
        return (origin.hasPrefix("https:") ? "__Host-" : "") + "yapper_guest"
    }

    private func validSecret(_ secret: String) -> Bool {
        !secret.isEmpty && secret.utf8.count <= 4096 && secret.utf8.allSatisfy { (33...126).contains($0) && ![34,44,59,92].contains($0) }
    }

    func connect(address: String) {
        action { [self] in
            let origin = try CommunityTransport.origin(address, debugLoopback: debugLoopback)
            let data = try await transport.exchange(origin, "/api/v1/state").0
            let installation = try JSONDecoder().decode(Installation.self, from: data)
            guard installation.configured else { throw ServiceError("setup_required") }
            reset()
            state.origin = origin
            state.installation = installation
            state.savedServers = Array(([SavedServer(name: installation.name, origin: origin)] + state.savedServers.filter { $0.origin != origin }).prefix(20))
            store.saveSetting(key: "servers", value: String(decoding: try JSONEncoder().encode(state.savedServers), as: UTF8.self))
            for staff in [true, false] {
                let key = (staff ? "staff:" : "guest:") + origin
                guard let secret = store.readSecret(key: key), validSecret(secret) else { continue }
                do {
                    try await activate(Session(origin: origin, cookie: cookieName(origin, staff: staff) + "=" + secret, staff: staff))
                    return
                } catch let error as ServiceError where [401,403].contains(error.status) && !["participant_banned","ip_blocked"].contains(error.code) {
                    if staff && error.status == 401 { store.removeSecret(key: key) }
                }
            }
        }
    }

    func join(nickname: String, invitation: String) {
        admit(staff: false, path: "/api/v1/guests", body: ["nickname": nickname.trimmingCharacters(in: .whitespacesAndNewlines),
                                                            "invitation": invitation.trimmingCharacters(in: .whitespacesAndNewlines)])
    }

    func signIn(username: String, password: String) {
        admit(staff: true, path: "/api/auth/sign-in/username", body: ["username": username.trimmingCharacters(in: .whitespacesAndNewlines), "password": password])
    }

    private func admit(staff: Bool, path: String, body: [String: Any]) {
        action { [self] in
            let origin = state.origin
            let key = (staff ? "staff:" : "guest:") + origin
            let name = cookieName(origin, staff: staff)
            let saved = staff ? nil : store.readSecret(key: key).flatMap { validSecret($0) ? $0 : nil }
            let (_, response) = try await transport.exchange(origin, path, body: body, cookie: saved.map { name + "=" + $0 })
            guard let url = response.url else { throw ServiceError("network_error") }
            let cookies = HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": response.value(forHTTPHeaderField: "Set-Cookie") ?? ""], for: url)
            guard let secret = cookies.first(where: { $0.name == name })?.value ?? saved, validSecret(secret) else { throw ServiceError("access_denied") }
            let persisted = store.saveSecret(key: key, value: secret)
            try await activate(Session(origin: origin, cookie: name + "=" + secret, staff: staff))
            if !persisted { state.error = "session_not_saved" }
        }
    }

    @discardableResult
    func request(_ path: String, body: [String: Any]? = nil, method: String? = nil, using explicit: Session? = nil) async throws -> Data {
        guard let owner = explicit ?? session else { throw ServiceError("access_denied", status: 401) }
        var bearer: String?
        if owner.staff && path.hasPrefix("/api/v1/") {
            if let token, token.sessionID == owner.id && token.expires > .now { bearer = token.value }
            else {
                struct Token: Decodable { let token: String }
                let data = try await transport.exchange(owner.origin, "/api/auth/token", cookie: owner.cookie).0
                let value = try JSONDecoder().decode(Token.self, from: data).token
                token = (owner.id, value, .now.advanced(by: .seconds(240)))
                bearer = value
            }
        }
        return try await transport.exchange(owner.origin, path, body: body, method: method, cookie: owner.cookie, bearer: bearer).0
    }

    private func activate(_ owner: Session) async throws {
        let member = try await JSONDecoder().decode(Membership.self, from: request("/api/v1/me", using: owner))
        session = owner
        apply(member)
        startEvents(owner)
    }

    private func apply(_ member: Membership) {
        state.membership = member
        let channel = member.channels.first { $0.id == state.channel?.id }
            ?? member.channels.first { $0.kind == "text" && !$0.archived }
            ?? member.channels.first { $0.kind == "text" }
        if channel?.id != state.channel?.id { clearHistory() }
        state.channel = channel
    }

    func refreshMembership() async throws {
        guard let owner = session else { return }
        let readID = UUID()
        latestMembershipRead = readID
        let member = try await JSONDecoder().decode(Membership.self, from: request("/api/v1/me", using: owner))
        if session?.id == owner.id && readID == latestMembershipRead { apply(member) }
    }

    private func startEvents(_ owner: Session) {
        eventLoop?.cancel()
        eventLoop = Task {
            while !Task.isCancelled && session?.id == owner.id {
                do {
                    struct Ticket: Decodable { let ticket: String }
                    let ticket = try await JSONDecoder().decode(Ticket.self, from: request("/api/v1/events/ticket", body: [:], using: owner))
                    try Task.checkCancellation()
                    let stream = try transport.events(origin: owner.origin, ticket: ticket.ticket)
                    socket = stream
                    stream.resume()
                    defer { stream.cancel(with: .goingAway, reason: nil) }
                    try await receive(stream, owner: owner)
                } catch {
                    guard !Task.isCancelled, session?.id == owner.id else { return }
                    state.connected = false
                    if socket?.closeCode.rawValue == 4001 {
                        state.connectionProblem = "kicked"
                        cancelVoice()
                        return
                    }
                    if let error = error as? ServiceError, [401,403].contains(error.status) {
                        state.connectionProblem = error.code
                        cancelVoice()
                        return
                    }
                    try? await Task.sleep(for: .seconds(2))
                }
            }
        }
    }

    private func receive(_ stream: URLSessionWebSocketTask, owner: Session) async throws {
        struct Event: Decodable {
            struct Payload: Decodable { let channelId: String? }
            let version: Int
            let type: String
            let payload: Payload?
        }
        while !Task.isCancelled && session?.id == owner.id {
            let frame = try await stream.receive()
            let data: Data
            switch frame {
            case .string(let text): data = Data(text.utf8)
            case .data(let bytes): data = bytes
            @unknown default: continue
            }
            try Task.checkCancellation()
            guard let event = try? JSONDecoder().decode(Event.self, from: data), event.version == 1 else { continue }
            switch event.type {
            case "ready":
                state.connectionProblem = nil
                state.connected = true
                try await refreshMembership()
                try await syncChat()
            case "catalog.changed", "members.changed":
                try await refreshMembership()
                try await syncChat()
            case "message.created", "messages.changed":
                if event.payload?.channelId == nil || event.payload?.channelId == state.channel?.id { try await syncChat() }
            default: break
            }
        }
    }

    func reconnect() {
        guard let owner = session, state.connectionProblem != nil, !state.busy else { return }
        socket = nil
        state.connectionProblem = nil
        startEvents(owner)
    }

    private func clearHistory() {
        history?.cancel()
        history = nil
        historyID = UUID()
        before = 0
        revision = nil
        state.messages = nil
        state.hasOlder = false
    }

    func select(channel: Channel) {
        guard !state.busy, state.connectionProblem == nil, channel.kind == "text", channel.id != state.channel?.id else { return }
        clearHistory()
        state.channel = channel
        action { try await self.syncChat() }
    }

    func loadOlder() { action { try await self.syncChat(older: true) } }

    private func syncChat(older: Bool = false) async throws {
        guard let channel = state.channel, state.connectionProblem == nil else { return }
        let generation = historyID
        let previous = history
        let next = Task {
            _ = await previous?.result
            guard !Task.isCancelled, generation == historyID else { return }
            try await readHistory(channel, older: older, generation: generation)
        }
        history = next
        try await next.value
    }

    private func readHistory(_ channel: Channel, older: Bool, generation: UUID) async throws {
        struct Page: Decodable { let messages: [Message]; let before, revision: Int64 }
        struct Change: Decodable { let id: String; let revision: Int64; let message: Message? }
        struct Changes: Decodable { let changes: [Change] }
        let base = "/api/v1/channels/" + pathSegment(channel.id)
        if revision == nil || older {
            let page = try await JSONDecoder().decode(Page.self, from: request(base + "/timeline?before=\(older ? before : 0)"))
            guard generation == historyID else { return }
            var items = Dictionary(uniqueKeysWithValues: page.messages.map { ($0.id, $0) })
            if older { for message in state.messages ?? [] { items[message.id] = message } }
            else { revision = page.revision }
            before = page.before
            state.hasOlder = before != 0
            state.messages = items.values.sorted { $0.sequence < $1.sequence }
        }
        while let cursor = revision, generation == historyID {
            let changes = try await JSONDecoder().decode(Changes.self, from: request(base + "/messages/changes?after=\(cursor)")).changes
            guard generation == historyID, let latest = changes.map(\.revision).max(), latest > cursor else { return }
            var items = Dictionary(uniqueKeysWithValues: (state.messages ?? []).map { ($0.id, $0) })
            for change in changes where change.revision > (items[change.id]?.revision ?? -1) {
                if let message = change.message {
                    if message.sequence >= before { items[change.id] = message }
                } else { items.removeValue(forKey: change.id) }
            }
            revision = latest
            state.messages = items.values.sorted { $0.sequence < $1.sequence }
            if changes.count < 100 { return }
        }
    }

    func send(body: String, completion: @escaping (Bool) -> Void) {
        guard let channel = state.channel, let member = state.membership?.participant, !channel.archived, validChatMessage(body), state.connectionProblem == nil else { return }
        action { [self] in
            let text = body.trimmingCharacters(in: .whitespacesAndNewlines)
            let key = "pending:\(state.origin):\(member.id):\(channel.id)"
            let digest = Data(SHA256.hash(data: Data(text.utf8))).base64EncodedString()
            let pending = store.readSetting(key: key)?.components(separatedBy: "|") ?? []
            let id = pending.count == 2 && pending[0] == digest ? pending[1].lowercased() : UUID().uuidString.lowercased()
            store.saveSetting(key: key, value: digest + "|" + id)
            try await request("/api/v1/channels/\(pathSegment(channel.id))/messages", body: ["body": text, "requestId": id])
            store.saveSetting(key: key, value: "")
            completion(true)
            try await syncChat()
        }
    }

    func edit(message: Message, body: String, completion: @escaping (Bool) -> Void) {
        guard let channel = state.channel, !channel.archived, validChatMessage(body), state.connectionProblem == nil else { return }
        action { [self] in
            try await request("/api/v1/channels/\(pathSegment(channel.id))/messages/\(pathSegment(message.id))/edit",
                              body: ["body": body.trimmingCharacters(in: .whitespacesAndNewlines), "revision": message.revision])
            completion(true)
            try await syncChat()
        }
    }

    func delete(message: Message) {
        guard let channel = state.channel, state.connectionProblem == nil else { return }
        action { [self] in
            try await request("/api/v1/channels/\(pathSegment(channel.id))/messages/\(pathSegment(message.id))/delete", body: [:])
            try await syncChat()
        }
    }

    func requestVoice(channel: Channel, start: @escaping (VoiceGrant) -> Void) {
        guard channel.kind == "voice", !channel.archived else { return }
        openVoice(channel, resume: nil, start: start)
    }

    func recoverVoice(identity: String, start: @escaping (VoiceGrant) -> Void) {
        Task {
            while state.busy && grant?.identity == identity { try? await Task.sleep(for: .milliseconds(30)) }
            if grant?.identity == identity, let channel = state.voice?.channel { openVoice(channel, resume: identity, start: start) }
        }
    }

    private func openVoice(_ channel: Channel, resume: String?, start: @escaping (VoiceGrant) -> Void) {
        guard state.connectionProblem == nil, let owner = session else { return }
        let generation = UUID()
        voiceID = generation
        action { [self] in
            var payload = ["channelId": channel.id]
            payload["resumeIdentity"] = resume
            do {
                let incoming = try await JSONDecoder().decode(VoiceGrant.self, from: request("/api/v1/voice/grant", body: payload, using: owner))
                guard generation == voiceID, incoming.channelId == channel.id, incoming.url == "ws" + owner.origin.dropFirst(4) + "/livekit" else {
                    try await request("/api/v1/voice/leave", body: ["identity": incoming.identity], using: owner)
                    if generation == voiceID { throw ServiceError("voice_error") }
                    return
                }
                grant = incoming
                state.voice = VoiceState(channel: channel, canPublish: incoming.canPublish)
                start(incoming)
            } catch {
                if generation == voiceID { cancelVoice(); throw error }
            }
        }
    }

    func voiceUpdate(identity: String, connected: Bool, microphone: Bool, deafened: Bool, peers: [VoicePeer]) {
        guard grant?.identity == identity, var voice = state.voice else { return }
        voice.connected = connected
        voice.microphone = microphone
        voice.deafened = deafened
        voice.peers = peers
        state.voice = voice
    }

    func voiceEnded(identity: String, failed: Bool) {
        guard identity == grant?.identity else { return }
        cancelVoice()
        if failed { state.error = "voice_error" }
    }

    func cancelVoice() {
        voiceID = UUID()
        let prior = grant
        grant = nil
        if state.voice != nil { state.voice = nil }
        if let prior, let owner = session {
            Task { try? await request("/api/v1/voice/leave", body: ["identity": prior.identity], using: owner) }
        }
    }

    func setAdmission(_ open: Bool) { state.installation?.openAdmission = open }
    func dismissError() { state.error = nil }

    func signOut() {
        action { [self] in
            guard let owner = session else { return }
            store.removeSecret(key: (owner.staff ? "staff:" : "guest:") + owner.origin)
            let installation = state.installation
            reset()
            state.origin = owner.origin
            state.installation = installation
            if owner.staff {
                do { try await request("/api/auth/sign-out", body: [:], using: owner) }
                catch { state.error = "remote_sign_out_unconfirmed" }
            }
        }
    }

    func switchServer() { if !state.busy { reset() } }

    private func reset() {
        eventLoop?.cancel()
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        cancelVoice()
        session = nil
        token = nil
        clearHistory()
        state = CommunityState(savedServers: state.savedServers, busy: state.busy)
    }
}
