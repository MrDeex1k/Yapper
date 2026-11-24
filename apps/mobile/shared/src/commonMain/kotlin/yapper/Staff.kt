package yapper

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

data class StaffField(val label: String, val value: String = "", val kind: String = "text")
data class StaffOption(val label: String, val key: String, val subject: String = "", val fields: List<StaffField> = emptyList())
data class StaffItem(val title: String, val detail: String, val actions: List<StaffOption>)
data class StaffPage(val items: List<StaffItem>, val error: String? = null)
data class StaffResult(val value: String? = null, val error: String? = null)

fun staffSections(role: String): List<String> = when (role) {
    "owner" -> listOf("admissionSettings", "manageChannels", "participants", "moderationLog")
    "moderator" -> listOf("participants", "moderationLog")
    else -> emptyList()
}

private fun JsonObject.text(key: String) = get(key)?.jsonPrimitive?.contentOrNull.orEmpty()
private fun JsonObject.flag(key: String) = get(key)?.jsonPrimitive?.booleanOrNull == true

fun MobileClient.staffPage(section: String, cursor: String, locale: String, completion: (StaffPage) -> Unit) {
    if (section !in staffSections(state.membership?.participant?.role.orEmpty())) return
    fun t(key: String) = mobileText(locale, key)
    val member = state.membership ?: return
    val owner = member.participant.role == "owner"
    if (section == "manageChannels") {
        val items = buildList {
            add(StaffItem(t("manageChannels"), "", listOf(
                StaffOption(t("newCategory"), "newCategory", fields = listOf(StaffField("categoryName"))),
                StaffOption(t("newChannel"), "newText", fields = listOf(StaffField("channelName"))),
                StaffOption(t("voiceChannels"), "newVoice", fields = listOf(StaffField("channelName"))),
            )))
            member.categories.forEach { group ->
                add(StaffItem(group.name, t("category"), listOf(
                    StaffOption(t("edit"), "saveCategory", group.id, listOf(StaffField("categoryName", group.name))),
                    StaffOption(t("moveUp"), "categoryUp", group.id),
                    StaffOption(t("moveDown"), "categoryDown", group.id),
                )))
            }
            member.channels.forEach { channel ->
                val group = member.categories.find { it.id == channel.categoryId }?.name
                add(StaffItem(channel.name, listOfNotNull(
                    t(if (channel.kind == "voice") "voiceChannels" else "textChannels"), group,
                    t("archived").takeIf { channel.archived },
                ).joinToString(" · "), buildList {
                    add(StaffOption(t("edit"), "saveChannel", channel.id, listOf(StaffField("channelName", channel.name))))
                    add(StaffOption(t("moveCategory"), "moveCategory", channel.id))
                    add(StaffOption(t("moveUp"), "channelUp", channel.id))
                    add(StaffOption(t("moveDown"), "channelDown", channel.id))
                    if (!channel.archived) add(StaffOption(t("archiveChannel"), "archiveChannel", channel.id))
                }))
            }
        }
        completion(StaffPage(items))
        return
    }
    val path = when (section) {
        "admissionSettings" -> "/api/v1/invitations"
        "participants" -> "/api/v1/participants" + if (cursor.isEmpty()) "" else "?after=$cursor"
        "moderationLog" -> "/api/v1/moderation/audit"
        else -> return
    }
    staffRequest(path, null, "GET") { raw, error ->
        if (raw == null) {
            completion(StaffPage(emptyList(), error))
            return@staffRequest
        }
        val data = wire.parseToJsonElement(raw).jsonObject
        val items = when (section) {
            "admissionSettings" -> buildList {
                val open = state.installation?.openAdmission == true
                add(StaffItem(t(if (open) "openAdmission" else "invitationOnly"), "", listOf(
                    StaffOption(t(if (open) "closeAdmission" else "openAdmissionAction"), if (open) "close" else "open"),
                    StaffOption(t("inviteFriend"), "invite", fields = listOf(
                        StaffField("invitationHours", "24", "number"), StaffField("invitationUses", "1", "number"),
                    )),
                    StaffOption(t("messageRetention"), "retention", fields = listOf(StaffField("retentionDays", "", "number"))),
                    StaffOption(t("newModerator"), "provisionModerator", fields = listOf(
                        StaffField("username"), StaffField("password", kind = "password"),
                    )),
                )))
                data["invitations"]?.jsonArray.orEmpty().forEach { value ->
                    val row = value.jsonObject
                    add(StaffItem(t("invitation"), row.text("createdAt"), if (row.flag("revoked"))
                        emptyList() else listOf(StaffOption(t("revoke"), "revokeInvite", row.text("id")))))
                }
            }
            "participants" -> buildList {
                data["members"]?.jsonArray.orEmpty().forEach { value ->
                    val row = value.jsonObject
                    val id = row.text("id")
                    val role = row.text("role")
                    val mayAct = id != member.participant.id && role != "owner" &&
                        (owner || role == "participant")
                    add(StaffItem(row.text("nickname"), t(role), if (!mayAct) emptyList() else buildList {
                        add(StaffOption(t("kick"), "mod:kick", id))
                        add(StaffOption(t(if (row.flag("banned")) "unban" else "ban"),
                            if (row.flag("banned")) "mod:unban" else "mod:ban", id))
                        if (row.flag("canBlockIp") && !row.flag("banned")) add(StaffOption(t("banIp"), "mod:banIp", id))
                        add(StaffOption(t(if (row.flag("micMuted")) "unmuteMember" else "muteMember"),
                            if (row.flag("micMuted")) "mod:unmute" else "mod:mute", id))
                        if (owner && row.flag("registered")) add(StaffOption(
                            t(if (role == "moderator") "revokeModerator" else "grantModerator"),
                            if (role == "moderator") "mod:revoke_moderator" else "mod:grant_moderator", id,
                        ))
                    }))
                }
                val next = data.text("next")
                if (next.isNotEmpty()) add(StaffItem(t("participants"), "", listOf(StaffOption(t("more"), "more", next))))
            }
            else -> data["events"]?.jsonArray.orEmpty().map { row ->
                val event = row.jsonObject
                StaffItem(t("audit:" + event.text("action")), event.text("createdAt"), emptyList())
            }
        }
        completion(StaffPage(items))
    }
}

