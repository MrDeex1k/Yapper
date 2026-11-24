import Foundation

struct StaffField {
    let label: String
    var value = ""
    var kind = "text"
}
struct StaffOption {
    let label, key: String
    var subject = ""
    var fields: [StaffField] = []
}
struct StaffItem { let title, detail: String; let actions: [StaffOption] }
struct StaffPage { let items: [StaffItem]; var error: String? }
struct StaffResult { var value: String?; var error: String? }

func staffSectionsForRole(_ role: String) -> [String] {
    switch role {
    case "owner": return ["admissionSettings", "manageChannels", "participants", "moderationLog"]
    case "moderator": return ["participants", "moderationLog"]
    default: return []
    }
}

extension CommunityClient {
    func staffPage(section: String, cursor: String, locale: String, completion: @escaping (StaffPage) -> Void) {
        guard let member = state.membership, staffSectionsForRole(member.participant.role).contains(section) else {
            completion(StaffPage(items: [], error: "access_denied")); return
        }
        func t(_ key: String) -> String { appleText(locale, key) }
        func option(_ label: String, _ key: String, _ id: String = "", _ fields: [StaffField] = []) -> StaffOption {
            StaffOption(label: t(label), key: key, subject: id, fields: fields)
        }
        if section == "manageChannels" {
            var items = [StaffItem(title: t(section), detail: "", actions: [
                option("newCategory", "newCategory", "", [StaffField(label: "categoryName")]),
                option("newChannel", "newText", "", [StaffField(label: "channelName")]),
                option("voiceChannels", "newVoice", "", [StaffField(label: "channelName")])])]
            items += member.categories.map { group in
                StaffItem(title: group.name, detail: t("category"), actions: [
                    option("edit", "saveCategory", group.id, [StaffField(label: "categoryName", value: group.name)]),
                    option("moveUp", "categoryUp", group.id), option("moveDown", "categoryDown", group.id)])
            }
            items += member.channels.map { channel in
                var actions = [option("edit", "saveChannel", channel.id, [StaffField(label: "channelName", value: channel.name)]),
                               option("moveCategory", "moveCategory", channel.id), option("moveUp", "channelUp", channel.id),
                               option("moveDown", "channelDown", channel.id)]
                if !channel.archived { actions.append(option("archiveChannel", "archiveChannel", channel.id)) }
                let detail = [t(channel.kind == "text" ? "textChannels" : "voiceChannels"),
                              member.categories.first { $0.id == channel.categoryId }?.name, channel.archived ? t("archived") : nil]
                    .compactMap { $0 }.joined(separator: " · ")
                return StaffItem(title: channel.name, detail: detail, actions: actions)
            }
            completion(StaffPage(items: items))
            return
        }
        action { [self] in
            do {
                var items: [StaffItem] = []
                switch section {
                case "admissionSettings":
                    struct Invite: Decodable { let id, createdAt: String; let revoked: Bool }
                    struct Catalog: Decodable { let invitations: [Invite] }
                    let data = try await request("/api/v1/invitations")
                    let open = state.installation?.openAdmission == true
                    items.append(StaffItem(title: t(open ? "openAdmission" : "invitationOnly"), detail: "", actions: [
                        option(open ? "closeAdmission" : "openAdmissionAction", open ? "close" : "open"),
                        option("inviteFriend", "invite", "", [StaffField(label: "invitationHours", value: "24", kind: "number"),
                                                             StaffField(label: "invitationUses", value: "1", kind: "number")]),
                        option("messageRetention", "retention", "", [StaffField(label: "retentionDays", kind: "number")]),
                        option("newModerator", "provisionModerator", "", [StaffField(label: "username"), StaffField(label: "password", kind: "password")])]))
                    items += try JSONDecoder().decode(Catalog.self, from: data).invitations.map {
                        StaffItem(title: t("invitation"), detail: $0.createdAt, actions: $0.revoked ? [] : [option("revoke", "revokeInvite", $0.id)])
                    }
                case "participants":
                    struct Person: Decodable { let id, nickname, role: String; let banned, canBlockIp, micMuted, registered: Bool }
                    struct Page: Decodable { let members: [Person]; let next: String? }
                    let data = try await request("/api/v1/participants" + (cursor.isEmpty ? "" : "?after=" + pathSegment(cursor)))
                    let page = try JSONDecoder().decode(Page.self, from: data)
                    for person in page.members {
                        var actions: [StaffOption] = []
                        let owner = member.participant.role == "owner"
                        if person.id != member.participant.id && person.role != "owner" && (owner || person.role == "participant") {
                            actions = [option("kick", "mod:kick", person.id),
                                       option(person.banned ? "unban" : "ban", person.banned ? "mod:unban" : "mod:ban", person.id),
                                       option(person.micMuted ? "unmuteMember" : "muteMember", person.micMuted ? "mod:unmute" : "mod:mute", person.id)]
                            if person.canBlockIp && !person.banned { actions.append(option("banIp", "mod:banIp", person.id)) }
                            if owner && person.registered {
                                actions.append(option(person.role == "moderator" ? "revokeModerator" : "grantModerator",
                                                      person.role == "moderator" ? "mod:revoke_moderator" : "mod:grant_moderator", person.id))
                            }
                        }
                        items.append(StaffItem(title: person.nickname, detail: t(person.role), actions: actions))
                    }
                    if let next = page.next, !next.isEmpty {
                        items.append(StaffItem(title: t(section), detail: "", actions: [option("more", "more", next)]))
                    }
                default:
                    struct Entry: Decodable { let action, createdAt: String }
                    struct Audit: Decodable { let events: [Entry] }
                    let data = try await request("/api/v1/moderation/audit")
                    items = try JSONDecoder().decode(Audit.self, from: data).events.map {
                        StaffItem(title: t("audit:" + $0.action), detail: $0.createdAt, actions: [])
                    }
                }
                completion(StaffPage(items: items))
            } catch { completion(StaffPage(items: [], error: (error as? ServiceError)?.code ?? "network_error")) }
        }
    }

