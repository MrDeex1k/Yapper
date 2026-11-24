#if os(macOS)
import AVFoundation
#else
import AVFAudio
#endif
import Foundation
import LiveKit
import Security
import SwiftUI
#if os(iOS)
import YapperShared
#endif

private final class SessionStore: NSObject, CredentialStore {
    private let preferences = UserDefaults.standard

    private func query(_ key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "\(Bundle.main.bundleIdentifier!).session.v1",
            kSecAttrAccount as String: key,
        ]
    }

    func readSecret(key: String) -> String? {
        var options = query(key)
        options[kSecReturnData as String] = true
        options[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(options as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func saveSecret(key: String, value: String) -> Bool {
        let match = query(key)
        let data = Data(value.utf8)
        var attributes = match
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        if status == errSecDuplicateItem {
            return SecItemUpdate(
                match as CFDictionary, [kSecValueData as String: data] as CFDictionary
            ) == errSecSuccess
        }
        return status == errSecSuccess
    }

    func removeSecret(key: String) { SecItemDelete(query(key) as CFDictionary) }
    func readSetting(key: String) -> String? { preferences.string(forKey: key) }
    func saveSetting(key: String, value: String) { preferences.set(value, forKey: key) }
}

@MainActor
final class CommunityModel: NSObject, ObservableObject, RoomDelegate {
    @Published private(set) var state: CommunityState
    @Published private(set) var language: String
    @Published var localError: String?

    let client: CommunityClient
    private let store: SessionStore
    private var room: Room?
    private var grant: VoiceGrant?
    private var connection: Task<Void, Never>?
    private var deafened = false
    private var established = false
    private var recovering = false
    @Published private var volumes: [String: Double] = [:]
    private let mic = MicrophoneIntent()
    private var micCommand: Task<Void, Never>?

    override init() {
        let settings = SessionStore()
        store = settings
        #if DEBUG
        let debugLoopback = true
        #else
        let debugLoopback = false
        #endif
        let client = CommunityClient(store: settings, debugLoopback: debugLoopback)
        self.client = client
        state = client.state
        language = settings.readSetting(key: "locale")
            ?? (Locale.current.language.languageCode?.identifier == "pl" ? "pl" : "en")
        super.init()
        client.observe { [weak self] state in
            guard let self else { return }
            self.state = state
            if state.connectionProblem != nil && room != nil { closeVoice(failed: false) }
        }
    }

    func text(_ key: String) -> String { appleText(language, key) }

    func changeLanguage() {
        language = language == "pl" ? "en" : "pl"
        store.saveSetting(key: "locale", value: language)
    }

    func joinVoice(_ channel: Channel) {
        guard state.voice?.channel.id != channel.id, !state.busy else { return }
        leaveVoice()
        client.requestVoice(channel: channel) { [weak self] in self?.startVoice($0, recovery: false) }
    }

    private func startVoice(_ grant: VoiceGrant, recovery: Bool) {
        let session = Room(delegate: self)
        room = session
        self.grant = grant
        established = false
        recovering = recovery
        connection = Task { [weak self] in
            do {
                try await session.connect(url: grant.url, token: grant.token)
                guard let self, self.room === session else { return }
                self.established = true
                self.refreshVoice(session)
            } catch {
                if self?.room === session { self?.closeVoice(failed: true) }
            }
        }
    }

    private var canUseMicrophone: Bool {
        state.voice?.connected == true && grant?.canPublish == true && !deafened
    }

    func toggleMic() {
        if canUseMicrophone { setMicrophone(!mic.enabled) }
    }

    #if os(macOS)
    func setPushToTalkHeld(_ held: Bool) {
        if !held || canUseMicrophone { setMicrophone(held) }
    }
    #endif

    private func setMicrophone(_ enabled: Bool) {
        guard let session = room else { return }
        mic.update(enabled: enabled)
        guard micCommand == nil else { return }
        micCommand = Task {
            defer { if room === session { micCommand = nil } }
            while room === session && !Task.isCancelled {
                let revision = mic.revision
                let target = mic.enabled && canUseMicrophone
                if target {
                    #if os(macOS)
                    let allowed = await AVCaptureDevice.requestAccess(for: .audio)
                    #else
                    let allowed = await AVAudioApplication.requestRecordPermission()
                    #endif
                    guard room === session, !Task.isCancelled else { return }
                    guard revision == mic.revision && canUseMicrophone else { continue }
                    if !allowed {
                        mic.update(enabled: false)
                        localError = "microphone_denied"
                        return
                    }
                }
                do {
                    try await session.localParticipant.setMicrophone(enabled: target)
                } catch {
                    guard room === session, !Task.isCancelled else { return }
                    if !target && session.localParticipant.isMicrophoneEnabled() {
                        closeVoice(failed: true)
                        return
                    }
                    if revision == mic.revision {
                        mic.update(enabled: false)
                        localError = "voice_error"
                        refreshVoice(session)
                        return
                    }
                }
                refreshVoice(session)
                if revision == mic.revision { return }
            }
        }
    }

    func toggleDeafen() {
        guard let room else { return }
        deafened.toggle()
        if deafened { setMicrophone(false) }
        applyParticipantVolume(room, target: nil)
        refreshVoice(room)
    }

    func volume(_ id: String) -> Double { volumes[id] ?? 1 }

    func changeVolume(_ id: String, _ level: Double) {
        volumes[id] = level
        if let room { applyParticipantVolume(room, target: id) }
    }

    private func applyParticipantVolume(_ session: Room, target: String?) {
        for participant in session.remoteParticipants.values {
            guard let identity = participant.identity?.stringValue else { continue }
            let id = identity.components(separatedBy: ":").first ?? identity
            if let target, target != id { continue }
            let level = deafened ? 0 : volume(id)
            for track in participant.audioTracks.compactMap({ $0.track as? RemoteAudioTrack }) {
                track.volume = level
            }
        }
    }

    private func refreshVoice(_ session: Room) {
        guard room === session, let grant else { return }
        let speaking = Set(session.activeSpeakers.compactMap { $0.identity?.stringValue })
        let remote = session.remoteParticipants.values.compactMap { participant -> VoicePeer? in
            guard let identity = participant.identity?.stringValue else { return nil }
            let id = identity.components(separatedBy: ":").first ?? identity
            return VoicePeer(id: id, name: participant.name ?? id, speaking: speaking.contains(identity), local: false)
        }.sorted { $0.name < $1.name }
        let peers: [VoicePeer]
        if let me = state.membership?.participant, session.connectionState == .connected {
            peers = [VoicePeer(id: me.id, name: me.nickname, speaking: speaking.contains(grant.identity), local: true)] + remote
        } else {
            peers = remote
        }
        client.voiceUpdate(identity: grant.identity, connected: session.connectionState == .connected,
                           microphone: session.localParticipant.isMicrophoneEnabled(), deafened: deafened, peers: peers)
    }

    func leaveVoice() {
        closeVoice(failed: false)
        client.cancelVoice()
    }

    private func closeVoice(failed: Bool, willRecover: Bool = false) {
        guard let session = room else { return }
        let current = grant
        room = nil
        grant = nil
        connection?.cancel()
        connection = nil
        mic.update(enabled: false)
        micCommand?.cancel()
        micCommand = nil
        deafened = false
        Task { await session.disconnect() }
        if let current, !willRecover { client.voiceEnded(identity: current.identity, failed: failed) }
    }

    nonisolated func room(_ room: Room, didUpdateConnectionState state: ConnectionState, from _: ConnectionState) {
        Task { @MainActor in
            guard self.room === room else { return }
            if state == .reconnecting {
                self.setMicrophone(false)
            }
            self.refreshVoice(room)
        }
    }

    nonisolated func room(_ room: Room, didDisconnectWithError error: LiveKitError?) {
        Task { @MainActor [weak self] in self?.handleUnexpectedDisconnect(room, error: error) }
    }

    private func handleUnexpectedDisconnect(_ session: Room, error: LiveKitError?) {
        guard room === session, let grant else { return }
        let transient = error.map { [.network, .timedOut, .serverShutdown, .stateMismatch].contains($0.type) } ?? false
        let resume = established && !recovering && transient
        closeVoice(failed: true, willRecover: resume)
        if resume {
            client.recoverVoice(identity: grant.identity) { [weak self] in self?.startVoice($0, recovery: true) }
        }
    }

    nonisolated func room(_ room: Room, participantDidConnect participant: RemoteParticipant) {
        Task { @MainActor in self.refreshVoice(room) }
    }

    nonisolated func room(_ room: Room, participantDidDisconnect participant: RemoteParticipant) {
        Task { @MainActor in self.refreshVoice(room) }
    }

    nonisolated func room(_ room: Room, didUpdateSpeakingParticipants participants: [LiveKit.Participant]) {
        Task { @MainActor in self.refreshVoice(room) }
    }

    nonisolated func room(_ room: Room, participant: RemoteParticipant, didSubscribeTrack publication: RemoteTrackPublication) {
        let id = participant.identity?.stringValue.components(separatedBy: ":").first
        Task { @MainActor in
            guard self.room === room else { return }
            self.applyParticipantVolume(room, target: id)
            self.refreshVoice(room)
        }
    }
}
