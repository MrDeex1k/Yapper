package yapper

import io.ktor.http.HttpMethod
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel as UpdateQueue
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.time.TimeMark
import kotlin.time.TimeSource

class MobileClient internal constructor(
    private val store: DeviceStore,
    private val debugLoopback: Boolean,
    private val transport: MobileTransport,
    dispatcher: CoroutineDispatcher,
) {
    constructor(store: DeviceStore, debugLoopback: Boolean) :
        this(store, debugLoopback, Transport(), Dispatchers.Main)

    private val scope = CoroutineScope(SupervisorJob() + dispatcher)
    private val historyMutex = Mutex()
    private var listener: ((MobileState) -> Unit)? = null
    private var socket: Job? = null
    private var pendingGrant: VoiceGrant? = null
    private var voiceGeneration = 0L
    private class Session(val origin: String, val staff: Boolean, secret: String) {
        val cookie = "${cookieName(origin, staff)}=$secret"
        val tokenLock = Mutex()
        val membershipLock = Mutex()
        var accountToken: Pair<String, TimeMark>? = null
    }

    private var session: Session? = null
    private var before = 0L
    private var revision: Long? = null
    private val pendingSends = PendingSends(store)

    var state = MobileState(savedServers = readServers())
        private set

    fun observe(update: (MobileState) -> Unit) {
        listener = update
        update(state)
    }

    private fun set(next: MobileState) {
        if (state == next) return
        state = next
        listener?.invoke(next)
    }

    private fun action(work: suspend () -> Unit) {
        if (state.busy) return
        set(state.copy(busy = true, error = null))
        scope.launch {
            try {
                work()
            } catch (failure: CancellationException) {
                throw failure
            } catch (failure: Exception) {
                set(state.copy(error = (failure as? ServerError)?.code ?: "network_error"))
            } finally {
                set(state.copy(busy = false))
            }
        }
    }

    private fun readServers(): List<SavedServer> = runCatching {
        wire.decodeFromString<Map<String, String>>(store.readSetting("servers") ?: "{}")
            .map { SavedServer(it.key, it.value) }
    }.getOrDefault(emptyList())

    private fun remember(origin: String, name: String) {
        val saved = (listOf(SavedServer(origin, name)) + state.savedServers.filter { it.origin != origin }).take(20)
        store.saveSetting("servers", wire.encodeToString(saved.associate { it.origin to it.name }))
        set(state.copy(savedServers = saved))
    }

    fun connect(address: String) = action {
        val origin = serverOrigin(address, debugLoopback)
        val installation = wire.decodeFromString<Installation>(transport.request(origin, "/api/v1/state").body)
        if (!installation.configured) throw ServerError("setup_required")
        resetSession()
        set(state.copy(origin = origin, installation = installation))
        remember(origin, installation.name)

        val savedAccount = store.readSecret("staff:$origin")
        val savedGuest = store.readSecret("guest:$origin")
        for ((value, isAccount) in listOf(savedAccount to true, savedGuest to false)) {
            if (value == null) continue
            if (!validCredential(value)) continue
            session = Session(origin, isAccount, value)
            try {
                activate()
                break
            } catch (failure: ServerError) {
                session = null
                if (failure.code in setOf("participant_banned", "ip_blocked") ||
                    failure.status !in setOf(401, 403)
                ) throw failure
                if (isAccount && failure.status == 401) store.removeSecret("staff:$origin")
            }
        }
    }

    fun join(nickname: String, invitation: String) = action {
        val payload = buildJsonObject {
            put("nickname", nickname.trim())
            put("invitation", invitation.trim())
        }
        admit("/api/v1/guests", payload, false)
    }

    fun signIn(username: String, password: String) = action {
        val payload = buildJsonObject {
            put("username", username.trim())
            put("password", password)
        }
        admit("/api/auth/sign-in/username", payload, true)
    }

    private suspend fun admit(path: String, payload: JsonObject, staff: Boolean) {
        val origin = state.origin
        if (origin.isEmpty()) return
        val name = cookieName(origin, staff)
        val existing = if (staff) null else store.readSecret("guest:$origin")?.takeIf(::validCredential)
        val reply = transport.request(origin, path, payload, cookie = existing?.let { "$name=$it" })
        val secret = reply.cookies.firstNotNullOfOrNull {
            it.substringBefore(';').takeIf { pair -> pair.startsWith("$name=") }?.substringAfter('=')
        } ?: existing ?: throw ServerError(if (staff) "login_failed" else "access_denied")
        if (!validCredential(secret)) throw ServerError("access_denied")
        session = Session(origin, staff, secret)
        val saved = store.saveSecret("${if (staff) "staff" else "guest"}:$origin", secret)
        activate()
        if (!saved) set(state.copy(error = "session_not_saved"))
    }

    private fun currentSession(): Session = session ?: throw ServerError("access_denied", 401)

    private suspend fun request(
        path: String,
        payload: JsonElement? = null,
        method: HttpMethod? = null,
        authenticated: Session = currentSession(),
    ): String {
        val bearer = if (authenticated.staff && path.startsWith("/api/v1/")) {
            authenticated.tokenLock.withLock {
                authenticated.accountToken
                    ?.takeIf { it.second.elapsedNow().inWholeMilliseconds < 240_000 }?.first
                    ?: wire.decodeFromString<AccountToken>(
                        transport.request(authenticated.origin, "/api/auth/token", cookie = authenticated.cookie).body,
                    ).token.also { authenticated.accountToken = it to TimeSource.Monotonic.markNow() }
            }
        } else null
        return transport.request(authenticated.origin, path, payload, authenticated.cookie, bearer, method).body
    }

    private suspend fun activate() {
        val member = wire.decodeFromString<Membership>(request("/api/v1/me"))
        val channel = member.channels.firstOrNull { it.kind == "text" && !it.archived }
            ?: member.channels.firstOrNull { it.kind == "text" }
        set(state.copy(membership = member, channel = channel))
        startEvents()
    }

    private fun startEvents() {
        socket?.cancel()
        val authenticated = currentSession()
        socket = scope.launch {
            while (isActive && session === authenticated) {
                try {
                    val ticket = wire.decodeFromString<Ticket>(request("/api/v1/events/ticket", buildJsonObject {}))
                    coroutineScope {
                        val updates = UpdateQueue<Unit>(UpdateQueue.CONFLATED)
                        val reconcile = launch {
                            for (update in updates) syncChat()
                        }
                        try {
                            transport.events(authenticated.origin, ticket.ticket) { event ->
                                when (event.type) {
                                    "ready" -> {
                                        set(state.copy(connected = true, connectionProblem = null))
                                        syncMember()
                                        updates.trySend(Unit)
                                    }
                                    "catalog.changed", "members.changed" -> syncMember()
                                    "message.created", "messages.changed" -> {
                                        val channelId = event.payload?.get("channelId")?.jsonPrimitive?.contentOrNull
                                        if (channelId == null || channelId == state.channel?.id) updates.trySend(Unit)
                                    }
                                }
                            }
                        } finally {
                            reconcile.cancel()
                            updates.close()
                        }
                    }
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (failure: ServerError) {
                    if (failure.status == 401 || failure.status == 403) {
                        if (session === authenticated) {
                            cancelVoice()
                            set(state.copy(connected = false, connectionProblem = failure.code))
                        }
                        return@launch
                    }
                } catch (_: Exception) {
                    // Retry with a fresh ticket and reconcile from the server.
                } finally {
                    if (session === authenticated) set(state.copy(connected = false))
                }
                // Also reconcile while the event transport is unavailable.
                try {
                    syncMember()
                    syncChat()
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) { }
                delay(2_000)
            }
        }
    }

    fun reconnect() {
        if (state.busy || socket?.isActive == true || state.connectionProblem == null || session == null) return
        startEvents()
    }

    private suspend fun syncMember() {
        val authenticated = session ?: return
        authenticated.membershipLock.withLock {
            if (session !== authenticated) return
            val next = wire.decodeFromString<Membership>(request("/api/v1/me", authenticated = authenticated))
            if (session !== authenticated) return
            val channel = next.channels.find { it.id == state.channel?.id }
            set(state.copy(membership = next, channel = channel ?: state.channel))
        }
    }

    fun select(channel: Channel) {
        if (state.busy || state.connectionProblem != null || channel.kind != "text" || state.channel?.id == channel.id) return
        before = 0
        revision = null
        set(state.copy(channel = channel, messages = null, hasOlder = false))
        action { syncChat() }
    }

    private suspend fun syncChat(older: Boolean = false) = historyMutex.withLock {
        if (state.connectionProblem != null) return@withLock
        val channel = state.channel ?: return@withLock
        val authenticated = session ?: return@withLock
        val previous = revision
        val base = "/api/v1/channels/${channel.id}"
        fun stillSelected() = session === authenticated && state.channel?.id == channel.id
        if (previous == null || older) {
            val page = wire.decodeFromString<Timeline>(request("$base/timeline?before=${if (older) before else 0}"))
            if (!stillSelected()) return@withLock
            before = page.before
            if (!older) revision = page.revision
            val items = if (older) (state.messages.orEmpty() + page.messages).distinctBy { it.id } else page.messages
            set(state.copy(messages = items.sortedBy { it.sequence }, hasOlder = before != 0L))
        }
        while (stillSelected()) {
            val cursor = revision ?: break
            val batch = wire.decodeFromString<Changes>(request("$base/messages/changes?after=$cursor")).changes
            if (!stillSelected() || batch.isEmpty()) break
            val next = batch.maxOf { it.revision }
            if (next <= cursor) break
            revision = next
            val items = reconcileMessages(state.messages.orEmpty(), batch, before)
            set(state.copy(messages = items))
            if (batch.size < 100) break
        }
    }

    fun loadOlder() = action { if (before != 0L) syncChat(older = true) }

    fun send(body: String, completion: (Boolean) -> Unit) = action {
        if (state.connectionProblem != null) return@action
        val channel = state.channel ?: return@action
        val trimmed = body.trim()
        if (channel.archived) return@action
        if (!validMessage(trimmed)) throw ServerError("invalid_message")
        val participant = state.membership?.participant ?: return@action
        val key = "send:${state.origin}:${participant.id}:${channel.id}"
        val id = pendingSends.prepare(key, trimmed)
        request("/api/v1/channels/${channel.id}/messages", buildJsonObject {
            put("body", trimmed)
            put("requestId", id)
        })
        pendingSends.acknowledge(key)
        completion(true)
        syncChat()
    }

    fun edit(message: Message, body: String, completion: (Boolean) -> Unit) = action {
        if (state.connectionProblem != null) return@action
        val channel = state.channel ?: return@action
        val trimmed = body.trim()
        if (channel.archived) return@action
        if (!validMessage(trimmed)) throw ServerError("invalid_message")
        request("/api/v1/channels/${channel.id}/messages/${message.id}/edit", buildJsonObject {
            put("body", trimmed)
            put("revision", message.revision)
        })
        completion(true)
        syncChat()
    }

    fun delete(message: Message) = action {
        if (state.connectionProblem != null) return@action
        val channel = state.channel ?: return@action
        request("/api/v1/channels/${channel.id}/messages/${message.id}/delete", buildJsonObject {})
        syncChat()
    }

    internal fun staffRequest(path: String, payload: String?, method: String,
                              refreshAdmission: Boolean = false, completion: (String?, String?) -> Unit) = action {
        val role = state.membership?.participant?.role
        if (state.connectionProblem != null || role != "owner" && role != "moderator") {
            completion(null, "access_denied")
            return@action
        }
        require(path.startsWith("/api/v1/") && "://" !in path && ".." !in path)
        val reply = try {
            val body = request(path, payload?.let(wire::parseToJsonElement), HttpMethod.parse(method))
            if (refreshAdmission) {
                val installation = wire.decodeFromString<Installation>(transport.request(state.origin, "/api/v1/state").body)
                set(state.copy(installation = installation))
            }
            body
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            completion(null, (failure as? ServerError)?.code ?: "network_error")
            return@action
        }
        completion(reply, null)
        if (method != "GET") {
            if (path == "/api/v1/admission") {
                val open = wire.decodeFromString<AdmissionSetting>(reply).openAdmission
                set(state.copy(installation = state.installation?.copy(openAdmission = open)))
            }
            syncMember()
        }
    }

    fun requestVoice(channel: Channel, start: (VoiceGrant) -> Unit) = action {
        if (state.connectionProblem != null) return@action
        if (channel.kind != "voice" || channel.archived) return@action
        openVoice(channel, null, ++voiceGeneration, start)
    }

    fun recoverVoice(identity: String, start: (VoiceGrant) -> Unit) {
        scope.launch {
            while (state.busy && pendingGrant?.identity == identity) delay(25)
            val channel = state.voice?.channel ?: return@launch
            if (pendingGrant?.identity != identity) return@launch
            action { openVoice(channel, identity, ++voiceGeneration, start) }
        }
    }

    private suspend fun openVoice(channel: Channel, resume: String?, generation: Long, start: (VoiceGrant) -> Unit) {
        try {
            val grant = wire.decodeFromString<VoiceGrant>(request("/api/v1/voice/grant", buildJsonObject {
                put("channelId", channel.id)
                if (resume != null) put("resumeIdentity", resume)
            }))
            if (generation != voiceGeneration) {
                revokeVoice(grant)
                return
            }
            val expected = state.origin.replaceFirst("http", "ws") + "/livekit"
            if (grant.url.trimEnd('/') != expected || grant.channelId != channel.id) {
                revokeVoice(grant)
                throw ServerError("voice_error")
            }
            pendingGrant = grant
            set(state.copy(voice = VoiceState(channel, canPublish = grant.canPublish)))
            start(grant)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            if (generation != voiceGeneration) return
            val prior = pendingGrant
            pendingGrant = null
            set(state.copy(voice = null))
            if (prior?.identity == resume && prior != null) {
                try { revokeVoice(prior) } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) { }
            }
            throw failure
        }
    }

    fun voiceUpdate(identity: String, connected: Boolean, microphone: Boolean, deafened: Boolean, peers: List<VoicePeer>) {
        val voice = state.voice ?: return
        if (pendingGrant?.identity != identity) return
        set(state.copy(voice = voice.copy(
            connected = connected, microphone = microphone, deafened = deafened, peers = peers,
        )))
    }

    fun cancelVoice() {
        val identity = pendingGrant?.identity
        if (identity != null) voiceEnded(identity, false) else voiceGeneration++
    }

    fun voiceEnded(identity: String, failed: Boolean) {
        val grant = pendingGrant?.takeIf { it.identity == identity } ?: return
        voiceGeneration++
        pendingGrant = null
        val authenticated = session
        set(state.copy(voice = null, error = if (failed) "voice_error" else state.error))
        if (authenticated != null) scope.launch {
            try {
                revokeVoice(grant, authenticated)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) { }
        }
    }

    private suspend fun revokeVoice(grant: VoiceGrant, authenticated: Session = currentSession()) {
        request("/api/v1/voice/leave", buildJsonObject { put("identity", grant.identity) }, authenticated = authenticated)
    }

    fun switchServer() = action {
        pendingGrant?.let { revokeVoice(it) }
        resetSession()
        set(MobileState(savedServers = state.savedServers, busy = true))
    }

    fun signOut() = action {
        val authenticated = session ?: return@action
        cancelVoice()
        store.removeSecret("${if (authenticated.staff) "staff" else "guest"}:${authenticated.origin}")
        resetSession()
        if (authenticated.staff) {
            try {
                request("/api/auth/sign-out", buildJsonObject {}, authenticated = authenticated)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                set(state.copy(error = "remote_sign_out_unconfirmed"))
            }
        }
    }

    private fun resetSession() {
        session = null
        socket?.cancel()
        socket = null
        pendingGrant = null
        voiceGeneration++
        revision = null
        before = 0
        set(state.copy(membership = null, channel = null, messages = null, hasOlder = false, voice = null, connected = false, connectionProblem = null))
    }

    fun dismissError() = set(state.copy(error = null))

    fun dispose() {
        listener = null
        scope.cancel()
        transport.close()
    }
}

private fun cookieName(origin: String, staff: Boolean): String = when {
    staff && origin.startsWith("https://") -> "__Secure-better-auth.session_token"
    staff -> "better-auth.session_token"
    origin.startsWith("https://") -> "__Host-yapper_guest"
    else -> "yapper_guest"
}

private fun validCredential(value: String) =
    value.isNotEmpty() && value.length <= 4096 && value.all { it in '!'..'~' && it !in ";,\"\\" }
