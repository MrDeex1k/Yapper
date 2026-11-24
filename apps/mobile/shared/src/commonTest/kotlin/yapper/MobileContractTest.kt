package yapper

import kotlin.test.Test
import kotlin.test.assertTrue
import kotlin.test.assertFalse
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class MobileContractTest {
    @Test
    fun addressesAreScopedToCanonicalOrigins() {
        assertEquals("https://voice.example", serverOrigin("VOICE.example:443/", false))
        assertEquals("https://voice.example:8443", serverOrigin("https://voice.example:8443", false))
        assertEquals("http://127.0.0.1:8090", serverOrigin("http://127.0.0.1:8090", true))
        for (address in listOf(
            "http://127.0.0.1:8090", "http://voice.example", "https://user@voice.example",
            "https://voice.example/channel", "https://voice.example?x=1", "https://voice.example#fallback",
        )) {
            assertFailsWith<ServerError> { serverOrigin(address, false) }
        }
    }

    @Test
    fun timelinePreservesOrderingEditsAndTombstones() {
        fun message(id: String, sequence: Long, revision: Long) =
            Message(id, "author", "Friend", "revision $revision", sequence, revision)
        val original = listOf(message("first", 5, 5), message("second", 7, 7))
        val updates = listOf(
            Change("first", 3, message("first", 5, 3)),
            Change("second", 8, message("second", 7, 8)),
            Change("first", 9, null),
            Change("unloaded", 10, message("unloaded", 2, 10)),
            Change("new", 11, message("new", 11, 11)),
        )
        assertEquals(listOf("second", "new"), reconcileMessages(original, updates, 5).map { it.id })
        assertEquals("revision 8", reconcileMessages(original, updates, 5).first().body)
    }
    @Test
    fun messageLimitCountsUnicodeCodePoints() {
        assertTrue(validMessage("😀".repeat(2000)))
        assertFalse(validMessage("😀".repeat(2001)))
        assertEquals(2000, messageLength("e\u0301".repeat(1000)))
        assertFalse(validMessage("e\u0301".repeat(1001)))
        assertFalse(validMessage("embedded\u0000control"))
    }

    @Test
    fun microphoneDisableInvalidatesPendingEnable() {
        val intent = MicrophoneIntent()
        intent.update(true)
        val pending = intent.revision
        intent.update(false)
        assertFalse(intent.enabled)
        assertTrue(intent.revision > pending)
    }

    @Test
    fun channelGroupsPreserveCatalogOrderAndHideArchivedVoiceChannels() {
        val conversations = Group("conversations", "Conversations")
        val empty = Group("empty", "Empty")
        val channels = listOf(
            Channel("text-2", "Second", "text", conversations.id, archived = true),
            Channel("lounge", "Lounge", "voice"),
            Channel("hidden", "Hidden", "voice", empty.id, archived = true),
            Channel("general", "General", "text"),
            Channel("text-1", "First", "text", conversations.id),
            Channel("group-voice", "Voice", "voice", conversations.id),
        )
        val membership = Membership(Participant("guest", "Guest", "participant"), channels, listOf(empty, conversations))

        assertEquals(listOf("", conversations.id), membership.channelGroups.map { it.category.id })
        assertEquals(listOf("general"), membership.channelGroups.first().text.map(Channel::id))
        assertEquals(listOf("lounge"), membership.channelGroups.first().voice.map(Channel::id))
        assertEquals(listOf("text-2", "text-1"), membership.channelGroups.last().text.map(Channel::id))
        assertEquals(listOf("group-voice"), membership.channelGroups.last().voice.map(Channel::id))
    }
}
