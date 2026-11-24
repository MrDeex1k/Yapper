import SwiftUI
#if os(iOS)
import YapperShared
#endif

private struct SymbolButton: View {
    let symbol: String
    let title: String
    var color = muted
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 17, weight: .medium))
                #if os(macOS)
                .frame(width: 28, height: 28)
                #else
                .frame(width: 44, height: 44)
                #endif
                .contentShape(Rectangle())
        }
        .foregroundStyle(color.opacity(enabled ? 1 : 0.4))
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(title)
        .help(title)
    }
}

#if os(iOS)
struct Workspace: View {
    @EnvironmentObject var model: CommunityModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drawer = false
    @State private var staffPanel = false
    @State private var audioPanel = false
    @FocusState private var composerFocused: Bool

    private var state: CommunityState { model.state }
    private func t(_ key: String) -> String { model.text(key) }

    var body: some View {
        GeometryReader { window in
            let expanded = window.size.width >= 760
            let sidebarWidth = min(320, max(240, window.size.width * 0.24))
            HStack(spacing: 0) {
                if expanded, let member = state.membership {
                    channels(member)
                        .frame(width: sidebarWidth)
                    Divider().overlay(divider)
                }
                VStack(spacing: 0) {
                    if expanded {
                        channelTitle(expanded: true)
                    } else {
                        Button {
                            composerFocused = false
                            withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.16)) { drawer.toggle() }
                        } label: {
                            channelTitle(expanded: false)
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint(t("channels"))
                    }
                    if let problem = state.connectionProblem {
                        HStack {
                            Text(t(problem)).yapperFont(.caption).foregroundStyle(danger)
                            Spacer()
                            Button(t("reconnect"), action: model.client.reconnect).disabled(state.busy)
                                .yapperFont(.caption.weight(.semibold)).frame(minHeight: 44)
                        }.padding(.horizontal, 16)
                    } else if !state.connected {
                        Text(t("connecting")).yapperFont(.caption).foregroundStyle(muted)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16).padding(.bottom, 5)
                    }
                    Rectangle().fill(divider).frame(height: 1)
                    if !expanded, drawer, let member = state.membership {
                        channels(member)
                            .frame(maxHeight: min(292, window.size.height * 0.46))
                        Rectangle().fill(divider).frame(height: 1)
                    }
                    Chat(composerFocused: $composerFocused)
                    if let voice = state.voice { voiceDock(voice) }
                }
            }
            .onChange(of: expanded) {
                if expanded { drawer = false }
            }
        }
        .sheet(isPresented: $staffPanel) { StaffSettings().environmentObject(model) }
        .sheet(isPresented: $audioPanel) { AudioSettings().environmentObject(model) }
    }

    private func channelTitle(expanded: Bool) -> some View {
        HStack(spacing: 9) {
            if !expanded {
                Image(systemName: "sidebar.left").foregroundStyle(muted).accessibilityHidden(true)
            }
            if state.channel != nil {
                Image(systemName: "number").yapperFont(.subheadline).foregroundStyle(muted).accessibilityHidden(true)
            }
            Text(state.channel?.name ?? t("channels"))
                .yapperFont(.subheadline.weight(.bold)).lineLimit(1)
                .accessibilityAddTraits(expanded ? .isHeader : [])
            Spacer()
            if !expanded {
                Image(systemName: "chevron.down").font(.system(size: 12, weight: .semibold))
                    .rotationEffect(.degrees(drawer ? 180 : 0)).foregroundStyle(muted).accessibilityHidden(true)
            }
        }
        .frame(minHeight: expanded ? 52 : 48)
        .padding(.horizontal, 16)
        .contentShape(Rectangle())
    }

    private func channels(_ membership: Membership) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 2) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(state.installation?.name ?? "").yapperFont(.subheadline.bold()).lineLimit(1)
                        Text(membership.participant.nickname).yapperFont(.caption).foregroundStyle(muted)
                    }
                    Spacer()
                    LanguageButton()
                    Menu {
                        if ["owner", "moderator"].contains(membership.participant.role) {
                            Button(t("preferences")) { staffPanel = true }
                        }
                        Button(t("changeServer")) {
                            model.leaveVoice()
                            model.client.switchServer()
                        }
                        if membership.account {
                            Button(t("signOut")) {
                                model.leaveVoice()
                                model.client.signOut()
                            }
                        }
                    } label: {
                        Image(systemName: "slider.horizontal.3").frame(width: 44, height: 44)
                            .foregroundStyle(muted)
                    }.accessibilityLabel(t("preferences"))
                }.padding(.leading, 10)
                ForEach(membership.channelGroups, id: \.category.id) { group in
                    if !group.category.name.isEmpty {
                        Text(group.category.name).yapperFont(.subheadline.weight(.semibold)).foregroundStyle(muted)
                            .padding(.leading, 10).padding(.top, 8)
                    }
                    channelRows(group.text, voice: false)
                    channelRows(group.voice, voice: true)
                }
            }
            .padding(.horizontal, 8).padding(.bottom, 8)
        }
        .background(navigation)
    }

    @ViewBuilder private func channelRows(_ channels: [Channel], voice: Bool) -> some View {
        if !channels.isEmpty {
            Text(t(voice ? "voiceChannels" : "textChannels")).yapperFont(.caption.weight(.semibold))
                .foregroundStyle(muted).padding(.leading, 10).padding(.top, 4)
            ForEach(channels, id: \.id) { channel in
                let active = channel.id == state.channel?.id || channel.id == state.voice?.channel.id
                Button {
                    if voice { model.joinVoice(channel) }
                    else { model.client.select(channel: channel) }
                    composerFocused = false
                    if drawer {
                        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.15)) { drawer = false }
                    }
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: voice ? "speaker.wave.2" : "number")
                            .yapperFont(.subheadline).foregroundStyle(active ? accent : muted).accessibilityHidden(true)
                        Text(channel.name).foregroundStyle(active ? foreground : muted).lineLimit(1)
                        Spacer()
                        if channel.archived { Text(t("archived")).yapperFont(.caption2).foregroundStyle(muted) }
                    }
                    .padding(.horizontal, 10).frame(minHeight: 44)
                    .background(active ? selectedSurface : navigation, in: .rect(cornerRadius: 7))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(state.busy || state.connectionProblem != nil)
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
    }

    private func voiceDock(_ voice: VoiceState) -> some View {
        VStack(spacing: 0) {
            Rectangle().fill(divider).frame(height: 1)
            HStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(voice.channel.name).yapperFont(.subheadline.weight(.semibold)).lineLimit(1)
                    Text(t(!voice.connected ? "connecting" : voice.microphone ? "micActive" : "micMuted"))
                        .yapperFont(.caption).foregroundStyle(muted).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                SymbolButton(symbol: voice.microphone ? "mic" : "mic.slash",
                             title: t(voice.microphone ? "micOn" : "micOff"),
                             color: voice.microphone ? accent : foreground,
                             enabled: voice.connected && voice.canPublish && !voice.deafened, action: model.toggleMic)
                SymbolButton(symbol: "headphones", title: t(voice.deafened ? "undeafen" : "deafen"),
                             color: voice.deafened ? accent : muted, action: model.toggleDeafen)
                SymbolButton(symbol: "slider.horizontal.3", title: t("audioSettings")) { audioPanel = true }
                SymbolButton(symbol: "phone.down", title: t("leaveVoice"), color: danger, action: model.leaveVoice)
            }
            .padding(.horizontal, 12).padding(.vertical, 3)
        }.background(navigation)
    }
}

