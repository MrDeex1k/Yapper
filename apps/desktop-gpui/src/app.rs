use crate::{
    copy::Language,
    server::{Admission, Failure, Installation, PendingAdmission, Server, Session},
    signaling,
    voice::{self, Command, Event},
};
use gpui::{
    AppContext, Application, Bounds, Context, Entity, FocusHandle, Task, Window, WindowBounds,
    WindowOptions, px, size,
};
use gpui_component::{
    Root,
    input::{InputEvent, InputState},
};
use push_to_talk::MicrophoneMode;
use std::{cell::RefCell, collections::HashMap, rc::Rc, sync::Arc};
use tokio::{
    runtime::Handle,
    sync::{Notify, mpsc, watch},
};

mod appearance;
mod chat;
mod chat_view;
mod push_to_talk;
mod view;

pub fn run() -> gpui::Result<()> {
    let runtime = tokio::runtime::Runtime::new()?;
    signaling::install();
    let handle = runtime.handle().clone();
    let startup_error = Rc::new(RefCell::new(None));
    let window_error = startup_error.clone();
    Application::new()
        .with_assets(appearance::Assets)
        .run(move |cx| {
            gpui_component::init(cx);
            appearance::configure(cx);

            cx.on_window_closed(|cx| {
                if cx.windows().is_empty() {
                    cx.quit();
                }
            })
            .detach();

            let bounds = Bounds::centered(None, size(px(1200.), px(800.)), cx);
            if let Err(error) = cx.open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(bounds)),
                    window_min_size: Some(size(px(560.), px(480.))),
                    ..Default::default()
                },
                |window, cx| {
                    window.set_window_title("Yapper");
                    let app = cx.new(|cx| Yapper::new(window, cx, handle));
                    cx.new(|cx| Root::new(app, window, cx))
                },
            ) {
                window_error.replace(Some(error));
                cx.quit();
                return;
            }
            cx.activate(true);
        });
    startup_error.take().map_or(Ok(()), Err)
}

struct Yapper {
    runtime: Handle,
    language: Language,
    address: Entity<InputState>,
    nickname: Entity<InputState>,
    invitation: Entity<InputState>,
    message_input: Entity<InputState>,
    workspace_focus: FocusHandle,
    installation: Option<(Server, Installation)>,
    guest: Option<Admission>,
    pending_admission: Option<PendingAdmission>,
    catalog_task: Option<Task<()>>,
    call: Option<Call>,
    chat: Option<chat::Chat>,
    inactive_chats: HashMap<String, chat::Chat>,
    chat_task: Option<Task<()>>,
    chat_refresh: Arc<Notify>,
    microphone_mode: MicrophoneMode,
    channels_open: bool,
    pending: bool,
    error: Option<Failure>,
}

struct Call {
    channel_id: String,
    commands: mpsc::Sender<Command>,
    microphone_intent: watch::Sender<bool>,
    name: String,
    peers: Vec<String>,
    state: CallState,
    can_publish: bool,
    microphone: bool,
}

#[derive(PartialEq, Eq)]
enum CallState {
    Joining,
    Connected,
    Reconnecting,
    Leaving,
}

impl Yapper {
    fn new(window: &mut Window, cx: &mut Context<Self>, runtime: Handle) -> Self {
        let address = cx.new(|cx| InputState::new(window, cx).placeholder("voice.example.com"));
        let nickname = cx.new(|cx| InputState::new(window, cx));
        let invitation = cx.new(|cx| InputState::new(window, cx).masked(true));
        let message_input = cx.new(|cx| {
            InputState::new(window, cx).placeholder(Language::English.copy().message_placeholder)
        });
        cx.subscribe_in(
            &message_input,
            window,
            |app, _, event, window, cx| match event {
                InputEvent::PressEnter { secondary: false } => app.send_chat(window, cx),
                InputEvent::Focus => app.release_push_to_talk(cx),
                InputEvent::Change => cx.notify(),
                _ => {}
            },
        )
        .detach();
        cx.observe_window_activation(window, |app, window, cx| {
            if !window.is_window_active() {
                app.release_push_to_talk(cx);
            }
        })
        .detach();
        Self {
            runtime,
            language: Language::English,
            address,
            nickname,
            invitation,
            message_input,
            workspace_focus: cx.focus_handle(),
            installation: None,
            guest: None,
            pending_admission: None,
            catalog_task: None,
            call: None,
            chat: None,
            inactive_chats: HashMap::new(),
            chat_task: None,
            chat_refresh: Arc::new(Notify::new()),
            microphone_mode: MicrophoneMode::Manual,
            channels_open: false,
            pending: false,
            error: None,
        }
    }

