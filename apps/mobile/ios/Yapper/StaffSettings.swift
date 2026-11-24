import SwiftUI
import YapperShared

struct StaffSettings: View {
    @EnvironmentObject var model: MobileModel
    @Environment(\.dismiss) private var dismiss
    @State private var section: String?
    @State private var cursor = ""
    @State private var page: StaffPage?
    @State private var pending: StaffOption?
    @State private var inputs: [String] = []
    @State private var invitation: String?
    @State private var invitationAfterDismissal: String?
    @State private var error: String?

    private func t(_ key: String) -> String { model.text(key) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if let error { Text(t(error)).foregroundStyle(danger) }
                    if let section {
                        sectionContent(section)
                    } else {
                        sections
                    }
                }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
            }.background(appBackground)
                .navigationTitle(t(section ?? "preferences"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button(t("dismiss")) { dismiss() } } }
        }
        .sheet(isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }),
               onDismiss: showInvitation) {
            if let pending {
                NavigationStack {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 12) {
                            ForEach(pending.fields.indices, id: \.self) { index in
                                let field = pending.fields[index]
                                Field(label: t(field.label), value: $inputs[index], protected: field.kind == "password",
                                      keyboard: field.kind == "number" ? .numberPad : .default)
                            }
                            if pending.key == "moveCategory" {
                                Button(t("uncategorized")) { submit(pending, values: [""]) }.frame(minHeight: 44)
                                ForEach(model.state.membership?.categories ?? [], id: \.id) { category in
                                    Button(category.name) { submit(pending, values: [category.id]) }.frame(minHeight: 44)
                                }
                            } else {
                                Primary(title: t("save"), enabled: !model.state.busy) { submit(pending, values: inputs) }
                            }
                        }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .background(appBackground)
                    .navigationTitle(pending.label).navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .cancellationAction) {
                        Button(t("cancel")) { self.pending = nil }.disabled(model.state.busy)
                    } }
                }
                .presentationDetents([.medium, .large])
                .interactiveDismissDisabled(model.state.busy)
            }
        }
        .alert(t("invitationCode"), isPresented: Binding(get: { invitation != nil }, set: { if !$0 { invitation = nil } })) {
            Button(t("copy")) { UIPasteboard.general.string = invitation; invitation = nil }
            Button(t("dismiss"), role: .cancel) { invitation = nil }
        } message: { Text(invitation ?? "") }
    }

    private var sections: some View {
        let names = StaffKt.staffSections(role: model.state.membership?.participant.role ?? "")
        return ForEach(names, id: \.self) { name in
            let title = t(name)
            Button {
                section = name
                page = nil
                error = nil
            } label: {
                HStack {
                    Text(title)
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(muted)
                }.frame(minHeight: 44)
            }
            Rectangle().fill(divider).frame(height: 1)
        }
    }

    @ViewBuilder private func sectionContent(_ section: String) -> some View {
        Button(t("back")) { self.section = nil; cursor = ""; page = nil }
        if let page {
            if let problem = page.error { Text(t(problem)).foregroundStyle(danger) }
            if page.items.isEmpty && page.error == nil { Text(t("noResults")).foregroundStyle(muted) }
            ForEach(Array(page.items.enumerated()), id: \.offset) { entry in
                staffRow(entry.element)
            }
        } else {
            ProgressView()
                .task { if !model.state.busy { load(section) } }
                .onChange(of: model.state.busy) { if !model.state.busy && page == nil { load(section) } }
        }
    }

    @ViewBuilder private func staffRow(_ item: StaffItem) -> some View {
        Rectangle().fill(divider).frame(height: 1)
        Text(item.title).font(.headline)
        if !item.detail.isEmpty { Text(item.detail).font(.caption).foregroundStyle(muted) }
        ForEach(Array(item.actions.enumerated()), id: \.offset) { entry in
            Button { choose(entry.element) } label: {
                Text(entry.element.label).frame(minHeight: 44, alignment: .leading)
            }.disabled(model.state.busy)
        }
    }

    private func load(_ section: String) {
        model.client.staffPage(section: section, cursor: cursor, locale: model.language) { incoming in
            if self.section == section { page = incoming }
        }
    }

    private func choose(_ action: StaffOption) {
        if action.key == "more" {
            cursor = action.subject
            page = nil
        } else {
            inputs = action.fields.map(\.value)
            pending = action
        }
    }

    private func submit(_ option: StaffOption, values: [String]) {
        model.client.applyStaff(option: option, values: values) { result in
            error = result.error
            invitationAfterDismissal = result.value
            pending = nil
            if result.error == nil { page = nil }
        }
    }

    private func showInvitation() {
        invitation = invitationAfterDismissal
        invitationAfterDismissal = nil
    }
}
