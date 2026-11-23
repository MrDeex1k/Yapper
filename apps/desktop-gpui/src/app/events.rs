use super::Yapper;
use crate::server::{Failure, events::Hint};
use gpui::{Context, Window};
use tokio::sync::mpsc;

impl Yapper {
    pub(super) fn watch_events(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(session) = self.guest.as_ref().map(|guest| guest.session.clone()) else {
            return;
        };
        let (send, mut receive) = mpsc::unbounded_channel();
        self.runtime
            .spawn(async move { session.watch_events(send).await });
        self.events_connected = false;
        self.event_task = Some(cx.spawn_in(window, async move |this, cx| {
            while let Some(hint) = receive.recv().await {
                let removed = matches!(hint, Hint::Removed);
                if this
                    .update_in(cx, |app, window, cx| match hint {
                        Hint::Ready => {
                            app.events_connected = true;
                            app.chat_refresh.notify_one();
                            app.catalog_refresh.notify_one();
                            cx.notify();
                        }
                        Hint::Catalog => app.catalog_refresh.notify_one(),
                        Hint::Chat(channel) => {
                            if app
                                .chat
                                .as_ref()
                                .is_some_and(|chat| chat.channel_id == channel)
                            {
                                app.chat_refresh.notify_one();
                            }
                        }
                        Hint::Reconnecting => {
                            app.events_connected = false;
                            cx.notify();
                        }
                        Hint::Removed => {
                            if let Some(call) = &mut app.call {
                                call.leave();
                            }
                            app.switching_channel = None;
                            app.clear_session(window, cx);
                            app.error = Some(Failure::Denied);
                            cx.notify();
                        }
                    })
                    .is_err()
                    || removed
                {
                    return;
                }
            }
        }));
    }
}