    func applyStaff(option: StaffOption, values: [String], completion: @escaping (StaffResult) -> Void) {
        guard state.connectionProblem == nil, state.membership?.participant.role != "participant" else {
            completion(StaffResult(error: "access_denied")); return
        }
        let id = pathSegment(option.subject)
        let value = values.first?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        var method = "POST"
        let path: String
        var body: [String: Any] = [:]
        switch option.key {
        case "open", "close": path = "admission"; body["openAdmission"] = option.key == "open"
        case "invite":
            guard let hours = Int(value), let uses = values.dropFirst().first.flatMap(Int.init) else { completion(StaffResult(error: "invalid_request")); return }
            path = "invitations"; body = ["expiresInHours": hours, "maxUses": uses]
        case "revokeInvite": path = "invitations/\(id)/revoke"
        case "retention":
            guard let days = Int(value), (0...36500).contains(days) else { completion(StaffResult(error: "invalid_request")); return }
            path = "message-retention"; body["days"] = days
        case "provisionModerator": path = "moderators"; body = ["username": value, "password": values.dropFirst().first ?? ""]
        case "newCategory": path = "categories"; body["name"] = value
        case "saveCategory": path = "categories/" + id; body["name"] = value
        case "categoryUp", "categoryDown": path = "categories/\(id)/move"; body["direction"] = option.key == "categoryUp" ? -1 : 1
        case "newText", "newVoice": path = "channels"; body = ["name": value, "kind": option.key == "newText" ? "text" : "voice"]
        case "saveChannel", "moveCategory": method = "PATCH"; path = "channels/" + id; body[option.key == "moveCategory" ? "categoryId" : "name"] = value
        case "channelUp", "channelDown": path = "channels/\(id)/move"; body["direction"] = option.key == "channelUp" ? -1 : 1
        case "archiveChannel": path = "channels/\(id)/archive"
        default:
            guard option.key.hasPrefix("mod:") else { completion(StaffResult(error: "invalid_request")); return }
            path = "participants/\(id)/moderate"
            let command = String(option.key.dropFirst(4))
            body["action"] = command == "banIp" ? "ban" : command
            if command == "banIp" { body["blockIp"] = true }
        }
        action { [self] in
            do {
                let data = try await request("/api/v1/" + path, body: body, method: method)
                struct Invitation: Decodable { let token: String }
                let token = option.key == "invite" ? try JSONDecoder().decode(Invitation.self, from: data).token : nil
                if path == "admission" { setAdmission(option.key == "open") }
                completion(StaffResult(value: token))
            } catch { completion(StaffResult(error: (error as? ServiceError)?.code ?? "network_error")); return }
            try await refreshMembership()
        }
    }
}
