use super::{
    Yapper,
    appearance::{
        ACCENT, CONTROL_LINE, DANGER, HOVER, MUTED, PANEL, SELECTED, icon, outline_button,
    },
    chat::{Chat, MAX_MESSAGE_LENGTH},
};
use crate::server::{Admission, Channel, Message};
use gpui::prelude::*;
use gpui::{Context, Div, Focusable, FontWeight, MouseButton, SharedString, Window, div, px, rgb};
use gpui_component::{
    Disableable,
    button::{Button, ButtonCustomVariant, ButtonVariants},
    input::Input,
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
                            window.focus(&app.workspace_focus);
                        }),
                    )
                    .when_some(chat.messages.as_ref(), |history, messages| {
                        history
                            .when(messages.is_empty(), |history| {
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
                            .children(messages.iter().map(message_row))
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
                    .when(!channel.archived, |area| {
                        area.child(self.composer(chat, window, cx))
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
        div()
            .flex()
            .flex_col()
            .gap(px(6.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(14.))
                    .rounded(px(10.))
                    .border_1()
                    .border_color(rgb(if focused { ACCENT } else { CONTROL_LINE }))
                    .bg(rgb(PANEL))
                    .px(px(14.))
                    .py(px(8.))
                    .child(
                        div()
                            .flex_1()
                            .min_w(px(0.))
                            .child(Input::new(&self.message_input).appearance(false)),
                    )
                    .child(
                        outline_button("send-message", cx)
                            .label(copy.send)
                            .disabled(chat.sending || body.is_empty() || too_long)
                            .on_click(cx.listener(|app, _, window, cx| app.send_chat(window, cx))),
                    ),
            )
            .when(too_long, |area| {
                area.child(status(copy.message_too_long).text_color(rgb(DANGER)))
            })
            .children(
                chat.send_error
                    .map(|err| status(self.language.failure(err)).text_color(rgb(DANGER))),
            )
    }
}

fn status(text: &'static str) -> Div {
    div()
        .text_size(px(13.))
        .line_height(px(21.))
        .text_color(rgb(MUTED))
        .child(text)
}

fn message_row(message: &Message) -> Div {
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
        .child(
            div()
                .flex_1()
                .min_w(px(0.))
                .child(
                    div()
                        .text_size(px(13.))
                        .font_weight(FontWeight::SEMIBOLD)
                        .truncate()
                        .child(message.nickname.clone()),
                )
                .child(
                    div()
                        .mt(px(5.))
                        .text_size(px(14.))
                        .line_height(px(22.))
                        .child(message.body.clone()),
                ),
        )
}