#endif

struct Chat: View {
    @EnvironmentObject var model: CommunityModel
    @State private var draft = ""
    @State private var editing: Message?
    @State private var confirming: Message?
    @State private var initialScroll = true
    @State private var isAtBottom = true
    @State private var editBody = ""
    var composerFocused: FocusState<Bool>.Binding

    private var state: CommunityState { model.state }
    private var actionsAllowed: Bool { !state.busy && state.connectionProblem == nil }
    private func t(_ key: String) -> String { model.text(key) }

    var body: some View {
        VStack(spacing: 0) {
            if let channel = state.channel, let messages = state.messages, !messages.isEmpty || state.hasOlder {
                history(messages, channel: channel)
            } else {
                empty
            }
            if let error = model.localError ?? state.error {
                HStack {
                    Text(t(error)).yapperFont(.caption).foregroundStyle(danger)
                    Spacer()
                    Button(t("dismiss")) { model.localError = nil; model.client.dismissError() }
                        .yapperFont(.caption.weight(.semibold)).frame(minHeight: 44)
                }.padding(.horizontal, 14)
            }
            if chatMessageLength(draft) > 2000 {
                Text(t("invalid_message")).yapperFont(.caption).foregroundStyle(danger)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 14)
            }
            if state.channel?.archived == true {
                Text(t("archivedNotice")).yapperFont(.caption).foregroundStyle(muted).padding(14)
            } else if state.channel != nil {
                Rectangle().fill(divider).frame(height: 1)
                HStack(spacing: 4) {
                    TextField(t("messagePlaceholder"), text: $draft,
                              prompt: Text(t("messagePlaceholder")).foregroundStyle(muted), axis: .vertical)
                        #if os(macOS)
                        .textFieldStyle(.plain)
                        .onSubmit(sendDraft)
                        #endif
                        .lineLimit(1...4).padding(10).frame(minHeight: 44)
                        .focused(composerFocused)
                        .background(panel, in: .rect(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(composerFocused.wrappedValue ? accent : controlLine))
                        .disabled(state.connectionProblem != nil)
                    SymbolButton(symbol: "arrow.right", title: t("send"), color: accent,
                                 enabled: validChatMessage(draft) && actionsAllowed, action: sendDraft)
                }.padding(.horizontal, 10).padding(.vertical, 8)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onChange(of: state.channel?.id) {
            draft = ""; editing = nil; confirming = nil; initialScroll = true
        }
        .sheet(isPresented: Binding(get: { editing != nil }, set: { if !$0 { editing = nil } })) {
            NavigationStack {
                VStack(spacing: 14) {
                    TextEditor(text: $editBody).frame(minHeight: 120, maxHeight: 200)
                        .padding(8).scrollContentBackground(.hidden)
                        .background(panel, in: .rect(cornerRadius: 9))
                        .overlay(RoundedRectangle(cornerRadius: 9).stroke(controlLine))
                    if chatMessageLength(editBody) > 2000 {
                        Text(t("invalid_message")).foregroundStyle(danger)
                    } else if let error = state.error {
                        Text(t(error)).foregroundStyle(danger)
                    }
                    Primary(title: t("save"), enabled: actionsAllowed && validChatMessage(editBody)) {
                        guard let editing else { return }
                        model.client.edit(message: editing, body: editBody) { saved in
                            if appleBool(saved) { self.editing = nil }
                        }
                    }
                    Spacer()
                }.padding(16).background(appBackground)
                    .navigationTitle(t("editMessage")).inlineAppleTitle()
                    .toolbar { ToolbarItem(placement: .cancellationAction) {
                        Button(t("cancel")) { editing = nil }
                    } }
            }.presentationDetents([.medium, .large])
        }
        .confirmationDialog(t("deleteMessage"),
                            isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
                            titleVisibility: .visible, presenting: confirming) { target in
            Button(t("deleteMessage"), role: .destructive) { model.client.delete(message: target) }
                .disabled(!actionsAllowed)
            Button(t("cancel"), role: .cancel) {}
        } message: { _ in Text(t("confirmMessageDelete")) }
    }

    private func sendDraft() {
        guard actionsAllowed, validChatMessage(draft) else { return }
        let sent = draft
        model.client.send(body: sent) { success in if appleBool(success) && draft == sent { draft = "" } }
    }

    private var empty: some View {
        VStack(spacing: 8) {
            if state.channel != nil && state.messages != nil {
                Image(systemName: "number").yapperFont(.title2)
                    .foregroundStyle(muted).frame(width: 54, height: 54)
                    .background(selectedSurface, in: .rect(cornerRadius: 11))
                    .accessibilityHidden(true).padding(.bottom, 4)
            }
            Text(t(state.channel == nil ? "noChannels" : state.messages == nil ? "loadingHistory" : "emptyChat"))
                .yapperFont(.headline)
            if state.channel != nil && state.messages != nil {
                Text(t("emptyChatDescription")).yapperFont(.caption).foregroundStyle(muted)
            }
        }.multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, maxHeight: .infinity).padding(.horizontal, 20)
    }

    private func history(_ messages: [Message], channel: Channel) -> some View {
        GeometryReader { viewport in
            ScrollViewReader { reader in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 9) {
                        if state.hasOlder {
                            Button(t("loadOlder"), action: model.client.loadOlder).frame(maxWidth: .infinity, minHeight: 44)
                                .disabled(!actionsAllowed)
                        }
                        ForEach(messages, id: \.id) { message in
                            messageRow(message, channel: channel)
                        }
                        Color.clear.frame(height: 1).id("latest")
                            .onAppear { isAtBottom = true }
                            .onDisappear { isAtBottom = false }
                    }.padding(.horizontal, 14).padding(.vertical, 10)
                        .frame(maxWidth: .infinity, minHeight: viewport.size.height, alignment: .bottomLeading)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: messages.last?.id, initial: true) {
                    if initialScroll || isAtBottom {
                        reader.scrollTo("latest", anchor: .bottom)
                        initialScroll = false
                    }
                }
            }
        }
    }

    private func messageRow(_ message: Message, channel: Channel) -> some View {
        let participant = state.membership?.participant
        let own = participant?.id == message.authorId
        let mayDelete = own || ["owner", "moderator"].contains(participant?.role ?? "")
        return HStack(alignment: .top, spacing: 10) {
            Text(String(message.nickname.prefix(1)).uppercased()).yapperFont(.subheadline.weight(.semibold))
                .frame(width: 34, height: 34).background(selectedSurface, in: .circle)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(message.nickname).yapperFont(.subheadline.weight(.bold)).lineLimit(1)
                    if own && !channel.archived {
                        SymbolButton(symbol: "pencil", title: t("editMessage"), enabled: actionsAllowed) {
                            model.client.dismissError()
                            editBody = message.body
                            editing = message
                        }
                    }
                    if mayDelete {
                        SymbolButton(symbol: "trash", title: t("deleteMessage"), enabled: actionsAllowed) { confirming = message }
                    }
                    if let sent = messageDate(message.createdAt) {
                        Text(sent.formatted(.dateTime.hour().minute().locale(Locale(identifier: model.language))))
                            .yapperFont(.caption2).foregroundStyle(muted).lineLimit(1)
                    }
                    if message.editedAt != nil { Text(t("messageEdited")).yapperFont(.caption2).foregroundStyle(muted) }
                }
                Text(message.body).yapperFont(.body).textSelection(.enabled)
            }.frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func messageDate(_ timestamp: String) -> Date? {
        (try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(timestamp))
            ?? (try? Date.ISO8601FormatStyle().parse(timestamp))
    }
}
