import SwiftUI
import LiveKit

@main
struct MacApp: App {
    @StateObject private var model = CommunityModel()
    @StateObject private var audioRoutes = DesktopAudioRoutes()
    @AppStorage("messageTextSize") private var messageSize = 0
    private var textScale: CGFloat {
        guard DesktopTextSettings.sizes.contains(messageSize) else { return 1 }
        return CGFloat(messageSize) / NSFont.preferredFont(forTextStyle: .body).pointSize
    }

    var body: some Scene {
        Window("Yapper", id: "community") {
            Group {
                if let member = model.state.membership { DesktopWorkspace(member: member) }
                else { Entry().frame(maxWidth: .infinity, maxHeight: .infinity).background(appBackground) }
            }
            .yapperFont(.body)
            .environment(\.yapperTextScale, textScale)
            .environmentObject(model)
            .environmentObject(audioRoutes)
            .foregroundStyle(foreground)
            .preferredColorScheme(.dark)
            .tint(accent)
            .frame(minWidth: 620, minHeight: 440)
            .onDisappear { model.leaveVoice() }
        }
        .defaultSize(width: 1100, height: 740)
        .windowResizability(.contentMinSize)

        Settings {
            DesktopTextSettings(model: model, size: $messageSize)
                .yapperFont(.body)
                .environment(\.yapperTextScale, textScale)
        }
    }
}

extension EnvironmentValues {
    @Entry var yapperTextScale: CGFloat = 1
}

struct DesktopTextStyle: ViewModifier {
    @Environment(\.yapperTextScale) private var scale
    let font: Font

    func body(content: Content) -> some View {
        content.font(font.scaled(by: scale))
    }
}

private struct DesktopTextSettings: View {
    static let sizes = [12, 14, 16, 18, 20]

    @ObservedObject var model: CommunityModel
    @Binding var size: Int

    var body: some View {
        Form {
            Picker(model.text("messageTextSize"), selection: $size) {
                Text(model.text("defaultTextSize")).tag(0)
                ForEach(Self.sizes, id: \.self) { size in
                    Text(verbatim: "\(size) pt").tag(size)
                }
            }
        }
        .formStyle(.grouped)
        .frame(width: 440)
        .fixedSize(horizontal: false, vertical: true)
    }
}

