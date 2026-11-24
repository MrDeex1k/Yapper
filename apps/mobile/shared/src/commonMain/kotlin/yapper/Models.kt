package yapper

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class Installation(val name: String, val configured: Boolean, val openAdmission: Boolean)

@Serializable
data class Participant(val id: String, val nickname: String, val role: String, val micMuted: Boolean = false)

@Serializable
data class Group(val id: String, val name: String)

@Serializable
data class Channel(
    val id: String,
    val name: String,
    val kind: String,
    val categoryId: String = "",
    val archived: Boolean = false,
)

@Serializable
data class Membership(
    val participant: Participant,
    val channels: List<Channel>,
    val categories: List<Group> = emptyList(),
    val account: Boolean = false,
) {
    val channelGroups: List<ChannelGroup> by lazy {
        val byCategory = channels.groupBy(Channel::categoryId)
        (listOf(Group("", "")) + categories).mapNotNull { category ->
            val members = byCategory[category.id] ?: return@mapNotNull null
            val text = members.filter { it.kind == "text" }
            val voice = members.filter { it.kind == "voice" && !it.archived }
            if (text.isEmpty() && voice.isEmpty()) null else ChannelGroup(category, text, voice)
        }
    }
}

data class ChannelGroup(val category: Group, val text: List<Channel>, val voice: List<Channel>)

@Serializable
data class Message(
    val id: String,
    val authorId: String,
    val nickname: String,
    val body: String,
    val sequence: Long,
    val revision: Long,
    val createdAt: String = "",
    val editedAt: String? = null,
)

@Serializable
internal data class Timeline(val messages: List<Message>, val before: Long, val revision: Long)

@Serializable
internal data class Change(val id: String, val revision: Long, val message: Message?)

@Serializable
internal data class Changes(val changes: List<Change> = emptyList())

@Serializable
internal data class Event(val version: Int, val type: String, val payload: JsonObject? = null)

@Serializable
internal data class Ticket(val ticket: String)

@Serializable
internal data class AccountToken(val token: String)

@Serializable
internal data class AdmissionSetting(val openAdmission: Boolean)

@Serializable
data class VoiceGrant(
    val url: String,
    val token: String,
    val identity: String,
    val channelId: String,
    val canPublish: Boolean,
) {
    override fun toString() = "VoiceGrant(channelId=$channelId, canPublish=$canPublish)"
}

data class SavedServer(val origin: String, val name: String)
data class VoicePeer(val id: String, val name: String, val speaking: Boolean, val local: Boolean = false)

data class VoiceState(
    val channel: Channel,
    val connected: Boolean = false,
    val microphone: Boolean = false,
    val deafened: Boolean = false,
    val canPublish: Boolean = false,
    val peers: List<VoicePeer> = emptyList(),
)

data class MobileState(
    val origin: String = "",
    val installation: Installation? = null,
    val membership: Membership? = null,
    val channel: Channel? = null,
    val messages: List<Message>? = null,
    val hasOlder: Boolean = false,
    val savedServers: List<SavedServer> = emptyList(),
    val voice: VoiceState? = null,
    val connected: Boolean = false,
    val connectionProblem: String? = null,
    val busy: Boolean = false,
    val error: String? = null,
) {
    val screen: String
        get() = when {
            membership != null -> "chat"
            installation != null -> "join"
            else -> "server"
        }
}

interface DeviceStore {
    fun readSecret(key: String): String?
    fun saveSecret(key: String, value: String): Boolean
    fun removeSecret(key: String)
    fun readSetting(key: String): String?
    fun saveSetting(key: String, value: String)
}

internal fun reconcileMessages(
    messages: List<Message>,
    changes: List<Change>,
    oldest: Long,
): List<Message> {
    val timeline = messages.associateBy { it.id }.toMutableMap()
    for (change in changes) {
        val current = timeline[change.id]
        if (current != null && current.revision >= change.revision) continue
        val incoming = change.message
        if (incoming == null) timeline.remove(change.id)
        else if (incoming.sequence >= oldest) timeline[incoming.id] = incoming
    }
    return timeline.values.sortedBy { it.sequence }
}
