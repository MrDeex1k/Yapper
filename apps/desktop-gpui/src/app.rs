use crate::{
    copy::Language,
    server::{Admission, Failure, Installation, PendingAdmission, Server, Session},
    signaling,
    voice::{self, Command, Event, Peer},
};
use gpui::{
    AppContext, Application, Bounds, Context, Entity, FocusHandle, Task, Window, WindowBounds,
    WindowOptions, px, size,
};
use gpui_component::{
    Root,
    input::{InputEvent, InputState},
};
use livekit::{PlayoutDeviceInfo, RecordingDeviceInfo};
use preferences::Preferences;
use push_to_talk::MicrophoneMode;
use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    rc::Rc,
    sync::Arc,
};
use tokio::{
    runtime::Handle,
    sync::{Notify, mpsc, watch},
};

mod appearance;
mod chat;
mod chat_view;
mod events;
mod preferences;
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
    preferences: Preferences,
    address: Entity<InputState>,
    username: Entity<InputState>,
    password: Entity<InputState>,
    nickname: Entity<InputState>,
    invitation: Entity<InputState>,
    message_input: Entity<InputState>,
    workspace_focus: FocusHandle,
    installation: Option<(Server, Installation)>,
    admission: Option<Admission>,
    pending_admission: Option<PendingAdmission>,
    catalog_task: Option<Task<()>>,
    catalog_refresh: Arc<Notify>,
    event_task: Option<Task<()>>,
    events_connected: bool,
    call: Option<Call>,
    chat: Option<chat::Chat>,
    inactive_chats: HashMap<String, chat::Chat>,
    chat_task: Option<Task<()>>,
    chat_refresh: Arc<Notify>,
    microphone_mode: MicrophoneMode,
    channels_open: bool,
    show_sign_in_form: bool,
    switching_server: bool,
    switching_channel: Option<(Session, String, String)>,
    session_request_pending: bool,
    error: Option<Failure>,
}

