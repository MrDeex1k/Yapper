package pl.yapper.mobile

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModelProvider
import com.twilio.audioswitch.AudioDevice
import yapper.Channel
import yapper.Membership
import yapper.Message
import yapper.MobileState
import yapper.messageLength
import yapper.mobileText
import yapper.validMessage
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

internal val Background = Color(0xFF1B1B1E)
internal val Navigation = Color(0xFF111113)
internal val Panel = Color(0xFF222225)
internal val Selected = Color(0xFF2D2D32)
internal val Line = Color(0xFF343438)
internal val ControlLine = Color(0xFF5D5D65)
internal val Foreground = Color(0xFFF1F1F3)
internal val Muted = Color(0xFFA6A6AE)
internal val Accent = Color(0xFFAC89FC)
internal val Danger = Color(0xFFFFB4B9)
internal val LocalCopy = compositionLocalOf { "en" }

@Composable internal fun copy(key: String) = mobileText(LocalCopy.current, key)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val bars = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
        enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
        val model = ViewModelProvider(this)[MobileModel::class.java]
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(
                primary = Accent, onPrimary = Navigation, surface = Background,
                onSurface = Foreground, onSurfaceVariant = Muted, outline = ControlLine,
                surfaceVariant = Panel, error = Danger,
            )) {
                CompositionLocalProvider(LocalCopy provides model.locale) {
                    Surface(color = Background, modifier = Modifier.fillMaxSize()) {
                        Box(Modifier.windowInsetsPadding(WindowInsets.safeDrawing).imePadding()) {
                            if (model.state.screen == "chat") Workspace(model) else Entry(model)
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun Glyph(resource: Int, color: Color = Muted, label: String? = null, size: Int = 20, modifier: Modifier = Modifier) {
    Icon(painterResource(resource), label, tint = color, modifier = modifier.size(size.dp))
}

@Composable
internal fun Field(label: String, value: String, change: (String) -> Unit,
    password: Boolean = false, keyboard: KeyboardType = KeyboardType.Text,
    modifier: Modifier = Modifier.fillMaxWidth()) {
    OutlinedTextField(
        value = value, onValueChange = change, label = { Text(label) }, singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else keyboard),
        visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
        shape = RoundedCornerShape(8.dp), modifier = modifier,
        colors = OutlinedTextFieldDefaults.colors(
            unfocusedContainerColor = Navigation, focusedContainerColor = Navigation,
            unfocusedBorderColor = ControlLine, focusedBorderColor = Accent,
        ),
    )
}

@Composable
internal fun Primary(label: String, enabled: Boolean = true, action: () -> Unit) {
    Button(onClick = action, enabled = enabled, shape = RoundedCornerShape(8.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Foreground, contentColor = Navigation),
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
        Text(label, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun Mark() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
        Image(painterResource(R.drawable.yapper_brand), null, Modifier.size(34.dp).clip(RoundedCornerShape(8.dp)))
        Text("Yapper", color = Foreground, fontSize = 20.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun Language(model: MobileModel) {
    TextButton(onClick = model::changeLanguage, modifier = Modifier.heightIn(min = 48.dp)) {
        Text(model.locale.uppercase(), color = Muted)
    }
}

@Composable
private fun Entry(model: MobileModel) {
    val state = model.state
    var address by rememberSaveable { mutableStateOf("") }
    var nickname by rememberSaveable(state.origin) { mutableStateOf("") }
    var invitation by remember(state.origin) { mutableStateOf("") }
    var username by rememberSaveable(state.origin) { mutableStateOf("") }
    var password by remember(state.origin) { mutableStateOf("") }
    var staff by rememberSaveable(state.origin) { mutableStateOf(false) }
    val installation = state.installation
    BackHandler(enabled = installation != null && !state.busy) { model.client.switchServer() }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 540.dp).fillMaxWidth().fillMaxHeight()
            .verticalScroll(rememberScrollState()).padding(horizontal = 22.dp)) {
            Row(Modifier.fillMaxWidth().heightIn(min = 62.dp), verticalAlignment = Alignment.CenterVertically) {
                Mark()
                Spacer(Modifier.weight(1f))
                Language(model)
            }
            HorizontalDivider(color = Line)
            Spacer(Modifier.height(32.dp))
            Text(copy(if (installation == null) "chooseServer" else if (staff) "staffSignIn" else "join"),
                fontSize = 29.sp, lineHeight = 34.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            if (installation == null) {
                Text(copy("serverAddressHint"), color = Muted, fontSize = 14.sp)
                Spacer(Modifier.height(18.dp))
                if (state.savedServers.isNotEmpty()) {
                    Text(copy("savedServers"), color = Muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(5.dp))
                    state.savedServers.forEach { server ->
                        Surface(shape = RoundedCornerShape(9.dp), color = Panel,
                            border = androidx.compose.foundation.BorderStroke(1.dp, Line),
                            onClick = { model.client.connect(server.origin) }, enabled = !state.busy,
                            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                            Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                Glyph(R.drawable.yapper_server, Accent)
                                Column(Modifier.weight(1f)) {
                                    Text(server.name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(server.origin, color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                                Glyph(R.drawable.yapper_arrow_right, Accent)
                            }
                        }
                    }
                    Spacer(Modifier.height(14.dp))
                }
                Field(copy("serverAddress"), address, { address = it }, keyboard = KeyboardType.Uri)
                Spacer(Modifier.height(12.dp))
                Primary(copy("connectServer"), address.isNotBlank() && !state.busy) { model.client.connect(address) }
            } else {
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(9.dp)).background(Panel).padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Glyph(R.drawable.yapper_server, Accent)
                    Column(Modifier.weight(1f)) {
                        Text(copy("currentServer"), color = Muted, fontSize = 12.sp)
                        Text(installation.name, fontWeight = FontWeight.SemiBold)
                        Text(state.origin, color = Muted, fontSize = 12.sp)
                    }
                }
                Spacer(Modifier.height(12.dp))
                if (staff) {
                    Field(copy("username"), username, { username = it })
                    Field(copy("password"), password, { password = it }, password = true)
                } else {
                    Field(copy("nickname"), nickname, { nickname = it.take(32) })
                    if (!installation.openAdmission) Field(copy("invitation"), invitation, { invitation = it.take(128) })
                }
                Spacer(Modifier.height(12.dp))
                Primary(copy(if (staff) "signIn" else "joinAction"), !state.busy &&
                    if (staff) username.isNotBlank() && password.isNotBlank() else
                        nickname.isNotBlank() && (installation.openAdmission || invitation.isNotBlank())) {
                    if (staff) model.client.signIn(username, password) else model.client.join(nickname, invitation)
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    TextButton(onClick = model.client::switchServer, enabled = !state.busy) { Text(copy("back")) }
                    TextButton(onClick = { staff = !staff }, enabled = !state.busy) {
                        Text(copy(if (staff) "joinAction" else "staffSignIn"))
                    }
                }
            }
            state.error?.let { Text(copy(it), color = Danger, modifier = Modifier.padding(top = 12.dp)) }
            if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 12.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Workspace(model: MobileModel) {
    val state = model.state
    val member = state.membership ?: return
    var drawer by rememberSaveable { mutableStateOf(false) }
    var audioPanel by rememberSaveable { mutableStateOf(false) }
    val context = LocalContext.current
    val focus = LocalFocusManager.current
    val microphonePermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(), model::microphonePermissionResult,
    )
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val expanded = maxWidth >= 760.dp
        val sidebarWidth = (maxWidth * 0.24f).coerceIn(240.dp, 320.dp)
        val drawerHeight = minOf(310.dp, maxHeight * 0.46f)
        LaunchedEffect(expanded) { if (expanded) drawer = false }
        BackHandler(enabled = !expanded && drawer) { drawer = false }
        Row(Modifier.fillMaxSize()) {
            if (expanded) {
                WorkspaceChannels(model, member, Modifier.width(sidebarWidth).fillMaxHeight(),
                    openStaffPanel = model::openStaffPanel, onChannelSelected = { focus.clearFocus() })
                VerticalDivider(color = Line)
            }
            Column(Modifier.weight(1f).fillMaxHeight()) {
                WorkspaceHeader(state, expanded, drawer) { focus.clearFocus(); drawer = !drawer }
                val connectionProblem = state.connectionProblem
                if (connectionProblem != null) {
                    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(copy(connectionProblem), Modifier.weight(1f), color = Danger, fontSize = 12.sp)
                        TextButton(onClick = model.client::reconnect, enabled = !state.busy) { Text(copy("reconnect")) }
                    }
                } else if (!state.connected) {
                    Text(copy("connecting"), color = Muted, fontSize = 12.sp,
                        modifier = Modifier.padding(start = 16.dp, bottom = 5.dp))
                }
                HorizontalDivider(color = Line)
                AnimatedVisibility(!expanded && drawer) {
                    Column {
                        WorkspaceChannels(model, member, Modifier.fillMaxWidth().heightIn(max = drawerHeight),
                            openStaffPanel = model::openStaffPanel, onChannelSelected = { drawer = false })
                        HorizontalDivider(color = Line)
                    }
                }
                Chat(model, Modifier.weight(1f))
                state.voice?.let { voice ->
                    HorizontalDivider(color = Line)
                    Row(Modifier.fillMaxWidth().background(Navigation).padding(horizontal = 12.dp, vertical = 3.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(voice.channel.name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(copy(if (!voice.connected) "connecting" else if (voice.microphone) "micActive" else "micMuted"),
                                color = Muted, fontSize = 12.sp, maxLines = 1)
                        }
                        IconButton(enabled = voice.connected && voice.canPublish && !voice.deafened, onClick = {
                            if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                                model.toggleMic()
                            } else if (model.prepareMicrophonePermission()) {
                                microphonePermission.launch(Manifest.permission.RECORD_AUDIO)
                            }
                        }) { Glyph(if (voice.microphone) R.drawable.yapper_mic else R.drawable.yapper_mic_off,
                            if (voice.microphone) Accent else Foreground, copy(if (voice.microphone) "micOn" else "micOff")) }
                        IconButton(onClick = model::toggleDeafen) { Glyph(R.drawable.yapper_headphones,
                            if (voice.deafened) Accent else Muted, copy(if (voice.deafened) "undeafen" else "deafen")) }
                        IconButton(onClick = { audioPanel = true }) { Glyph(R.drawable.yapper_sliders_horizontal, label = copy("audioSettings")) }
                        IconButton(onClick = model::leaveVoice) { Glyph(R.drawable.yapper_phone_off, Danger, copy("leaveVoice")) }
                    }
                }
            }
        }
    }
    model.staffPanel?.let { panel ->
        ModalBottomSheet(onDismissRequest = model::closeStaffPanel, containerColor = Background) {
            StaffSettings(model, panel)
        }
    }
    val audio = state.voice
    if (audioPanel && audio != null) ModalBottomSheet(onDismissRequest = { audioPanel = false }, containerColor = Background) {
        Column(Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState()).padding(18.dp)) {
            Text(copy("audioSettings"), fontSize = 19.sp, fontWeight = FontWeight.Bold)
            if (model.audioDevices.isNotEmpty()) {
                Text(copy("outputDevice"), color = Muted, modifier = Modifier.padding(top = 8.dp))
                model.audioDevices.forEach { device ->
                    val label = when (device) {
                        is AudioDevice.Speakerphone -> copy("speaker")
                        is AudioDevice.Earpiece -> copy("earpiece")
                        is AudioDevice.WiredHeadset -> copy("wiredHeadset")
                        else -> device.name
                    }
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable { model.selectAudio(device) },
                        verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = device == model.audioOutput, onClick = null)
                        Text(label, Modifier.padding(start = 10.dp))
                    }
                }
            }
            Text(copy("participants"), fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 10.dp))
            audio.peers.forEach { peer ->
                val speaking = copy("speaking")
                Text(if (peer.local) "${peer.name} · ${copy("you")}" else peer.name,
                    color = if (peer.speaking) Accent else Foreground,
                    modifier = Modifier.semantics { if (peer.speaking) stateDescription = speaking })
                if (!peer.local) {
                    var level by remember(peer.id) { mutableFloatStateOf(model.volume(peer.id)) }
                    val volumeLabel = "${copy("volume")} · ${peer.name}"
                    Slider(value = level, onValueChange = { level = it; model.changeVolume(peer.id, it) },
                        modifier = Modifier.padding(bottom = 6.dp).semantics { contentDescription = volumeLabel })
                }
            }
            if (audio.peers.isEmpty()) Text(copy("noResults"), color = Muted, modifier = Modifier.padding(vertical = 12.dp))
        }
    }
}

@Composable
private fun WorkspaceHeader(state: MobileState, expanded: Boolean, drawer: Boolean, toggleDrawer: () -> Unit) {
    val navigationAction = if (expanded) Modifier else Modifier.clickable(onClick = toggleDrawer)
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).then(navigationAction).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
        if (!expanded) Glyph(R.drawable.yapper_panel_left, label = copy("channels"))
        if (state.channel != null) Glyph(R.drawable.yapper_hash, size = 17)
        Text(state.channel?.name ?: copy("channels"), Modifier.weight(1f),
            fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (!expanded) Glyph(R.drawable.yapper_chevron_down, size = 17, modifier = Modifier.rotate(if (drawer) 180f else 0f))
    }
}

