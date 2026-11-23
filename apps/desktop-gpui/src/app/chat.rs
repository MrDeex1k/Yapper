use super::Yapper;
use crate::server::{Failure, Message, MessageChange, Timeline};
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
    pub(super) before: i64,
    pub(super) loading_older: bool,
    pub(super) edit: Option<Edit>,
    pub(super) delete_confirmation: Option<String>,
    revision: Option<i64>,
    retry: Option<(String, Uuid)>,
    draft: String,
}

#[derive(Clone)]
pub(super) struct Edit {
    pub(super) id: String,
    revision: i64,
    draft: String,
}

enum HistoryRead {
    Page(i64, Timeline),
    Changes(Vec<MessageChange>),
}

impl Chat {
    fn apply(&mut self, update: HistoryRead) -> bool {
        if self.messages.is_none() {
            self.scroll.scroll_to_bottom();
        }
        let messages = self.messages.get_or_insert_with(Vec::new);
        let mut read_more = false;
        match update {
            HistoryRead::Page(cursor, page) => {
                if cursor == 0 {
                    self.revision = Some(page.revision);
                } else {
                    self.loading_older = false;
                }
                self.before = page.before;
                for message in page.messages {
                    upsert(messages, message);
                }
            }
            HistoryRead::Changes(changes) => {
                read_more = changes.len() == 100;
                if self.scroll.max_offset().height + self.scroll.offset().y < px(32.)
                    && !changes.is_empty()
                {
                    self.scroll.scroll_to_bottom();
                }
                for change in changes {
                    self.revision = Some(change.revision);
                    match change.message {
                        None => messages.retain(|message| message.id != change.id),
                        Some(message) if message.sequence >= self.before => {
                            upsert(messages, message)
                        }
                        Some(_) => {}
                    }
                }
            }
        }
        messages.sort_unstable_by_key(|message| message.sequence);
        read_more
    }
}

