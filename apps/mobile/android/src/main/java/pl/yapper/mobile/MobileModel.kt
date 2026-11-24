package pl.yapper.mobile

import android.app.Application
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.twilio.audioswitch.AudioDevice
import com.twilio.audioswitch.AudioDeviceChangeListener
import io.livekit.android.LiveKit
import io.livekit.android.events.DisconnectReason
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import io.livekit.android.room.track.RemoteAudioTrack
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import yapper.Channel
import yapper.DeviceStore
import yapper.Message
import yapper.MobileClient
import yapper.MicrophoneIntent
import yapper.VoiceGrant
import yapper.VoicePeer
import java.security.KeyStore
import java.util.Locale
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private class Storage(context: Context) : DeviceStore {
    private val settings = context.getSharedPreferences("yapper-settings", Context.MODE_PRIVATE)
    private val secrets = context.getSharedPreferences("yapper-secrets", Context.MODE_PRIVATE)
    private val alias = "yapper-mobile-session-v1"

    private fun key(): SecretKey {
        val vault = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (vault.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance("AES", "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build())
            generateKey()
        }
    }

    override fun readSecret(key: String): String? = runCatching {
        val encoded = secrets.getString(key, null) ?: return null
        val (iv, body) = encoded.split('.', limit = 2)
        Cipher.getInstance("AES/GCM/NoPadding").run {
            init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
            updateAAD(key.encodeToByteArray())
            doFinal(Base64.decode(body, Base64.NO_WRAP)).decodeToString()
        }
    }.getOrNull()

    override fun saveSecret(key: String, value: String): Boolean = runCatching {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        cipher.updateAAD(key.encodeToByteArray())
        val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
        val body = Base64.encodeToString(cipher.doFinal(value.encodeToByteArray()), Base64.NO_WRAP)
        secrets.edit().putString(key, "$iv.$body").commit()
    }.getOrDefault(false)

    override fun removeSecret(key: String) { secrets.edit().remove(key).apply() }
    override fun readSetting(key: String): String? = settings.getString(key, null)
    override fun saveSetting(key: String, value: String) { settings.edit().putString(key, value).apply() }
}

class MobileModel(app: Application) : AndroidViewModel(app) {
    private val store = Storage(app)
    val client = MobileClient(store, BuildConfig.DEBUG)
    var state by mutableStateOf(client.state)
        private set
    var locale by mutableStateOf(store.readSetting("locale") ?: Locale.getDefault().language.takeIf { it == "pl" } ?: "en")
        private set
    var localError by mutableStateOf<String?>(null)
    internal var staffPanel by mutableStateOf<StaffPanelState?>(null)
        private set
    internal var messageEdit by mutableStateOf<MessageEdit?>(null)
        private set
    var audioDevices by mutableStateOf<List<AudioDevice>>(emptyList())
        private set
    var audioOutput by mutableStateOf<AudioDevice?>(null)
        private set
    private var room: Room? = null
    private var grant: VoiceGrant? = null
    private var connection: Job? = null
    private var observer: Job? = null
    private var deafened = false
    private val mic = MicrophoneIntent()
    private var micCommand: Job? = null
    private var permissionTarget: Pair<String, Long>? = null
    private var audioListener: AudioDeviceChangeListener? = null
    private val volumes = mutableMapOf<String, Float>()

    init {
        client.observe {
            val previous = state.membership?.participant
            val current = it.membership?.participant
            val identityChanged = state.origin != it.origin || previous?.id != current?.id || previous?.role != current?.role
            if (identityChanged) closeStaffPanel()
            if (identityChanged || state.channel?.id != it.channel?.id) closeMessageEdit()
            state = it
            if (it.connectionProblem != null && room != null) closeVoice(failed = false)
        }
    }

    internal fun openStaffPanel() { staffPanel = StaffPanelState() }

    internal fun closeStaffPanel() { staffPanel = null }

    internal fun openMessageEdit(message: Message) {
        client.dismissError()
        messageEdit = MessageEdit(message)
    }

    internal fun closeMessageEdit() { messageEdit = null }

    fun changeLanguage() {
        locale = if (locale == "pl") "en" else "pl"
        store.saveSetting("locale", locale)
    }

    fun joinVoice(channel: Channel) {
        if (state.busy || state.voice?.channel?.id == channel.id) return
        leaveVoice()
        client.requestVoice(channel) { startVoice(it, recovery = false) }
    }

    private fun startVoice(next: VoiceGrant, recovery: Boolean) {
        val session = LiveKit.create(getApplication<Application>())
        room = session
        grant = next
        val listener: AudioDeviceChangeListener = { devices, selected ->
            viewModelScope.launch {
                if (room === session) {
                    audioDevices = devices
                    audioOutput = selected
                }
            }
        }
        audioListener = listener
        session.audioSwitchHandler?.registerAudioDeviceChangeListener(listener)
        var wasConnected = false
        observer = viewModelScope.launch {
            session.events.collect { event ->
                if (room !== session) return@collect
                when (event) {
                    is RoomEvent.Disconnected -> {
                        val recoverable = event.reason in setOf(
                            DisconnectReason.SERVER_SHUTDOWN, DisconnectReason.STATE_MISMATCH,
                            DisconnectReason.SIGNAL_CLOSE, DisconnectReason.CONNECTION_TIMEOUT,
                            DisconnectReason.MEDIA_FAILURE,
                        )
                        val resume = wasConnected && !recovery && recoverable
                        closeVoice(failed = true, willRecover = resume)
                        if (resume) client.recoverVoice(next.identity) { startVoice(it, recovery = true) }
                    }
                    is RoomEvent.Reconnecting -> {
                        updateVoice(session, next)
                        setMicrophone(false)
                    }
                    is RoomEvent.TrackSubscribed -> {
                        applyParticipantVolume(session, event.participant.identity?.value?.substringBefore(':'))
                        updateVoice(session, next)
                    }
                    else -> updateVoice(session, next)
                }
            }
        }
        connection = viewModelScope.launch {
            try {
                session.connect(next.url, next.token)
                wasConnected = true
                if (room === session) updateVoice(session, next)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                if (room === session) closeVoice(failed = true)
            }
        }
    }

    private fun canUseMicrophone(): Boolean =
        state.voice?.connected == true && grant?.canPublish == true && !deafened

    fun prepareMicrophonePermission(): Boolean {
        val identity = grant?.identity ?: return false
        if (!canUseMicrophone() || permissionTarget != null) return false
        permissionTarget = identity to mic.revision
        return true
    }

    fun microphonePermissionResult(granted: Boolean) {
        val target = permissionTarget ?: return
        permissionTarget = null
        if (target.first != grant?.identity || target.second != mic.revision || !canUseMicrophone()) return
        if (granted) setMicrophone(true) else localError = "microphone_denied"
    }

    fun toggleMic() {
        if (canUseMicrophone()) setMicrophone(!mic.enabled)
    }

    private fun setMicrophone(enabled: Boolean) {
        val session = room ?: return
        val currentGrant = grant ?: return
        mic.update(enabled)
        if (micCommand?.isActive == true) return
        micCommand = viewModelScope.launch {
            while (room === session) {
                val revision = mic.revision
                val target = mic.enabled && canUseMicrophone()
                try {
                    val applied = session.localParticipant.setMicrophoneEnabled(target)
                    check(!target || applied)
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    if (room === session && !target && session.localParticipant.isMicrophoneEnabled) {
                        closeVoice(failed = true)
                        break
                    }
                    if (room === session && revision == mic.revision) {
                        mic.update(false)
                        localError = "voice_error"
                        updateVoice(session, currentGrant)
                        break
                    }
                }
                if (room === session) updateVoice(session, currentGrant)
                if (revision == mic.revision) break
            }
        }
    }

    fun toggleDeafen() {
        val session = room ?: return
        val currentGrant = grant ?: return
        deafened = !deafened
        if (deafened) setMicrophone(false)
        applyParticipantVolume(session, null)
        updateVoice(session, currentGrant)
    }

    fun selectAudio(device: AudioDevice?) {
        try {
            room?.audioSwitchHandler?.selectDevice(device)
        } catch (_: Exception) {
            localError = "audio_device_error"
        }
    }

    fun volume(id: String): Float = volumes[id] ?: 1f

    fun changeVolume(id: String, level: Float) {
        volumes[id] = level
        room?.let { applyParticipantVolume(it, id) }
    }

    private fun applyParticipantVolume(session: Room, target: String?) {
        session.remoteParticipants.values.forEach { participant ->
            val id = participant.identity?.value?.substringBefore(':') ?: return@forEach
            if (target != null && id != target) return@forEach
            val level = if (deafened) 0.0 else volume(id).toDouble()
            participant.audioTrackPublications.forEach { (_, track) ->
                (track as? RemoteAudioTrack)?.setVolume(level)
            }
        }
    }

    private fun updateVoice(session: Room, currentGrant: VoiceGrant) {
        val speaking = session.activeSpeakers.mapNotNull { it.identity?.value }.toSet()
        val remote = session.remoteParticipants.values.mapNotNull { participant ->
            val identity = participant.identity?.value ?: return@mapNotNull null
            val id = identity.substringBefore(':')
            VoicePeer(id, participant.name ?: id, identity in speaking)
        }.sortedBy { it.name }
        val me = state.membership?.participant
        val peers = if (me == null || session.state != Room.State.CONNECTED) remote else
            listOf(VoicePeer(me.id, me.nickname, currentGrant.identity in speaking, local = true)) + remote
        client.voiceUpdate(currentGrant.identity, session.state == Room.State.CONNECTED,
            session.localParticipant.isMicrophoneEnabled, deafened, peers)
    }

    fun leaveVoice() {
        closeVoice(failed = false)
        client.cancelVoice()
    }

    private fun closeVoice(failed: Boolean, willRecover: Boolean = false) {
        val session = room ?: return
        val identity = grant?.identity
        room = null
        grant = null
        observer?.cancel()
        observer = null
        connection?.cancel()
        connection = null
        mic.update(false)
        micCommand?.cancel()
        micCommand = null
        audioListener?.let { session.audioSwitchHandler?.unregisterAudioDeviceChangeListener(it) }
        audioListener = null
        audioDevices = emptyList()
        audioOutput = null
        session.disconnect()
        session.release()
        deafened = false
        if (identity != null && !willRecover) client.voiceEnded(identity, failed)
    }

    override fun onCleared() {
        leaveVoice()
        client.dispose()
    }
}

internal class MessageEdit(val message: Message) {
    var body by mutableStateOf(message.body)
}
