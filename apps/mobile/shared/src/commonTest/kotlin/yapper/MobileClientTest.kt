package yapper

import io.ktor.http.HttpMethod
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val ORIGIN = "https://voice.example"
private const val MEMBERSHIP = """{"participant":{"id":"user-1","nickname":"Friend","role":"owner"},"channels":[{"id":"general","name":"general","kind":"text"}]}"""

internal class MemoryStore : DeviceStore {
    private val secrets = mutableMapOf<String, String>()
    private val settings = mutableMapOf<String, String>()
    override fun readSecret(key: String) = secrets[key]
    override fun saveSecret(key: String, value: String): Boolean {
        secrets[key] = value
        return true
    }
    override fun removeSecret(key: String) { secrets.remove(key) }
    override fun readSetting(key: String) = settings[key]
    override fun saveSetting(key: String, value: String) { settings[key] = value }
}

@OptIn(ExperimentalCoroutinesApi::class)
class MobileClientTest {
    @Test
    fun aKickPausesEventsUntilExplicitReconnect() = runTest {
        val kick = CompletableDeferred<Unit>()
        val backend = Fixture()
        backend.onEvents = { notify ->
            notify(Event(1, "ready"))
            if (backend.tickets == 1) {
                kick.await()
                throw ServerError("kicked", 403)
            }
            awaitCancellation()
        }
        val client = MobileClient(guest(), false, backend, StandardTestDispatcher(testScheduler))
        try {
            client.connect(ORIGIN)
            runCurrent()
            assertTrue(client.state.connected)
            kick.complete(Unit)
            runCurrent()
            advanceTimeBy(10_000)
            assertEquals(1, backend.tickets)
            assertEquals("kicked", client.state.connectionProblem)
            assertFalse(client.state.connected)
            client.send("Waiting for reconnect") { error("Unexpected send acknowledgement") }
            runCurrent()
            assertEquals(emptyList(), backend.sends)
            client.reconnect()
            runCurrent()
            assertEquals(2, backend.tickets)
            assertNull(client.state.connectionProblem)
            assertTrue(client.state.connected)
        } finally {
            client.dispose()
        }
    }

    @Test
    fun invalidatedSessionPausesInsteadOfPolling() = runTest {
        val backend = Fixture()
        backend.ticketError = ServerError("participant_banned", 403)
        val client = MobileClient(guest(), false, backend, StandardTestDispatcher(testScheduler))
        try {
            client.connect(ORIGIN)
            runCurrent()
            advanceTimeBy(10_000)
            assertEquals("participant_banned", client.state.connectionProblem)
            assertEquals(1, backend.tickets)
        } finally {
            client.dispose()
        }
    }

    @Test
    fun invitationCodeSurvivesFailedRefresh() = runTest {
        val backend = Fixture()
        val client = MobileClient(guest(), false, backend, StandardTestDispatcher(testScheduler))
        try {
            client.connect(ORIGIN)
            runCurrent()
            backend.failRefresh = true
            val outcomes = mutableListOf<StaffResult>()
            client.applyStaff(StaffOption("Invite", "invite"), listOf("24", "1"), outcomes::add)
            runCurrent()
            assertEquals(listOf(StaffResult("one-time-code")), outcomes)
            assertEquals(1, backend.invitations)
            assertEquals("network_error", client.state.error)
        } finally {
            client.dispose()
        }
    }

    @Test
    fun unresolvedSendUsesSameIdAfterClientRecreation() = runTest {
        val store = guest()
        val backend = Fixture()
        val dispatcher = StandardTestDispatcher(testScheduler)
        val first = MobileClient(store, false, backend, dispatcher)
        try {
            first.connect(ORIGIN)
            runCurrent()
            first.send("Conversation") { error("The first response should be lost") }
            runCurrent()
            assertEquals(1, backend.sends.size)
        } finally {
            first.dispose()
        }
        val second = MobileClient(store, false, backend, dispatcher)
        try {
            second.connect(ORIGIN)
            runCurrent()
            var acknowledged = false
            second.send("Conversation") { acknowledged = it }
            runCurrent()
            assertTrue(acknowledged)
            assertEquals(2, backend.sends.size)
            assertEquals(backend.sends[0], backend.sends[1])
            second.send("Conversation") { }
            runCurrent()
            assertNotEquals(backend.sends[1], backend.sends[2])
        } finally {
            second.dispose()
        }
    }

    @Test
    fun messageNotificationsCoalesceDuringAnInflightDelta() = runTest {
        val backend = Fixture()
        val firstDelta = CompletableDeferred<Unit>()
        backend.blockFirstDelta = firstDelta
        backend.onEvents = { notify ->
            notify(Event(1, "ready"))
            backend.deltaStarted.await()
            repeat(100) { notify(Event(1, "message.created")) }
            firstDelta.complete(Unit)
            awaitCancellation()
        }
        val client = MobileClient(guest(), false, backend, StandardTestDispatcher(testScheduler))
        try {
            client.connect(ORIGIN)
            runCurrent()
            assertEquals(2, backend.deltas)
        } finally {
            client.dispose()
        }
    }