fun MobileClient.applyStaff(option: StaffOption, values: List<String>, completion: (StaffResult) -> Unit) {
    fun value(index: Int) = values.getOrNull(index)?.trim().orEmpty()
    val id = option.subject
    var method = "POST"
    val body = buildJsonObject {
        when (option.key) {
            "open", "close" -> put("openAdmission", option.key == "open")
            "invite" -> {
                put("expiresInHours", value(0).toIntOrNull() ?: 24)
                put("maxUses", value(1).toIntOrNull() ?: 1)
            }
            "retention" -> {
                val days = value(0).toIntOrNull()
                if (days == null || days !in 0..36500) {
                    completion(StaffResult(error = "invalid_request"))
                    return
                }
                put("days", days)
            }
            "provisionModerator" -> {
                put("username", value(0))
                put("password", values.getOrNull(1).orEmpty())
            }
            "newCategory", "saveCategory", "saveChannel" -> put("name", value(0))
            "moveCategory" -> put("categoryId", value(0))
            "newText", "newVoice" -> {
                put("name", value(0))
                put("kind", if (option.key == "newText") "text" else "voice")
            }
            "categoryUp", "channelUp" -> put("direction", -1)
            "categoryDown", "channelDown" -> put("direction", 1)
            else -> if (option.key.startsWith("mod:")) {
                val action = option.key.substringAfter(':')
                put("action", if (action == "banIp") "ban" else action)
                if (action == "banIp") put("blockIp", true)
            }
        }
    }
    val path = when (option.key) {
        "open", "close" -> "/api/v1/admission"
        "invite" -> "/api/v1/invitations"
        "revokeInvite" -> "/api/v1/invitations/$id/revoke"
        "retention" -> "/api/v1/message-retention"
        "provisionModerator" -> "/api/v1/moderators"
        "newCategory" -> "/api/v1/categories"
        "saveCategory" -> "/api/v1/categories/$id"
        "categoryUp", "categoryDown" -> "/api/v1/categories/$id/move"
        "newText", "newVoice" -> "/api/v1/channels"
        "saveChannel", "moveCategory" -> {
            method = "PATCH"
            "/api/v1/channels/$id"
        }
        "channelUp", "channelDown" -> "/api/v1/channels/$id/move"
        "archiveChannel" -> "/api/v1/channels/$id/archive"
        else -> if (option.key.startsWith("mod:")) "/api/v1/participants/$id/moderate" else return
    }
    staffRequest(path, body.toString(), method) { reply, error ->
        val code = if (option.key == "invite" && reply != null) wire.parseToJsonElement(reply).jsonObject.text("token") else null
        completion(StaffResult(code, error))
    }
}
