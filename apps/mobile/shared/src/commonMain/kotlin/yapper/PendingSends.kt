package yapper

import kotlinx.serialization.Serializable
import kotlin.uuid.Uuid

internal class PendingSends(private val store: DeviceStore) {
    @Serializable
    private data class Send(val body: String, val id: String)

    private val unsaved = mutableMapOf<String, Send>()

    fun prepare(key: String, body: String): String {
        val previous = unsaved[key] ?: store.readSecret(key)?.let { saved ->
            runCatching { wire.decodeFromString<Send>(saved) }.getOrNull()
        }
        if (previous?.body == body) return previous.id
        val send = Send(body, Uuid.random().toString())
        if (store.saveSecret(key, wire.encodeToString(send))) unsaved.remove(key)
        else unsaved[key] = send
        return send.id
    }

    fun acknowledge(key: String) {
        unsaved.remove(key)
        store.removeSecret(key)
    }
}

fun messageLength(body: String): Int {
    val text = body.trim()
    // Each valid surrogate pair represents one Unicode code point on both targets.
    var count = 0
    var index = 0
    while (index < text.length) {
        val unit = text[index++]
        if (unit.isHighSurrogate() && index < text.length && text[index].isLowSurrogate()) index++
        count++
    }
    return count
}

fun validMessage(body: String): Boolean {
    val length = messageLength(body)
    return length in 1..2000 && body.trim().none { it.isISOControl() && it != '\n' && it != '\t' }
}