@Composable
private fun WorkspaceChannels(
    model: MobileModel,
    member: Membership,
    modifier: Modifier,
    openStaffPanel: () -> Unit,
    onChannelSelected: () -> Unit,
) {
    val state = model.state
    var options by remember { mutableStateOf(false) }
    val channelsEnabled = !state.busy && state.connectionProblem == null
    LazyColumn(modifier.background(Navigation)) {
        item(key = "server") {
            Row(Modifier.fillMaxWidth().padding(start = 14.dp, end = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(state.installation?.name.orEmpty(), fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(member.participant.nickname, fontSize = 12.sp, color = Muted)
                }
                Language(model)
                Box {
                    IconButton(onClick = { options = true }) {
                        Glyph(R.drawable.yapper_sliders_horizontal, label = copy("preferences"))
                    }
                    DropdownMenu(expanded = options, onDismissRequest = { options = false }) {
                        if (member.participant.role in setOf("owner", "moderator")) {
                            DropdownMenuItem(text = { Text(copy("admissionSettings")) }, onClick = { options = false; openStaffPanel() })
                        }
                        DropdownMenuItem(text = { Text(copy("changeServer")) }, onClick = {
                            options = false; model.leaveVoice(); model.client.switchServer()
                        })
                        if (member.account) DropdownMenuItem(text = { Text(copy("signOut")) }, onClick = {
                            options = false; model.leaveVoice(); model.client.signOut()
                        })
                    }
                }
            }
        }
        for (group in member.channelGroups) {
            if (group.category.name.isNotEmpty()) item(key = "category:${group.category.id}") {
                Text(group.category.name, Modifier.padding(start = 14.dp, top = 8.dp), color = Muted)
            }
            for ((kind, channels) in listOf("text" to group.text, "voice" to group.voice)) {
                if (channels.isEmpty()) continue
                item(key = "heading:${group.category.id}:$kind") {
                    Text(copy(if (kind == "text") "textChannels" else "voiceChannels"),
                        Modifier.padding(start = 14.dp, top = 6.dp), fontSize = 12.sp, color = Muted)
                }
                items(channels, key = { "channel:${it.id}" }) { channel ->
                    ChannelRow(channel, state.channel?.id == channel.id || state.voice?.channel?.id == channel.id,
                        enabled = channelsEnabled) {
                        if (kind == "text") model.client.select(channel) else model.joinVoice(channel)
                        onChannelSelected()
                    }
                }
            }
        }
    }
}

@Composable
private fun ChannelRow(channel: Channel, selected: Boolean, enabled: Boolean, choose: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 1.dp).clip(RoundedCornerShape(7.dp))
        .background(if (selected) Selected else Navigation).clickable(enabled = enabled, role = Role.Button, onClick = choose)
        .semantics { this.selected = selected }.heightIn(min = 44.dp)
        .padding(horizontal = 9.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Glyph(if (channel.kind == "text") R.drawable.yapper_hash else R.drawable.yapper_volume_2,
            if (selected) Accent else Muted, size = 16)
        Text(channel.name, Modifier.weight(1f), color = if (selected) Foreground else Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (channel.archived) Text(copy("archived"), fontSize = 11.sp, color = Muted)
    }
}

@Composable
private fun Chat(model: MobileModel, modifier: Modifier) {
    val state = model.state
    val channel = state.channel
    val me = state.membership?.participant
    val list = key(channel?.id) { rememberLazyListState() }
    var draft by rememberSaveable(channel?.id) { mutableStateOf("") }
    var delete by remember(channel?.id) { mutableStateOf<Message?>(null) }
    val messages = state.messages
    var previousLatest by remember(list) { mutableLongStateOf(0L) }
    SideEffect {
        val latest = messages?.lastOrNull()?.sequence ?: 0L
        if (previousLatest > 0 && latest > previousLatest && !list.canScrollBackward) {
            // Override key anchoring only when the reader was already at the newest end.
            list.requestScrollToItem(0)
        }
        previousLatest = latest
    }
    val actionsAllowed = !state.busy && state.connectionProblem == null
    val times = remember(model.locale) {
        DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)
            .withLocale(Locale.forLanguageTag(model.locale)).withZone(ZoneId.systemDefault())
    }
    Column(modifier.fillMaxWidth()) {
        if (channel == null || messages == null || messages.isEmpty() && !state.hasOlder) {
            Box(Modifier.weight(1f).fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    if (channel != null && messages != null) {
                        Box(Modifier.size(54.dp).clip(RoundedCornerShape(11.dp)).background(Selected), contentAlignment = Alignment.Center) {
                            Glyph(R.drawable.yapper_hash, size = 26)
                        }
                        Spacer(Modifier.height(12.dp))
                    }
                    Text(copy(if (channel == null) "noChannels" else if (messages == null) "loadingHistory" else "emptyChat"),
                        fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    if (channel != null && messages != null) Text(copy("emptyChatDescription"), color = Muted, fontSize = 13.sp)
                }
            }
        } else {
            LazyColumn(state = list, reverseLayout = true, contentPadding = PaddingValues(vertical = 10.dp),
                modifier = Modifier.weight(1f).fillMaxWidth()) {
                items(messages.asReversed(), key = { it.id }) { message ->
                    val own = message.authorId == me?.id
                    val mayDelete = own || me?.role in setOf("owner", "moderator")
                    Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 5.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Box(Modifier.size(34.dp).clip(CircleShape).background(Selected), contentAlignment = Alignment.Center) {
                            Text(message.nickname.take(1).uppercase(), color = Foreground, fontWeight = FontWeight.SemiBold)
                        }
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                                Text(message.nickname, Modifier.weight(1f, fill = false), fontSize = 13.sp,
                                    maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Bold)
                                if (own && !channel.archived) IconButton(enabled = actionsAllowed, onClick = { model.openMessageEdit(message) }, modifier = Modifier.size(44.dp)) {
                                    Glyph(R.drawable.yapper_pencil, label = copy("editMessage"), size = 16)
                                }
                                if (mayDelete) IconButton(enabled = actionsAllowed, onClick = { delete = message }, modifier = Modifier.size(44.dp)) {
                                    Glyph(R.drawable.yapper_trash_2, label = copy("deleteMessage"), size = 16)
                                }
                                val time = remember(message.createdAt, times) {
                                    runCatching { times.format(Instant.parse(message.createdAt)) }.getOrNull()
                                }
                                if (time != null) Text(time, color = Muted, fontSize = 11.sp, maxLines = 1)
                                if (message.editedAt != null) Text(copy("messageEdited"), color = Muted, fontSize = 11.sp)
                            }
                            Text(message.body, color = Foreground, fontSize = 15.sp)
                        }
                    }
                }
                if (state.hasOlder) item {
                    TextButton(onClick = model.client::loadOlder, enabled = actionsAllowed, modifier = Modifier.fillMaxWidth()) {
                        Text(copy("loadOlder"))
                    }
                }
            }
        }
        val error = model.localError ?: state.error
        error?.let { Row(Modifier.fillMaxWidth().padding(start = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(copy(it), Modifier.weight(1f), color = Danger, fontSize = 13.sp)
            TextButton(onClick = { model.localError = null; model.client.dismissError() }) { Text(copy("dismiss")) }
        } }
        if (channel?.archived == true) {
            Text(copy("archivedNotice"), color = Muted, modifier = Modifier.padding(14.dp), fontSize = 13.sp)
        } else if (channel != null) {
            HorizontalDivider(color = Line)
            Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(draft, { draft = it }, placeholder = { Text(copy("messagePlaceholder")) },
                    enabled = state.connectionProblem == null, modifier = Modifier.weight(1f), maxLines = 4,
                    shape = RoundedCornerShape(9.dp), isError = messageLength(draft) > 2000,
                    supportingText = if (messageLength(draft) > 2000) ({ Text(copy("invalid_message")) }) else null)
                IconButton(enabled = validMessage(draft) && actionsAllowed, onClick = {
                    val sent = draft
                    model.client.send(sent) { success -> if (success && draft == sent) draft = "" }
                }) { Glyph(R.drawable.yapper_arrow_right, Accent, copy("send")) }
            }
        }
    }
    model.messageEdit?.let { edit ->
        AlertDialog(onDismissRequest = model::closeMessageEdit, title = { Text(copy("editMessage")) },
            text = {
                val invalid = messageLength(edit.body) > 2000
                OutlinedTextField(edit.body, { edit.body = it }, maxLines = 6, isError = invalid,
                    supportingText = if (invalid) ({ Text(copy("invalid_message")) }) else null)
            },
            confirmButton = { TextButton(enabled = actionsAllowed && validMessage(edit.body), onClick = {
                model.client.edit(edit.message, edit.body) { if (it && model.messageEdit === edit) model.closeMessageEdit() }
            }) { Text(copy("save")) } },
            dismissButton = { TextButton(onClick = model::closeMessageEdit) { Text(copy("cancel")) } })
    }
    delete?.let { message ->
        AlertDialog(onDismissRequest = { delete = null }, title = { Text(copy("deleteMessage")) },
            text = { Text(copy("confirmMessageDelete")) },
            confirmButton = { TextButton(enabled = actionsAllowed, onClick = { model.client.delete(message); delete = null }) {
                Text(copy("deleteMessage"), color = Danger)
            } },
            dismissButton = { TextButton(onClick = { delete = null }) { Text(copy("cancel")) } })
    }
}