struct DesktopWorkspace: View {
    @EnvironmentObject var model: CommunityModel
    let member: Membership
    @State private var columns = NavigationSplitViewVisibility.all
    @State private var staff = false
    @State private var audio = false
    @AppStorage("foregroundPushToTalk") private var pushToTalk = false
    @FocusState private var composerFocused: Bool
    private func t(_ key: String) -> String { model.text(key) }
    private var state: CommunityState { model.state }

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 10) {
                    Image("Brand").resizable().frame(width: 32, height: 32).clipShape(.rect(cornerRadius: 8))
                    Text(state.installation?.name ?? "Yapper").yapperFont(.headline).lineLimit(2)
                    Spacer()
                }.padding(14)
                Divider()
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 3) {
                        catalog(voice: false)
                        catalog(voice: true)
                    }.padding(9)
                }
                if let voice = state.voice { voiceDock(voice) }
                Divider()
                HStack {
                    Text(String(member.participant.nickname.prefix(1)).uppercased()).fontWeight(.semibold)
                        .frame(width: 32, height: 32).background(selectedSurface, in: Circle())
                    VStack(alignment: .leading) {
                        Text(member.participant.nickname).fontWeight(.semibold)
                        Text(t(member.participant.role)).yapperFont(.caption).foregroundStyle(muted)
                    }
                    Spacer()
                    Menu {
                        SettingsLink { Text(t("messageTextSize")) }
                        if member.participant.role != "participant" {
                            Button(t("preferences")) { staff = true }
                        }
                        Button(t("changeServer")) { model.leaveVoice(); model.client.switchServer() }
                        if member.account {
                            Button(t("signOut")) { model.leaveVoice(); model.client.signOut() }
                        }
                    } label: { Image(systemName: "gearshape") }
                    .menuIndicator(.hidden).menuStyle(.borderlessButton).fixedSize()
                    .disabled(state.busy).accessibilityLabel(t("preferences")).help(t("preferences"))
                }.padding(12)
            }.frame(maxWidth: .infinity, maxHeight: .infinity).background(navigation)
                .navigationSplitViewColumnWidth(min: 208, ideal: 252, max: 330)
        } detail: {
            VStack(spacing: 0) {
                if let problem = state.connectionProblem {
                    HStack {
                        Text(t(problem)).foregroundStyle(danger)
                        Button(t("reconnect"), action: model.client.reconnect)
                    }.padding(8)
                }
                Chat(composerFocused: $composerFocused)
            }
            .background(appBackground)
            .navigationTitle(state.channel.map { "# " + $0.name } ?? t("channels"))
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    HStack(spacing: 14) {
                        HStack(spacing: 6) {
                            Circle()
                                .fill(state.connected ? muted : state.connectionProblem == nil ? .secondary : danger)
                                .frame(width: 6, height: 6)
                            Text(t(state.connected ? "connected" : state.connectionProblem == nil ? "connecting" : "disconnected"))
                                .yapperFont(.callout).foregroundStyle(muted)
                        }
                        .accessibilityElement(children: .combine)
                        Divider().frame(height: 16)
                        Menu {
                            Picker(t("language"), selection: Binding(get: { model.language }, set: { language in
                                if language != model.language { model.changeLanguage() }
                            })) {
                                Text("Polski").tag("pl")
                                Text("English").tag("en")
                            }.pickerStyle(.inline)
                        } label: {
                            HStack(spacing: 6) {
                                Text(model.language.uppercased()).yapperFont(.callout.weight(.medium))
                                Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
                            }.padding(.horizontal, 9).frame(height: 26)
                            .contentShape(Capsule())
                        }
                        .menuStyle(.borderlessButton).menuIndicator(.hidden)
                        .frame(minWidth: 46)
                        .contentShape(Capsule())
                        .glassEffect(.regular.interactive(), in: Capsule())
                        .accessibilityLabel(t("language")).accessibilityValue(model.language.uppercased())
                        .help(t("language"))
                    }.padding(.horizontal, 4)
                }
                .sharedBackgroundVisibility(.hidden)
            }
        }
        .sheet(isPresented: $staff) { StaffSettings().yapperFont(.body).frame(minWidth: 490, minHeight: 420) }
        .sheet(isPresented: $audio) { DesktopAudioSettings(pushToTalk: $pushToTalk).yapperFont(.body).frame(minWidth: 410, minHeight: 290) }
        .background(PushToTalkKey(enabled: pushToTalk && state.voice?.connected == true && state.voice?.canPublish == true
                                  && state.voice?.deafened == false && !composerFocused && !audio && !staff,
                                  setHeld: model.setPushToTalkHeld))
    }

    @ViewBuilder private func catalog(voice: Bool) -> some View {
        let channels = member.channels.filter { $0.kind == (voice ? "voice" : "text") && !(voice && $0.archived) }
        if !channels.isEmpty {
            Text(t(voice ? "voiceChannels" : "textChannels")).yapperFont(.caption.bold()).foregroundStyle(muted)
                .padding(.top, 12).padding(.horizontal, 9)
            ForEach([Category(id: "", name: "")] + member.categories, id: \.id) { category in
                let group = channels.filter { $0.categoryId == category.id }
                if !group.isEmpty && !category.name.isEmpty {
                    Text(category.name).yapperFont(.caption).foregroundStyle(muted).padding(.leading, 10).padding(.top, 4)
                }
                ForEach(group, id: \.id) { channel in
                    let active = state.channel?.id == channel.id || state.voice?.channel.id == channel.id
                    Button {
                        composerFocused = false
                        if voice { model.joinVoice(channel) } else { model.client.select(channel: channel) }
                    } label: {
                        HStack {
                            Image(systemName: voice ? "speaker.wave.2" : "number").foregroundStyle(active ? accent : muted)
                            Text(channel.name).lineLimit(1)
                            Spacer()
                            if channel.archived { Image(systemName: "archivebox").accessibilityLabel(t("archived")) }
                        }.padding(.horizontal, 10).frame(minHeight: 34).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).background(active ? selectedSurface : .clear, in: .rect(cornerRadius: 7))
                    .accessibilityAddTraits(active ? .isSelected : [])
                    .disabled(state.busy || state.connectionProblem != nil)
                    if voice, let call = state.voice, call.channel.id == channel.id {
                        ForEach(call.peers, id: \.id) { peer in
                            HStack {
                                Circle().fill(peer.speaking ? accent : muted).frame(width: 6, height: 6)
                                Text(peer.name).lineLimit(1)
                            }.yapperFont(.caption).padding(.leading, 30)
                                .accessibilityValue(peer.speaking ? t("speaking") : "")
                        }
                    }
                }
            }
        }
    }

    private func voiceDock(_ voice: VoiceState) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider()
            Text(voice.channel.name).yapperFont(.headline)
            Text(t(!voice.connected ? "connecting" : voice.microphone ? "micActive" : "micMuted")).yapperFont(.caption).foregroundStyle(muted)
            GlassEffectContainer(spacing: 5) {
                HStack(spacing: 5) {
                    if !pushToTalk {
                        control(voice.microphone ? "mic" : "mic.slash", t(voice.microphone ? "micOn" : "micOff"), model.toggleMic)
                            .disabled(!voice.connected || voice.deafened || !voice.canPublish)
                    }
                    control(voice.deafened ? "speaker.slash" : "headphones", t(voice.deafened ? "undeafen" : "deafen"), model.toggleDeafen)
                    control("slider.horizontal.3", t("audioSettings")) { audio = true }
                    control("phone.down", t("leaveVoice"), model.leaveVoice).foregroundStyle(danger)
                }
            }
        }.padding(12)
    }

    private func control(_ symbol: String, _ title: String, _ action: @escaping () -> Void) -> some View {
        let shape = RoundedRectangle(cornerRadius: 8)
        return Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .medium))
                .frame(maxWidth: .infinity)
                .frame(height: 32)
                .contentShape(shape)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: shape)
        .help(title)
        .accessibilityLabel(title)
    }
}