    @Test
    fun failedRemoteSignOutCannotRestoreStaffCredentials() = runTest {
        for (failure in listOf(ServerError("expired", 401), IllegalStateException("Timed out"))) {
            val store = MemoryStore().apply { saveSecret("staff:$ORIGIN", "staff-session") }
            val backend = Fixture()
            val release = CompletableDeferred<Unit>()
            var attempted = false
            backend.intercept = { path ->
                when (path) {
                    "/api/auth/token" -> Reply("""{"token":"account-token"}""")
                    "/api/auth/sign-out" -> {
                        attempted = true
                        release.await()
                        throw failure
                    }
                    else -> null
                }
            }
            val client = MobileClient(store, false, backend, StandardTestDispatcher(testScheduler))
            try {
                client.connect(ORIGIN)
                runCurrent()
                assertEquals("chat", client.state.screen)
                client.signOut()
                runCurrent()
                assertTrue(attempted)
                assertNull(store.readSecret("staff:$ORIGIN"))
                assertEquals("join", client.state.screen)
                release.complete(Unit)
                runCurrent()
                assertEquals("remote_sign_out_unconfirmed", client.state.error)
                client.connect(ORIGIN)
                runCurrent()
                assertEquals("join", client.state.screen)
            } finally { client.dispose() }
        }
    }

    @Test
    fun postArchiveRefreshFollowsInflightMembershipRead() = runTest {
        val backend = Fixture()
        val release = CompletableDeferred<Unit>()
        var reads = 0
        var archived = false
        backend.intercept = { path ->
            when (path) {
                "/api/v1/me" -> {
                    val channelState = MEMBERSHIP.replace("\"kind\":\"text\"", "\"kind\":\"text\",\"archived\":$archived")
                    if (++reads == 2) release.await()
                    Reply(channelState)
                }
                "/api/v1/channels/general/archive" -> { archived = true; Reply("{}") }
                else -> null
            }
        }
        val client = MobileClient(guest(), false, backend, StandardTestDispatcher(testScheduler))
        try {
            client.connect(ORIGIN)
            runCurrent()
            client.applyStaff(StaffOption("Archive", "archiveChannel", "general"), emptyList()) {}
            runCurrent()
            assertTrue(archived)
            assertEquals(2, reads)
            release.complete(Unit)
            runCurrent()
            assertEquals(3, reads)
            assertEquals(true, client.state.channel?.archived)
        } finally { client.dispose() }
    }

    @Test
    fun admissionPageReadsCurrentServerSetting() = runTest {
        val backend = Fixture()
        val client = MobileClient(guest(), false, backend, StandardTestDispatcher(testScheduler))
        try {
            client.connect(ORIGIN)
            runCurrent()
            backend.intercept = { path -> when (path) {
                "/api/v1/state" -> Reply("""{"name":"Yapper","configured":true,"openAdmission":false}""")
                else -> null
            } }
            var page: StaffPage? = null
            client.staffPage("admissionSettings", "", "en") { page = it }
            runCurrent()
            assertEquals(false, client.state.installation?.openAdmission)
            assertEquals("open", page?.items?.first()?.actions?.first()?.key)
        } finally { client.dispose() }
    }

    @Test
    fun bannedGuestCanReceiveAnIpBlockOnce() = runTest {
        val backend = Fixture()
        val client = MobileClient(guest(), false, backend, StandardTestDispatcher(testScheduler))
        try {
            client.connect(ORIGIN)
            runCurrent()
            for (blocked in listOf(false, true)) {
                backend.intercept = { path ->
                    if (path == "/api/v1/participants") Reply(
                        """{"members":[{"id":"other","role":"participant","banned":true,"canBlockIp":true,"ipBlocked":$blocked}]}"""
                    ) else null
                }
                var page: StaffPage? = null
                client.staffPage("participants", "", "en") { page = it }
                runCurrent()
                val keys = requireNotNull(page).items.single().actions.map { it.key }
                assertTrue("mod:unban" in keys)
                assertEquals(!blocked, "mod:banIp" in keys)
            }
        } finally { client.dispose() }
    }

    private fun guest() = MemoryStore().apply { saveSecret("guest:$ORIGIN", "guest-session") }

    private class Fixture : MobileTransport {
        var intercept: suspend (String) -> Reply? = { null }
        var tickets = 0
        var invitations = 0
        var deltas = 0
        var failRefresh = false
        var ticketError: ServerError? = null
        var blockFirstDelta: CompletableDeferred<Unit>? = null
        val deltaStarted = CompletableDeferred<Unit>()
        val sends = mutableListOf<String>()
        var onEvents: suspend (suspend (Event) -> Unit) -> Unit = { notify ->
            notify(Event(1, "ready"))
            awaitCancellation()
        }

        override suspend fun request(
            origin: String,
            path: String,
            payload: JsonElement?,
            cookie: String?,
            bearer: String?,
            methodOverride: HttpMethod?,
        ): Reply = intercept(path) ?: when {
            path == "/api/v1/state" -> Reply("""{"name":"Yapper","configured":true,"openAdmission":true}""")
            path == "/api/v1/me" -> {
                if (failRefresh) error("Membership fetch failed")
                Reply(MEMBERSHIP)
            }
            path == "/api/v1/events/ticket" -> {
                tickets++
                ticketError?.let { throw it }
                Reply("""{"ticket":"dummy"}""")
            }
            path.contains("/timeline?") -> Reply("""{"messages":[],"before":0,"revision":0}""")
            path.contains("/messages/changes?") -> {
                deltas++
                if (deltas == 1) {
                    deltaStarted.complete(Unit)
                    blockFirstDelta?.await()
                }
                Reply("""{"changes":[]}""")
            }
            path == "/api/v1/invitations" -> {
                invitations++
                Reply("""{"token":"one-time-code"}""")
            }
            path.endsWith("/messages") -> {
                sends += payload!!.jsonObject.getValue("requestId").jsonPrimitive.content
                if (sends.size == 1) error("Response lost after commit")
                Reply("{}")
            }
            else -> error("Unexpected request path $path")
        }

        override suspend fun events(origin: String, ticket: String, event: suspend (Event) -> Unit) = onEvents(event)
        override fun close() = Unit
    }
}