fn upsert(messages: &mut Vec<Message>, next: Message) {
    if let Some(current) = messages.iter_mut().find(|message| message.id == next.id) {
        if current.revision < next.revision {
            *current = next;
        }
    } else {
        messages.push(next);
    }
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
            chat.delete_confirmation = None;
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
            before: 0,
            loading_older: false,
            edit: None,
            delete_confirmation: None,
            revision: None,
            retry: None,
            draft: String::new(),
        });
        let generation = chat.generation;
        self.chat = Some(chat);

        let refresh = self.chat_refresh.clone();
        let runtime = self.runtime.clone();
        // One authoritative fetch at a time avoids a stale response overwriting fresher history.
        self.chat_task = Some(cx.spawn(async move |this, cx| {
            while let Some((older, revision)) = this.update(cx, |app, _| {
                    app.chat.as_ref().filter(|chat| chat.generation == generation).map(|chat| (
                        if chat.loading_older { chat.before } else { 0 },
                        chat.revision
                    ))
                }).ok().flatten() {
                let session = session.clone();
                let channel_id = id.clone();
                let result = runtime
                    .spawn(async move {
                        if older != 0 || revision.is_none() {
                            session.timeline(&channel_id, older).await.map(|page| HistoryRead::Page(older, page))
                        } else if let Some(revision) = revision {
                            session.changes(&channel_id, revision).await.map(HistoryRead::Changes)
                        } else {
                            unreachable!("a timeline without a revision requests the first page")
                        }
                    })
                    .await
                    .unwrap_or(Err(Failure::Network));
                let read_more = this
                    .update(cx, |app, cx| {
                        let chat = app
                            .chat
                            .as_mut()
                            .filter(|chat| chat.generation == generation)?;
                        match result {
                            Ok(update) => {
                                let changed = !matches!(&update, HistoryRead::Changes(changes) if changes.is_empty());
                                let more = chat.apply(update);
                                if chat.error.take().is_some() || changed { cx.notify(); }
                                Some(more)
                            }
                            Err(error) => {
                                chat.error = Some(error);
                                if older != 0 { chat.loading_older = false; }
                                cx.notify();
                                Some(false)
                            }
                        }
                    })
                    .ok().flatten();
                let Some(read_more) = read_more else { break; };
                if read_more { continue; }
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

    pub(super) fn load_older(&mut self, cx: &mut Context<Self>) {
        if let Some(chat) = self
            .chat
            .as_mut()
            .filter(|chat| chat.before != 0 && !chat.loading_older)
        {
            chat.loading_older = true;
            self.chat_refresh.notify_one();
            cx.notify();
        }
    }

    pub(super) fn edit_message(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        let Some(chat) = &mut self.chat else {
            return;
        };
        if chat.sending {
            return;
        }
        let Some(message) = chat
            .messages
            .as_ref()
            .and_then(|messages| messages.iter().find(|message| message.id == id))
        else {
            return;
        };
        let draft = chat.edit.take().map_or_else(
            || self.message_input.read(cx).value().to_string(),
            |edit| edit.draft,
        );
        chat.delete_confirmation = None;
        chat.send_error = None;
        chat.edit = Some(Edit {
            id: id.to_owned(),
            revision: message.revision,
            draft,
        });
        self.message_input.update(cx, |input, cx| {
            input.set_value(message.body.clone(), window, cx);
            input.focus(window, cx);
        });
        cx.notify();
    }

    pub(super) fn cancel_edit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(edit) = self.chat.as_mut().and_then(|chat| chat.edit.take()) {
            self.message_input
                .update(cx, |input, cx| input.set_value(edit.draft, window, cx));
            window.focus(&self.workspace_focus);
            cx.notify();
        }
    }

    pub(super) fn confirm_message_delete(&mut self, id: &str, cx: &mut Context<Self>) {
        let Some(chat) = &mut self.chat else { return };
        if chat.delete_confirmation.as_deref() == Some(id) {
            chat.delete_confirmation = None;
            self.message_action(id.to_owned(), None, cx);
            cx.notify();
        }
    }

    pub(super) fn message_action(
        &mut self,
        id: String,
        moderation: Option<&'static str>,
        cx: &mut Context<Self>,
    ) {
        let (Some(chat), Some(guest)) = (&self.chat, &self.guest) else {
            return;
        };
        let session = guest.session.clone();
        let channel = chat.channel_id.clone();
        let generation = chat.generation;
        let request = self.runtime.spawn(async move {
            if let Some(action) = moderation {
                session.moderate(&id, action).await
            } else {
                session.update_message(&channel, &id, None).await
            }
        });
        cx.spawn(async move |this, cx| {
            let result = request.await.unwrap_or(Err(Failure::Network));
            let _ = this.update(cx, |app, cx| {
                if let Some(chat) = app
                    .chat
                    .as_mut()
                    .filter(|chat| chat.generation == generation)
                {
                    chat.send_error = result.err();
                    app.chat_refresh.notify_one();
                    cx.notify();
                }
            });
        })
        .detach();
    }

    pub(super) fn refresh_catalog(&mut self, cx: &mut Context<Self>) {
        let Some(guest) = &self.guest else { return };
        let session = guest.session.clone();
        let runtime = self.runtime.clone();
        let refresh = self.catalog_refresh.clone();
        self.catalog_task = Some(cx.spawn(async move |this, cx| {
            loop {
                let timer = cx.background_executor().timer(CATALOG_REFRESH_INTERVAL);
                tokio::select! {
                    () = timer => {}
                    () = refresh.notified() => {}
                }
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
        let edit = chat.edit.clone();
        let request = self.runtime.spawn(async move {
            if let Some(edit) = edit {
                session
                    .update_message(&channel, &edit.id, Some((&body, edit.revision)))
                    .await
            } else {
                session.send_message(&channel, &body, request_id).await
            }
        });
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
                    let draft = chat.edit.take().map_or_else(String::new, |edit| edit.draft);
                    if is_current {
                        app.message_input.update(cx, |input, cx| {
                            if input.value().trim() == submitted {
                                input.set_value(draft, window, cx);
                            }
                        });
                        app.chat_refresh.notify_one();
                    } else if chat.draft.trim() == submitted {
                        chat.draft = draft;
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
}
