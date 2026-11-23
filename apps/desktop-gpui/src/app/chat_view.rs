use super::{
    Yapper,
    appearance::{
        ACCENT, CONTROL_LINE, DANGER, DANGER_SURFACE, HOVER, LINE, MUTED, NAVIGATION, PANEL,
        SELECTED, icon, outline_button,
    },
    chat::{Chat, MAX_MESSAGE_LENGTH},
};
use crate::server::{Admission, Channel, Message};
use gpui::prelude::*;
use gpui::{
    App, Context, Div, Focusable, FontWeight, MouseButton, SharedString, Window, div, px, rgb, rgba,
};
use gpui_component::{
    Disableable, WindowExt,
    button::{Button, ButtonCustomVariant, ButtonVariants},
    input::Input,
    menu::{DropdownMenu, PopupMenuItem},
};

impl Yapper {
    pub(super) fn text_channel(
        &self,
        channel: &Channel,
        height: f32,
        cx: &mut Context<Self>,
    ) -> Div {
        let id = channel.id.clone();
        let selected = self.chat.as_ref().is_some_and(|chat| chat.channel_id == id);
        let button = Button::new(SharedString::from(format!("text-channel-{id}")))
            .custom(
                ButtonCustomVariant::new(cx)
                    .hover(rgb(HOVER).into())
                    .active(rgb(SELECTED).into()),
            )
            .w_full()
            .h(px(height))
            .justify_start()
            .px(px(7.))
            .when(selected, |button| button.bg(rgb(SELECTED)))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(10.))
                    .min_w(px(0.))
                    .child(icon("icons/hash.svg", 16., MUTED))
                    .child(
                        div()
                            .truncate()
                            .text_size(px(13.))
                            .child(channel.name.clone()),
                    )
                    .into_any_element(),
            )
            .on_click(
                cx.listener(move |app, _, window, cx| app.select_text(id.clone(), window, cx)),
            );
        div().relative().child(button).when(selected, |row| {
            row.child(
                div()
                    .absolute()
                    .left_0()
                    .top(px(4.))
                    .w(px(2.))
                    .h(px(height - 8.))
                    .rounded_full()
                    .bg(rgb(ACCENT)),
            )
        })
    }

    pub(super) fn selected_text<'a>(&self, guest: &'a Admission) -> Option<&'a Channel> {
        let chat = self.chat.as_ref()?;
        guest
            .membership
            .channels
            .iter()
            .find(|channel| channel.id == chat.channel_id)
    }

    pub(super) fn chat_view(
        &self,
        guest: &Admission,
        chat: &Chat,
        channel: &Channel,
        gutter: f32,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> Div {
        let copy = self.language.copy();
        let editing_in_history = chat.edit.as_ref().is_some_and(|edit| {
            !channel.archived
                && chat
                    .messages
                    .as_ref()
                    .is_some_and(|messages| messages.iter().any(|message| message.id == edit.id))
        });
        div()
            .flex_1()
            .min_h(px(0.))
            .min_w(px(0.))
            .flex()
            .flex_col()
            .child(
                div()
                    .id("message-history")
                    .flex_1()
                    .min_h(px(0.))
                    .overflow_y_scroll()
                    .track_scroll(&chat.scroll)
                    .px(px(gutter))
                    .pt(px(16.))
                    .pb(px(12.))
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|app, _, window, _| {
                            if app.chat.as_ref().is_none_or(|chat| chat.edit.is_none()) {
                                window.focus(&app.workspace_focus);
                            }
                        }),
                    )
                    .when_some(chat.messages.as_ref(), |history, messages| {
                        history
                            .when(messages.is_empty() && chat.before == 0, |history| {
                                history.child(
                                    div()
                                        .pt(px(44.))
                                        .child(
                                            div()
                                                .flex()
                                                .items_center()
                                                .justify_center()
                                                .size(px(44.))
                                                .rounded(px(10.))
                                                .bg(rgb(HOVER))
                                                .child(icon("icons/hash.svg", 28., MUTED)),
                                        )
                                        .child(
                                            div()
                                                .mt(px(12.))
                                                .text_size(px(24.))
                                                .child(copy.empty_chat),
                                        )
                                        .child(status(copy.empty_chat_description).mt(px(6.))),
                                )
                            })
                            .when(chat.before != 0, |history| {
                                history.child(
                                    outline_button("load-older", cx)
                                        .label(copy.load_older)
                                        .disabled(chat.loading_older)
                                        .on_click(cx.listener(|app, _, _, cx| app.load_older(cx))),
                                )
                            })
                            .children(messages.iter().map(|message| {
                                self.message_row(message, guest, chat, channel.archived, window, cx)
                            }))
                    })
                    .when(chat.messages.is_none() && chat.error.is_none(), |history| {
                        history.child(status(copy.loading_chat))
                    }),
            )
            .child(
                div()
                    .flex_none()
                    .flex()
                    .flex_col()
                    .gap(px(6.))
                    .px(px(gutter))
                    .pb(px(12.))
                    .children(
                        chat.error
                            .map(|err| status(self.language.failure(err)).text_color(rgb(DANGER))),
                    )
                    .children(self.render_error())
                    .when(!guest.saved, |area| area.child(status(copy.unsaved)))
                    .when(channel.archived, |area| {
                        area.child(status(copy.archived_chat))
                    })
                    .when(!channel.archived && !editing_in_history, |area| {
                        let composer = self.composer(chat, window, cx);
                        area.child(if chat.edit.is_some() {
                            message_action_panel(ACCENT).child(composer)
                        } else {
                            composer
                        })
                    }),
            )
    }

    fn composer(&self, chat: &Chat, window: &Window, cx: &mut Context<Self>) -> Div {
        let copy = self.language.copy();
        let input = self.message_input.read(cx);
        let focused = input.focus_handle(cx).is_focused(window);
        let value = input.value();
        let body = value.trim();
        let too_long = body.chars().count() > MAX_MESSAGE_LENGTH;
        let editing = chat.edit.is_some();
        let submit = outline_button("send-message", cx)
            .label(if editing { copy.save_edit } else { copy.send })
            .when(editing, |button| button.font_weight(FontWeight::SEMIBOLD))
            .disabled(chat.sending || body.is_empty() || too_long)
            .on_click(cx.listener(|app, _, window, cx| app.send_chat(window, cx)));
        let field = div()
            .flex()
            .items_center()
            .gap(px(14.))
            .rounded(px(10.))
            .border_1()
            .border_color(rgb(if focused { ACCENT } else { CONTROL_LINE }))
            .bg(rgb(if editing { NAVIGATION } else { PANEL }))
            .px(px(14.))
            .py(px(8.))
            .child(
                div()
                    .flex_1()
                    .min_w(px(0.))
                    .child(Input::new(&self.message_input).appearance(false)),
            );
        let area = div()
            .flex()
            .flex_col()
            .gap(px(if editing { 10. } else { 6. }));
        let area = if editing {
            area.child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_size(px(14.))
                    .child(icon("icons/pencil.svg", 15., ACCENT))
                    .child(copy.edit_message),
            )
            .child(field)
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .justify_end()
                    .gap(px(8.))
                    .child(
                        outline_button("cancel-edit", cx)
                            .label(copy.cancel)
                            .disabled(chat.sending)
                            .on_click(cx.listener(|app, _, window, cx| {
                                app.cancel_edit(window, cx);
                            })),
                    )
                    .child(submit),
            )
        } else {
            area.child(field.child(submit))
        };
        area.when(too_long, |area| {
            area.child(status(copy.message_too_long).text_color(rgb(DANGER)))
        })
        .children(
            chat.send_error
                .map(|err| status(self.language.failure(err)).text_color(rgb(DANGER))),
        )
    }

    fn message_row(
        &self,
        message: &Message,
        guest: &Admission,
        chat: &Chat,
        archived: bool,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> Div {
        let own = guest.membership.participant.id == message.author_id;
        let staff = matches!(
            guest.membership.participant.role.as_str(),
            "owner" | "moderator"
        );
        let copy = self.language.copy();
        let editing = !archived && chat.edit.as_ref().is_some_and(|edit| edit.id == message.id);
        let deleting = chat.delete_confirmation.as_ref() == Some(&message.id);
        let header = div()
            .flex()
            .items_center()
            .gap(px(2.))
            .min_w(px(0.))
            .min_h(px(24.))
            .child(
                div()
                    .min_w(px(0.))
                    .text_size(px(13.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .truncate()
                    .child(message.nickname.clone()),
            )
            .when(staff && !own, |header| {
                header.child(self.moderation_button(message, cx))
            })
            .when(own && !archived, |header| {
                let id = message.id.clone();
                header.child(
                    message_icon_button(
                        format!("message-edit-{id}"),
                        "icons/pencil.svg",
                        copy.edit_message,
                        ACCENT,
                        chat.sending,
                        cx,
                    )
                    .on_click(cx.listener(move |app, _, window, cx| {
                        app.edit_message(&id, window, cx);
                    })),
                )
            })
            .when(own || staff, |header| {
                let id = message.id.clone();
                header.child(
                    message_icon_button(
                        format!("message-delete-{id}"),
                        "icons/trash-2.svg",
                        copy.delete_message,
                        DANGER,
                        chat.sending,
                        cx,
                    )
                    .on_click(cx.listener(move |app, _, window, cx| {
                        app.cancel_edit(window, cx);
                        if let Some(chat) = &mut app.chat {
                            chat.delete_confirmation = Some(id.clone());
                            cx.notify();
                        }
                    })),
                )
            });
        message_row(
            message,
            div()
                .flex_1()
                .min_w(px(0.))
                .child(header)
                .when(!editing, |content| {
                    content.child(
                        div()
                            .mt(px(5.))
                            .text_size(px(14.))
                            .line_height(px(22.))
                            .child(message.body.clone()),
                    )
                })
                .when(editing, |content| {
                    content
                        .child(message_action_panel(ACCENT).child(self.composer(chat, window, cx)))
                })
                .when(deleting, |content| {
                    content.child(self.delete_panel(&message.id, cx))
                }),
        )
    }

    fn delete_panel(&self, id: &str, cx: &mut Context<Self>) -> Div {
        let copy = self.language.copy();
        let id = id.to_owned();
        message_action_panel(DANGER)
            .child(div().text_size(px(14.)).child(copy.confirm_message_delete))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap(px(8.))
                    .child(
                        Button::new("confirm-delete")
                            .custom(
                                ButtonCustomVariant::new(cx)
                                    .foreground(rgb(DANGER).into())
                                    .color(rgb(DANGER_SURFACE).into())
                                    .hover(rgb(HOVER).into()),
                            )
                            .label(copy.delete_message)
                            .on_click(cx.listener(move |app, _, _, cx| {
                                app.confirm_message_delete(&id, cx);
                            })),
                    )
                    .child(
                        Button::new("cancel-delete")
                            .ghost()
                            .label(copy.cancel)
                            .on_click(cx.listener(|app, _, _, cx| {
                                if let Some(chat) = &mut app.chat {
                                    chat.delete_confirmation = None;
                                    cx.notify();
                                }
                            })),
                    ),
            )
    }

    fn moderation_button(&self, message: &Message, cx: &mut Context<Self>) -> impl IntoElement {
        let copy = self.language.copy();
        let app = cx.weak_entity();
        let id = message.id.clone();
        let author = message.author_id.clone();
        message_icon_button(
            format!("message-moderate-{id}"),
            "icons/shield.svg",
            copy.moderate_participant,
            ACCENT,
            false,
            cx,
        )
        .dropdown_menu(move |mut menu, _, _| {
            for (action, label) in [
                ("kick", copy.kick),
                ("mute", copy.force_mute),
                ("unmute", copy.remove_mute),
                ("ban", copy.ban),
            ] {
                menu = menu.item(confirm_item(
                    label,
                    copy,
                    app.clone(),
                    author.clone(),
                    action,
                ));
            }
            menu
        })
    }
}

fn confirm_item(
    label: &'static str,
    copy: &'static crate::copy::Copy,
    app: gpui::WeakEntity<Yapper>,
    target: String,
    moderation: &'static str,
) -> PopupMenuItem {
    PopupMenuItem::new(label).on_click(move |_, window, cx| {
        let target = target.clone();
        let app = app.clone();
        window.open_dialog(cx, move |dialog, _, _| {
            let app = app.clone();
            let target = target.clone();
            dialog
                .title(label)
                .confirm()
                .button_props(
                    gpui_component::dialog::DialogButtonProps::default()
                        .ok_text(copy.confirm)
                        .cancel_text(copy.cancel),
                )
                .on_ok(move |_, _, cx| {
                    let _ = app.update(cx, |app, cx| {
                        app.message_action(target.clone(), Some(moderation), cx)
                    });
                    true
                })
        });
    })
}

fn status(text: &'static str) -> Div {
    div()
        .text_size(px(13.))
        .line_height(px(21.))
        .text_color(rgb(MUTED))
        .child(text)
}

fn message_icon_button(
    id: String,
    glyph: &'static str,
    label: &'static str,
    accent: u32,
    disabled: bool,
    cx: &App,
) -> Button {
    let group = SharedString::from(id);
    Button::new(group.clone())
        .group(group.clone())
        .custom(
            ButtonCustomVariant::new(cx)
                .hover(rgba((accent << 8) | 0x38).into())
                .active(rgba((accent << 8) | 0x55).into()),
        )
        .flex_none()
        .size(px(32.))
        .p_0()
        .when(!disabled, |button| button.cursor_pointer())
        .disabled(disabled)
        .child(
            icon(glyph, 14., MUTED)
                .when(!disabled, |glyph| {
                    glyph.group_hover(group, |style| style.text_color(rgb(accent)))
                })
                .into_any_element(),
        )
        .tooltip(label)
}

fn message_action_panel(accent: u32) -> Div {
    div()
        .relative()
        .mt(px(10.))
        .w_full()
        .max_w(px(544.))
        .min_w(px(0.))
        .flex()
        .flex_col()
        .gap(px(12.))
        .px(px(14.))
        .py(px(12.))
        .rounded(px(8.))
        .border_1()
        .border_color(rgb(LINE))
        .bg(rgb(PANEL))
        .child(
            div()
                .absolute()
                .left_0()
                .top(px(5.))
                .bottom(px(5.))
                .w(px(3.))
                .rounded_full()
                .bg(rgb(accent)),
        )
}

fn message_row(message: &Message, content: Div) -> Div {
    let initial: String = message
        .nickname
        .chars()
        .take(1)
        .flat_map(char::to_uppercase)
        .collect();
    div()
        .flex()
        .gap(px(13.))
        .py(px(10.))
        .child(
            div()
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .size(px(34.))
                .rounded_full()
                .bg(rgb(SELECTED))
                .font_weight(FontWeight::SEMIBOLD)
                .text_size(px(13.))
                .child(initial),
        )
        .child(content)
}
