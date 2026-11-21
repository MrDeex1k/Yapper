use super::Yapper;
use crate::server::{Failure, Message};
use gpui::{Context, ScrollHandle, Window, px};
use std::time::Duration;
use uuid::Uuid;

const REFRESH_INTERVAL: Duration = Duration::from_secs(2);
const CATALOG_REFRESH_INTERVAL: Duration = Duration::from_secs(5);
pub(super) const MAX_MESSAGE_LENGTH: usize = 2000;

pub(super) struct Chat {
    pub(super) channel_id: String,
    pub(super) generation: Uuid,
    pub(super) messages: Option<Vec<Message>>,
    pub(super) error: Option<Failure>,
    pub(super) send_error: Option<Failure>,
    pub(super) sending: bool,
    pub(super) scroll: ScrollHandle,
    retry: Option<(String, Uuid)>,
    draft: String,
}

impl Yapper {
    pub(super) fn open_default_text(&mut self, cx: &mut Context<Self>) {
        if self.chat.is_some() {
            return;
        }
        if let Some(id) = self
            .guest
            .as_ref()
            .and_then(|guest| {
                guest
                    .membership
                    .channels
                    .iter()
                    .find(|channel| channel.kind == "text" && !channel.archived)
                    .or_else(|| {
                        guest
                            .membership
                            .channels
                            .iter()
                            .find(|channel| channel.kind == "text")
                    })
            })
            .map(|channel| channel.id.clone())
        {
            self.open_text(id, cx);
        }
    }

    pub(super) fn select_text(&mut self, id: String, window: &mut Window, cx: &mut Context<Self>) {
        self.channels_open = false;
        window.focus(&self.workspace_focus);
        if self.chat.as_ref().is_some_and(|chat| chat.channel_id == id) {
            cx.notify();
            return;
        }
        if let Some(mut chat) = self.chat.take() {
            chat.draft = self.message_input.read(cx).value().to_string();
            self.inactive_chats.insert(chat.channel_id.clone(), chat);
        }
        self.open_text(id, cx);
        if let Some(chat) = &self.chat {
            self.message_input.update(cx, |input, cx| {
                input.set_value(chat.draft.clone(), window, cx);
            });
        }
    }

    fn open_text(&mut self, id: String, cx: &mut Context<Self>) {
        let Some(guest) = &self.guest else { return };
        let session = guest.session.clone();
        let chat = self.inactive_chats.remove(&id).unwrap_or_else(|| Chat {
            channel_id: id.clone(),
            generation: Uuid::new_v4(),
            messages: None,
            error: None,
            send_error: None,
            sending: false,
            scroll: ScrollHandle::new(),
            retry: None,
            draft: String::new(),
        });
        let generation = chat.generation;
        self.chat = Some(chat);

        let refresh = self.chat_refresh.clone();
        let runtime = self.runtime.clone();
        // One authoritative fetch at a time avoids a stale response overwriting fresher history.
        self.chat_task = Some(cx.spawn(async move |this, cx| {
            loop {
                let session = session.clone();
                let channel_id = id.clone();
                let result = runtime
                    .spawn(async move { session.timeline(&channel_id).await })
                    .await
                    .unwrap_or(Err(Failure::Network));
                let keep_open = this
                    .update(cx, |app, cx| {
                        let Some(chat) = app
                            .chat
                            .as_mut()
                            .filter(|chat| chat.generation == generation)
                        else {
                            return false;
                        };
                        match result {
                            Ok(messages) => {
                                let changed = chat.messages.as_ref() != Some(&messages);
                                if changed {
                                    let distance =
                                        chat.scroll.max_offset().height + chat.scroll.offset().y;
                                    if chat.messages.is_none() || distance < px(32.) {
                                        chat.scroll.scroll_to_bottom();
                                    }
                                    chat.messages = Some(messages);
                                }
                                if chat.error.take().is_some() || changed {
                                    cx.notify();
                                }
                            }
                            Err(error) => {
                                chat.error = Some(error);
                                cx.notify();
                            }
                        }
                        true
                    })
                    .unwrap_or(false);
                if !keep_open {
                    break;
                }
                let refreshed = refresh.notified();
                let timer = cx.background_executor().timer(REFRESH_INTERVAL);
                tokio::select! {
                    () = refreshed => {}
                    () = timer => {}
                }
            }
        }));
        cx.notify();
    }

    pub(super) fn refresh_catalog(&mut self, cx: &mut Context<Self>) {
        let Some(guest) = &self.guest else { return };
        let session = guest.session.clone();
        let runtime = self.runtime.clone();
        self.catalog_task = Some(cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(CATALOG_REFRESH_INTERVAL)
                    .await;
                let session = session.clone();
                let Ok(Ok(membership)) = runtime
                    .spawn(async move { session.membership().await })
                    .await
                else {
                    continue;
                };
                if this
                    .update(cx, |app, cx| {
                        if let Some(guest) = &mut app.guest
                            && guest.membership != membership
                        {
                            guest.membership = membership;
                            app.open_default_text(cx);
                            cx.notify();
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        }));
    }

    pub(super) fn send_chat(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let (Some(chat), Some(guest)) = (&mut self.chat, &self.guest) else {
            return;
        };
        let writable = guest
            .membership
            .channels
            .iter()
            .any(|channel| channel.id == chat.channel_id && !channel.archived);
        let body = self.message_input.read(cx).value().trim().to_string();
        if chat.sending || !writable || body.is_empty() || body.chars().count() > MAX_MESSAGE_LENGTH
        {
            return;
        }
        let request_id = chat
            .retry
            .as_ref()
            .filter(|(previous, _)| previous == &body)
            .map_or_else(Uuid::new_v4, |(_, id)| *id);
        chat.retry = Some((body.clone(), request_id));
        chat.sending = true;
        chat.send_error = None;

        let session = guest.session.clone();
        let channel = chat.channel_id.clone();
        let generation = chat.generation;
        let origin = channel.clone();
        let submitted = body.clone();
        let request = self
            .runtime
            .spawn(async move { session.send_message(&channel, &body, request_id).await });
        cx.spawn_in(window, async move |this, cx| {
            let result = request.await.unwrap_or(Err(Failure::Network));
            let _ = this.update_in(cx, |app, window, cx| {
                let is_current = app
                    .chat
                    .as_ref()
                    .is_some_and(|chat| chat.generation == generation);
                let chat = if is_current {
                    app.chat.as_mut()
                } else {
                    app.inactive_chats
                        .get_mut(&origin)
                        .filter(|chat| chat.generation == generation)
                };
                let Some(chat) = chat else { return };
                chat.sending = false;
                if let Err(error) = result {
                    chat.send_error = Some(error);
                } else {
                    chat.retry = None;
                    if is_current {
                        app.message_input.update(cx, |input, cx| {
                            if input.value().trim() == submitted {
                                input.set_value("", window, cx);
                            }
                        });
                        app.chat_refresh.notify_one();
                    } else if chat.draft.trim() == submitted {
                        chat.draft.clear();
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
}
