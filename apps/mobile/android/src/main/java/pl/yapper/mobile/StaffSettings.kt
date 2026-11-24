package pl.yapper.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import yapper.StaffOption
import yapper.StaffPage
import yapper.applyStaff
import yapper.staffPage
import yapper.staffSections

internal class StaffPanelState {
    var section by mutableStateOf("")
    var cursor by mutableStateOf("")
    var page by mutableStateOf<StaffPage?>(null)
    var form by mutableStateOf<StaffActionForm?>(null)
    var invitation by mutableStateOf<String?>(null)
    var error by mutableStateOf<String?>(null)
}

internal class StaffActionForm(val action: StaffOption) {
    val inputs = action.fields.map { it.value }.toMutableStateList()
}

@Composable
internal fun StaffSettings(model: MobileModel, panel: StaffPanelState) {
    val role = model.state.membership?.participant?.role.orEmpty()
    val section = panel.section
    val cursor = panel.cursor
    val busy = model.state.busy
    LaunchedEffect(panel, section, cursor, panel.page == null, busy) {
        if (section.isNotEmpty() && !busy && panel.page == null) {
            model.client.staffPage(section, cursor, model.locale) {
                if (model.staffPanel === panel && panel.section == section && panel.cursor == cursor) panel.page = it
            }
        }
    }
    LazyColumn(Modifier.fillMaxWidth().heightIn(max = 510.dp), contentPadding = PaddingValues(16.dp)) {
        item {
            Text(copy(if (section.isEmpty()) "preferences" else section), fontSize = 22.sp, fontWeight = FontWeight.Bold)
            if (section.isNotEmpty()) TextButton(onClick = { panel.section = ""; panel.cursor = ""; panel.page = null }) { Text(copy("back")) }
            panel.error?.let { Text(copy(it), color = Danger) }
        }
        if (section.isEmpty()) {
            items(staffSections(role)) { item ->
                TextButton(onClick = { panel.section = item; panel.page = null; panel.error = null }) { Text(copy(item)) }
            }
        } else {
            val current = panel.page
            if (current == null) item { CircularProgressIndicator(Modifier.size(24.dp)) }
            else {
                current.error?.let { item { Text(copy(it), color = Danger) } }
                items(current.items) { item ->
                    HorizontalDivider(color = Line)
                    Text(item.title, Modifier.padding(top = 9.dp), fontWeight = FontWeight.SemiBold)
                    if (item.detail.isNotEmpty()) Text(item.detail, color = Muted, fontSize = 12.sp)
                    item.actions.forEach { action ->
                        TextButton(onClick = {
                            if (action.key == "more") {
                                panel.cursor = action.subject
                                panel.page = null
                            } else panel.form = StaffActionForm(action)
                        }, enabled = !model.state.busy) { Text(action.label) }
                    }
                }
            }
        }
    }
    panel.form?.let { form ->
        val action = form.action
        val inputs = form.inputs
        fun submit(values: List<String>) {
            model.client.applyStaff(action, values) { result ->
                if (model.staffPanel === panel && panel.form === form) {
                    panel.error = result.error
                    panel.invitation = result.value
                    if (result.error == null) panel.page = null
                    panel.form = null
                }
            }
        }
        AlertDialog(onDismissRequest = { if (!busy) panel.form = null }, title = { Text(action.label) },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    action.fields.forEachIndexed { index, field ->
                        Field(copy(field.label), inputs[index], { inputs[index] = it },
                            password = field.kind == "password",
                            keyboard = if (field.kind == "number") KeyboardType.Number else KeyboardType.Text)
                    }
                    if (action.key == "moveCategory") {
                        TextButton(enabled = !busy, onClick = { submit(listOf("")) }) { Text(copy("uncategorized")) }
                        model.state.membership?.categories.orEmpty().forEach { category ->
                            TextButton(enabled = !busy, onClick = { submit(listOf(category.id)) }) { Text(category.name) }
                        }
                    }
                }
            },
            confirmButton = {
                if (action.key != "moveCategory") TextButton(enabled = !model.state.busy,
                    onClick = { submit(inputs.toList()) }) { Text(copy("save")) }
            },
            dismissButton = { TextButton(enabled = !busy, onClick = { panel.form = null }) { Text(copy("cancel")) } })
    }
    panel.invitation?.let { token ->
        AlertDialog(onDismissRequest = { panel.invitation = null }, title = { Text(copy("invitationCode")) },
            text = { SelectionContainer { Text(token) } },
            confirmButton = { TextButton(onClick = { panel.invitation = null }) { Text(copy("dismiss")) } })
    }
}
