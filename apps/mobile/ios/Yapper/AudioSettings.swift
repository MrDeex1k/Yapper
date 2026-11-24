import AVFAudio
import SwiftUI
#if os(iOS)
import YapperShared
#endif

struct AudioSettings: View {
    @EnvironmentObject var model: CommunityModel
    @Environment(\.dismiss) private var dismiss
    @State private var inputs: [AVAudioSessionPortDescription] = []
    @State private var selectedInput = ""
    @State private var selectedOutput = ""
    @State private var routeError: String?
    private let session = AVAudioSession.sharedInstance()

    private func t(_ key: String) -> String { model.text(key) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if !inputs.isEmpty {
                        Picker(t("inputDevice"), selection: Binding(get: { selectedInput }, set: chooseInput)) {
                            Text(t("automatic")).tag("")
                            ForEach(inputs, id: \.uid) { input in Text(input.portName).tag(input.uid) }
                        }
                    }
                    HStack {
                        Text(t("outputDevice")).foregroundStyle(muted)
                        Spacer()
                        Text(selectedOutput).lineLimit(1)
                        Menu {
                            Button(t("automatic")) { chooseOutput(.none) }
                            Button(t("speaker")) { chooseOutput(.speaker) }
                        } label: {
                            Image(systemName: "chevron.up.chevron.down").frame(width: 44, height: 44)
                        }.accessibilityLabel(t("outputDevice"))
                    }
                    if let routeError { Text(t(routeError)).font(.caption).foregroundStyle(danger) }
                    Rectangle().fill(divider).frame(height: 1)
                    Text(t("participants")).font(.headline)
                    let peers = model.state.voice?.peers ?? []
                    if peers.isEmpty { Text(t("noResults")).foregroundStyle(muted) }
                    ForEach(peers, id: \.id) { peer in
                        Text(peer.local ? "\(peer.name) · \(t("you"))" : peer.name)
                            .foregroundStyle(peer.speaking ? accent : foreground)
                            .accessibilityValue(peer.speaking ? t("speaking") : "")
                        if !peer.local {
                            Slider(value: Binding(get: { model.volume(peer.id) },
                                                  set: { model.changeVolume(peer.id, $0) }), in: 0...1) {
                                Text("\(t("volume")) · \(peer.name)")
                            }
                        }
                    }
                }.padding(20)
            }
            .background(appBackground)
            .navigationTitle(t("audioSettings")).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) {
                Button(t("dismiss")) { dismiss() }
            } }
        }
        .presentationDetents([.medium, .large])
        .onAppear(perform: refreshRoutes)
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.routeChangeNotification)) { _ in
            refreshRoutes()
        }
    }

    private func refreshRoutes() {
        inputs = session.availableInputs ?? []
        selectedInput = session.preferredInput?.uid ?? ""
        selectedOutput = session.currentRoute.outputs.first?.portName ?? t("automatic")
    }

    private func chooseInput(_ uid: String) {
        do {
            try session.setPreferredInput(inputs.first { $0.uid == uid })
            refreshRoutes()
            routeError = nil
        } catch { routeError = "audio_device_error" }
    }

    private func chooseOutput(_ route: AVAudioSession.PortOverride) {
        do {
            try session.overrideOutputAudioPort(route)
            refreshRoutes()
            routeError = nil
        } catch { routeError = "audio_device_error" }
    }
}
