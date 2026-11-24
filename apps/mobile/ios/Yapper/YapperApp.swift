import SwiftUI
import YapperShared

let appBackground = Color(red: 27/255, green: 27/255, blue: 30/255)
let navigation = Color(red: 17/255, green: 17/255, blue: 19/255)
let panel = Color(red: 34/255, green: 34/255, blue: 37/255)
let selectedSurface = Color(red: 45/255, green: 45/255, blue: 50/255)
let divider = Color(red: 52/255, green: 52/255, blue: 56/255)
let controlLine = Color(red: 93/255, green: 93/255, blue: 101/255)
let foreground = Color(red: 241/255, green: 241/255, blue: 243/255)
let muted = Color(red: 166/255, green: 166/255, blue: 174/255)
let accent = Color(red: 172/255, green: 137/255, blue: 252/255)
let danger = Color(red: 1, green: 180/255, blue: 185/255)

@main
struct YapperApp: App {
    @StateObject private var model = MobileModel()

    var body: some Scene {
        WindowGroup {
            Group {
                if model.state.screen == "chat" { Workspace() }
                else { Entry() }
            }
            .environmentObject(model)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .foregroundStyle(foreground)
            .background(appBackground.ignoresSafeArea())
            .preferredColorScheme(.dark)
            .tint(accent)
        }
    }
}

struct Field: View {
    let label: String
    @Binding var value: String
    var protected = false
    var keyboard: UIKeyboardType = .default
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.subheadline).foregroundStyle(muted)
            Group {
                if protected { SecureField(label, text: $value).textContentType(.password) }
                else { TextField(label, text: $value).keyboardType(keyboard) }
            }
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .focused($focused)
            .padding(.horizontal, 12)
            .frame(minHeight: 48)
            .background(navigation, in: .rect(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(focused ? accent : controlLine))
        }
    }
}

struct Primary: View {
    let title: String
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title).font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 48)
                .foregroundStyle(navigation)
                .background(foreground.opacity(enabled ? 1 : 0.38), in: .rect(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }
}

struct LanguageButton: View {
    @EnvironmentObject var model: MobileModel
    var body: some View {
        Button(action: model.changeLanguage) {
            Text(model.language.uppercased()).font(.subheadline.weight(.medium))
                .frame(minWidth: 44, minHeight: 44)
        }
        .foregroundStyle(muted).buttonStyle(.plain)
        .accessibilityLabel(model.text("language"))
    }
}

struct Entry: View {
    @EnvironmentObject var model: MobileModel
    @State private var address = ""
    @State private var nickname = ""
    @State private var invitation = ""
    @State private var username = ""
    @State private var password = ""
    @State private var staff = false

    private var state: MobileState { model.state }
    private func t(_ key: String) -> String { model.text(key) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 13) {
                HStack(spacing: 9) {
                    Image("Brand").resizable().scaledToFill().frame(width: 34, height: 34)
                        .clipShape(.rect(cornerRadius: 8)).accessibilityHidden(true)
                    Text("Yapper").font(.title3.bold())
                    Spacer()
                    LanguageButton()
                }.frame(minHeight: 62)
                Rectangle().fill(divider).frame(height: 1)
                Text(t(state.installation == nil ? "chooseServer" : staff ? "staffSignIn" : "join"))
                    .font(.system(.largeTitle, design: .default).weight(.bold))
                    .accessibilityAddTraits(.isHeader)
                    .padding(.top, 17)
                if let installation = state.installation { join(installation) }
                else { chooser }
                if let error = state.error { Text(t(error)).font(.subheadline).foregroundStyle(danger) }
                if state.busy { ProgressView().frame(maxWidth: .infinity) }
            }
            .padding(.horizontal, 22).padding(.bottom, 20)
            .frame(maxWidth: 540).frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .onChange(of: state.origin) {
            invitation = ""; password = ""; username = ""; nickname = ""; staff = false
        }
    }

    @ViewBuilder private var chooser: some View {
        Text(t("serverAddressHint")).font(.subheadline).foregroundStyle(muted)
        if !state.savedServers.isEmpty {
            Text(t("savedServers")).font(.subheadline.weight(.semibold)).foregroundStyle(muted)
                .padding(.top, 5).accessibilityAddTraits(.isHeader)
            ForEach(state.savedServers, id: \.origin) { server in
                Button { model.client.connect(address: server.origin) } label: {
                    serverRow(name: server.name, address: server.origin, button: true)
                }
                .buttonStyle(.plain).disabled(state.busy)
            }
        }
        Field(label: t("serverAddress"), value: $address, keyboard: .URL)
        Primary(title: t("connectServer"), enabled: !address.isEmpty && !state.busy) {
            model.client.connect(address: address)
        }
    }

    @ViewBuilder private func join(_ installation: Installation) -> some View {
        serverRow(name: installation.name, address: state.origin, button: false)
        if staff {
            Field(label: t("username"), value: $username)
            Field(label: t("password"), value: $password, protected: true)
        } else {
            Field(label: t("nickname"), value: $nickname)
            if !installation.openAdmission { Field(label: t("invitation"), value: $invitation) }
        }
        Primary(title: t(staff ? "signIn" : "joinAction"), enabled: !state.busy && (
            staff ? !username.isEmpty && !password.isEmpty :
                !nickname.isEmpty && (installation.openAdmission || !invitation.isEmpty)
        )) {
            if staff { model.client.signIn(username: username, password: password) }
            else { model.client.join(nickname: nickname, invitation: invitation) }
        }
        HStack {
            Button(t("back"), action: model.client.switchServer)
            Spacer()
            Button(t(staff ? "joinAction" : "staffSignIn")) { staff.toggle() }
        }
        .font(.subheadline.weight(.semibold)).frame(minHeight: 44).disabled(state.busy)
    }

    private func serverRow(name: String, address: String, button: Bool) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "server.rack").foregroundStyle(accent)
            VStack(alignment: .leading, spacing: 3) {
                if !button { Text(t("currentServer")).font(.caption).foregroundStyle(muted) }
                Text(name).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text(address).font(.caption).foregroundStyle(muted).lineLimit(1)
            }.frame(maxWidth: .infinity, alignment: .leading)
            if button { Image(systemName: "arrow.right").foregroundStyle(accent) }
        }
        .padding(12).background(panel, in: .rect(cornerRadius: 9))
        .overlay(RoundedRectangle(cornerRadius: 9).stroke(divider))
    }
}