struct Call {
    channel_id: String,
    commands: mpsc::UnboundedSender<Command>,
    microphone_intent: watch::Sender<bool>,
    name: String,
    peers: Vec<Peer>,
    microphones: Vec<RecordingDeviceInfo>,
    outputs: Vec<PlayoutDeviceInfo>,
    deafened: bool,
    muted_peers: HashSet<String>,
    state: CallState,
    can_publish: bool,
    microphone_active: bool,
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
        let preferences = Preferences::load();
        let language = match preferences.language.as_deref() {
            Some("pl") => Language::Polish,
            _ => Language::English,
        };
        let address = cx.new(|cx| InputState::new(window, cx).placeholder("voice.example.com"));
        let nickname = cx.new(|cx| InputState::new(window, cx));
        let invitation = cx.new(|cx| InputState::new(window, cx).masked(true));
        let username = cx.new(|cx| InputState::new(window, cx));
        let password = cx.new(|cx| InputState::new(window, cx).masked(true));
        cx.subscribe_in(&password, window, |app, _, event, window, cx| {
            if matches!(event, InputEvent::PressEnter { secondary: false }) {
                app.sign_in(window, cx);
            }
        })
        .detach();
        let message_input = cx
            .new(|cx| InputState::new(window, cx).placeholder(language.copy().message_placeholder));
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
            language,
            preferences,
            address,
            username,
            password,
            nickname,
            invitation,
            message_input,
            workspace_focus: cx.focus_handle(),
            installation: None,
            admission: None,
            pending_admission: None,
            catalog_task: None,
            catalog_refresh: Arc::new(Notify::new()),
            event_task: None,
            events_connected: false,
            call: None,
            chat: None,
            inactive_chats: HashMap::new(),
            chat_task: None,
            chat_refresh: Arc::new(Notify::new()),
            microphone_mode: MicrophoneMode::Manual,
            channels_open: false,
            show_sign_in_form: false,
            switching_server: false,
            switching_channel: None,
            session_request_pending: false,
            error: None,
        }
    }

    fn connect(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.connect_address(self.address.read(cx).value().to_string(), window, cx);
    }

    fn connect_address(&mut self, address: String, window: &mut Window, cx: &mut Context<Self>) {
        if self.session_request_pending {
            return;
        }
        self.session_request_pending = true;
        self.error = None;
        let result = self.runtime.spawn(async move {
            let (server, installation) = Server::connect(&address).await?;
            // Fresh admission can replace a saved credential. Keep the chooser open on restore errors.
            let admission = server.restore().await?;
            Ok::<_, Failure>((server, installation, admission))
        });
        cx.spawn_in(window, async move |this, cx| {
            let result = result.await.unwrap_or(Err(Failure::Network));
            let _ = this.update_in(cx, |app, window, cx| {
                app.session_request_pending = false;
                match result {
                    Ok((server, installation, admission)) => {
                        app.preferences
                            .remember(server.origin(), installation.name.clone());
                        app.installation = Some((server, installation));
                        app.admission = admission;
                        app.open_default_text(cx);
                        app.refresh_catalog(cx);
                        app.watch_events(window, cx);
                    }
                    Err(error) => app.error = Some(error),
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    fn sign_in(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.session_request_pending || !self.show_sign_in_form {
            return;
        }
        let Some((server, _)) = &self.installation else {
            return;
        };
        let server = server.clone();
        let username = self.username.read(cx).value().trim().to_string();
        let password = self.password.read(cx).value().to_string();
        self.password
            .update(cx, |input, cx| input.set_value("", window, cx));
        self.session_request_pending = true;
        self.error = None;
        let result = self
            .runtime
            .spawn(async move { server.sign_in(username, password).await });
        cx.spawn_in(window, async move |this, cx| {
            let result = result.await.unwrap_or(Err(Failure::Network));
            let _ = this.update_in(cx, |app, window, cx| {
                app.session_request_pending = false;
                match result {
                    Ok(admission) => {
                        app.admission = Some(admission);
                        app.open_default_text(cx);
                        app.refresh_catalog(cx);
                        app.watch_events(window, cx);
                    }
                    Err(error) => app.error = Some(error),
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    fn sign_out(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.session_request_pending || self.call.is_some() {
            return;
        }
        let Some(session) = self
            .admission
            .as_ref()
            .map(|admission| admission.session.clone())
        else {
            return;
        };
        self.session_request_pending = true;
        let result = self.runtime.spawn(async move { session.sign_out().await });
        cx.spawn_in(window, async move |this, cx| {
            let result = result.await.unwrap_or(Err(Failure::Network));
            let _ = this.update_in(cx, |app, window, cx| {
                app.session_request_pending = false;
                match result {
                    Ok(()) => app.clear_session(window, cx),
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
        self.session_request_pending = true;
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
                app.session_request_pending = false;
                match result {
                    Ok((pending, admission)) => {
                        app.invitation
                            .update(cx, |input, cx| input.set_value("", window, cx));
                        match admission {
                            Ok(admission) => {
                                app.pending_admission = None;
                                app.admission = Some(admission);
                                app.open_default_text(cx);
                                app.refresh_catalog(cx);
                                app.watch_events(window, cx);
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

    fn join_voice(
        &mut self,
        session: Session,
        id: String,
        name: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some(call) = &mut self.call {
            if call.channel_id != id && !self.switching_server {
                self.switching_channel = Some((session, id, name));
                call.leave();
            }
            self.channels_open = false;
            cx.notify();
            return;
        }
        let (commands, receive) = mpsc::unbounded_channel();
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
            microphones: Vec::new(),
            outputs: Vec::new(),
            deafened: false,
            muted_peers: HashSet::new(),
            state: CallState::Joining,
            can_publish: false,
            microphone_active: false,
        });
        self.runtime
            .spawn(voice::run(session, id, receive, desired_microphone, send));
        cx.spawn_in(window, async move |this, cx| {
            while let Some(event) = events.recv().await {
                let ended = matches!(&event, Event::Ended(_));
                if this
                    .update_in(cx, |app, window, cx| {
                        app.on_call_event(event);
                        if ended && app.switching_server {
                            app.change_server(window, cx);
                        } else if ended
                            && let Some((session, id, name)) = app.switching_channel.take()
                        {
                            app.join_voice(session, id, name, window, cx);
                        }
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
            let _ = this.update_in(cx, |app, window, cx| {
                app.microphone_mode.release_key();
                if app.call.take().is_some() {
                    app.error = Some(Failure::Voice);
                    cx.notify();
                }
                if app.switching_server {
                    app.change_server(window, cx);
                } else if let Some((session, id, name)) = app.switching_channel.take() {
                    app.join_voice(session, id, name, window, cx);
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
            Event::Devices(microphones, outputs) => {
                call.microphones = microphones;
                call.outputs = outputs;
            }
            Event::CanPublish(allowed) => {
                call.can_publish = allowed;
                if !allowed {
                    call.microphone_intent.send_replace(false);
                    self.microphone_mode.release_key();
                }
            }
            Event::MicrophoneActiveChanged(active) => {
                call.microphone_active = active;
                self.error = None;
            }
            Event::Reconnecting => {
                if call.state != CallState::Leaving {
                    call.state = CallState::Reconnecting;
                }
                call.microphone_active = false;
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
        if let Some(call) = &mut self.call {
            self.switching_server = true;
            self.switching_channel = None;
            call.leave();
            cx.notify();
            return;
        }
        self.switching_server = false;
        self.installation = None;
        self.clear_session(window, cx);
        cx.notify();
    }

    fn clear_session(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.admission = None;
        self.pending_admission = None;
        self.catalog_task = None;
        self.event_task = None;
        self.events_connected = false;
        self.invitation
            .update(cx, |input, cx| input.set_value("", window, cx));
        self.chat_task = None;
        self.chat = None;
        self.inactive_chats.clear();
        self.message_input
            .update(cx, |input, cx| input.set_value("", window, cx));
        self.channels_open = false;
        self.show_sign_in_form = false;
        self.error = None;
        cx.notify();
    }
}

impl Call {
    fn leave(&mut self) {
        self.state = CallState::Leaving;
        self.microphone_intent.send_replace(false);
        let _ = self.commands.send(Command::Leave);
    }
}