    fn connect(&mut self, cx: &mut Context<Self>) {
        let address = self.address.read(cx).value().to_string();
        self.pending = true;
        self.error = None;
        let result = self.runtime.spawn(async move {
            let (server, installation) = Server::connect(&address).await?;
            let admission = server.restore().await?;
            Ok::<_, Failure>((server, installation, admission))
        });
        cx.spawn(async move |this, cx| {
            let result = result.await.unwrap_or(Err(Failure::Network));
            let _ = this.update(cx, |app, cx| {
                app.pending = false;
                match result {
                    Ok((server, installation, admission)) => {
                        app.installation = Some((server, installation));
                        app.guest = admission;
                        app.open_default_text(cx);
                        app.refresh_catalog(cx);
                    }
                    Err(error) => app.error = Some(error),
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    fn admit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some((server, _)) = &self.installation else {
            return;
        };
        let server = server.clone();
        let nickname = self.nickname.read(cx).value().trim().to_owned();
        let invitation = self.invitation.read(cx).value().trim().to_owned();
        let pending = self.pending_admission.clone();
        self.pending = true;
        self.error = None;
        let result = self.runtime.spawn(async move {
            let pending = match pending {
                Some(pending) => pending,
                None => server.begin_admission(nickname, invitation).await?,
            };
            let admission = pending.finish().await;
            Ok::<_, Failure>((pending, admission))
        });
        cx.spawn_in(window, async move |this, cx| {
            let result = result.await.unwrap_or(Err(Failure::Network));
            let _ = this.update_in(cx, |app, window, cx| {
                app.pending = false;
                match result {
                    Ok((pending, admission)) => {
                        app.invitation
                            .update(cx, |input, cx| input.set_value("", window, cx));
                        match admission {
                            Ok(guest) => {
                                app.pending_admission = None;
                                app.guest = Some(guest);
                                app.open_default_text(cx);
                                app.refresh_catalog(cx);
                            }
                            Err(error) => {
                                app.pending_admission = Some(pending);
                                app.error = Some(error);
                            }
                        }
                    }
                    Err(error) => app.error = Some(error),
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    fn join_voice(&mut self, session: Session, id: String, name: String, cx: &mut Context<Self>) {
        if self.call.is_some() {
            return;
        }
        let (commands, receive) = mpsc::channel(4);
        let (microphone_intent, desired_microphone) = watch::channel(false);
        let (send, mut events) = mpsc::unbounded_channel();
        self.error = None;
        self.channels_open = false;
        self.call = Some(Call {
            channel_id: id.clone(),
            name,
            commands,
            microphone_intent,
            peers: Vec::new(),
            state: CallState::Joining,
            can_publish: false,
            microphone: false,
        });
        self.runtime
            .spawn(voice::run(session, id, receive, desired_microphone, send));
        cx.spawn(async move |this, cx| {
            while let Some(event) = events.recv().await {
                let ended = matches!(&event, Event::Ended(_));
                if this
                    .update(cx, |app, cx| {
                        app.on_call_event(event);
                        cx.notify();
                    })
                    .is_err()
                {
                    return;
                }
                if ended {
                    return;
                }
            }
            let _ = this.update(cx, |app, cx| {
                app.microphone_mode.release_key();
                if app.call.take().is_some() {
                    app.error = Some(Failure::Voice);
                    cx.notify();
                }
            });
        })
        .detach();
        cx.notify();
    }

    fn on_call_event(&mut self, event: Event) {
        let Some(call) = &mut self.call else {
            return;
        };
        match event {
            Event::Connected { can_publish, peers } => {
                if call.state != CallState::Leaving {
                    call.state = CallState::Connected;
                }
                call.can_publish = can_publish;
                call.peers = peers;
            }
            Event::Peers(peers) => call.peers = peers,
            Event::Microphone(active) => {
                call.microphone = active;
                self.error = None;
            }
            Event::Reconnecting => {
                if call.state != CallState::Leaving {
                    call.state = CallState::Reconnecting;
                }
                call.microphone = false;
                call.microphone_intent.send_replace(false);
                self.microphone_mode.release_key();
            }
            Event::Failed(error) => {
                if matches!(error, Failure::Microphone) {
                    call.microphone_intent.send_replace(false);
                    self.microphone_mode.release_key();
                }
                self.error = Some(error);
            }
            Event::Ended(error) => {
                self.microphone_mode.release_key();
                self.call = None;
                self.error = error;
            }
        }
    }

    fn change_server(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.installation = None;
        self.guest = None;
        self.pending_admission = None;
        self.catalog_task = None;
        self.invitation
            .update(cx, |input, cx| input.set_value("", window, cx));
        self.chat_task = None;
        self.chat = None;
        self.inactive_chats.clear();
        self.message_input
            .update(cx, |input, cx| input.set_value("", window, cx));
        self.channels_open = false;
        self.error = None;
        cx.notify();
    }
}