@MainActor
private final class DesktopAudioRoutes: ObservableObject {
    @Published private(set) var inputs: [AudioDevice] = []
    @Published private(set) var outputs: [AudioDevice] = []
    // nil follows the system route. LiveKit can report an empty active ID while audio is idle.
    @Published private(set) var inputID: String?
    @Published private(set) var outputID: String?

    private var manager: AudioManager { AudioManager.shared }

    func observeDevices() {
        manager.onDeviceUpdate = { [weak self] _ in Task { @MainActor in self?.refresh() } }
        refresh()
    }

    func selectInput(_ id: String?) {
        let device = inputs.first { $0.deviceId == id } ?? manager.defaultInputDevice
        inputID = device.isDefault ? nil : device.deviceId
        manager.inputDevice = device
    }

    func selectOutput(_ id: String?) {
        let device = outputs.first { $0.deviceId == id } ?? manager.defaultOutputDevice
        outputID = device.isDefault ? nil : device.deviceId
        manager.outputDevice = device
    }

    private func refresh() {
        inputs = manager.inputDevices.filter { !$0.isDefault }
        outputs = manager.outputDevices.filter { !$0.isDefault }
        if let inputID, !inputs.contains(where: { $0.deviceId == inputID }) { selectInput(nil) }
        if let outputID, !outputs.contains(where: { $0.deviceId == outputID }) { selectOutput(nil) }
    }
}

private struct DesktopAudioSettings: View {
    @EnvironmentObject var model: CommunityModel
    @Environment(\.dismiss) private var dismiss
    @Binding var pushToTalk: Bool
    @EnvironmentObject private var routes: DesktopAudioRoutes

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(model.text("audioSettings")).yapperFont(.title2.bold())
            if model.state.voice?.canPublish == true {
                Toggle(model.text("pushToTalk"), isOn: $pushToTalk)
                    .toggleStyle(.switch)
                    .onChange(of: pushToTalk) { model.setPushToTalkHeld(false) }
                Text(model.text("holdSpace")).yapperFont(.caption).foregroundStyle(muted)
                Divider()
            }
            devicePicker("inputDevice", devices: routes.inputs,
                         selection: Binding(get: { routes.inputID }, set: routes.selectInput))
            devicePicker("outputDevice", devices: routes.outputs,
                         selection: Binding(get: { routes.outputID }, set: routes.selectOutput))
            Divider()
            ScrollView {
                ForEach(model.state.voice?.peers.filter { !$0.local } ?? [], id: \.id) { peer in
                    Slider(value: Binding(get: { model.volume(peer.id) }, set: { model.changeVolume(peer.id, $0) }),
                           in: 0...1) { Text(peer.name) }.accessibilityLabel(model.text("volume") + " · " + peer.name)
                }
            }
            HStack { Spacer(); Button(model.text("dismiss")) { dismiss() }.keyboardShortcut(.cancelAction) }
        }.padding(20)
            .onAppear(perform: routes.observeDevices)
    }

    private func devicePicker(_ title: String, devices: [AudioDevice], selection: Binding<String?>) -> some View {
        Picker(model.text(title), selection: selection) {
            Text(model.text("systemDefault")).tag(nil as String?)
            ForEach(devices) { device in
                Text(device.name).tag(Optional(device.deviceId))
            }
        }
    }
}
