use crate::{
    copy::Language,
    server::{Admission, Failure, Installation, Membership, Server, Session},
    signaling,
    voice::{self, Command, Event},
};
use gpui::prelude::*;
use gpui::{
    Application, Bounds, Context, Entity, Window, WindowBounds, WindowOptions, div, px, rgb, size,
};
use gpui_component::{
    Disableable, Root, Theme, ThemeMode,
    button::{Button, ButtonVariants},
    input::{Input, InputState},
};
use tokio::{runtime::Handle, sync::mpsc};

const BACKGROUND: u32 = 0x151817;
const SIDEBAR: u32 = 0x111512;
const FOREGROUND: u32 = 0xe7eee9;
const ACCENT: u32 = 0xb9eccb;
const MUTED: u32 = 0x94a098;
const LINE: u32 = 0x2b332e;

pub fn run() -> gpui::Result<()> {
    let runtime = tokio::runtime::Runtime::new()?;
    signaling::install();
    let handle = runtime.handle().clone();
    Application::new().run(move |cx| {
        gpui_component::init(cx);
        Theme::change(ThemeMode::Dark, None, cx);
        let colors = &mut Theme::global_mut(cx).colors;
        colors.background = rgb(BACKGROUND).into();
        colors.foreground = rgb(FOREGROUND).into();
        colors.border = rgb(LINE).into();
        colors.primary = rgb(ACCENT).into();
        colors.primary_foreground = rgb(SIDEBAR).into();
        colors.ring = rgb(ACCENT).into();

        cx.on_window_closed(|cx| {
            if cx.windows().is_empty() {
                cx.quit();
            }
        })
        .detach();

        let bounds = Bounds::centered(None, size(px(1200.), px(800.)), cx);
        if cx
            .open_window(
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
            )
            .is_err()
        {
            eprintln!("Could not open the Yapper window.");
            cx.quit();
            return;
        }
        cx.activate(true);
    });
    Ok(())
}

struct Yapper {
    runtime: Handle,
    language: Language,
    address: Entity<InputState>,
    nickname: Entity<InputState>,
    invitation: Entity<InputState>,
    installation: Option<(Server, Installation)>,
    guest: Option<Admission>,
    call: Option<Call>,
    pending: bool,
    error: Option<Failure>,
}

struct Call {
    commands: mpsc::Sender<Command>,
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
        Self {
            runtime,
            language: Language::English,
            address,
            nickname,
            invitation,
            installation: None,
            guest: None,
            call: None,
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
        self.invitation
            .update(cx, |input, cx| input.set_value("", window, cx));
        self.pending = true;
        self.error = None;
        let result = self
            .runtime
            .spawn(async move { server.join(nickname, invitation).await });
        cx.spawn(async move |this, cx| {
            let result = result.await.unwrap_or(Err(Failure::Network));
            let _ = this.update(cx, |app, cx| {
                app.pending = false;
                match result {
                    Ok(guest) => app.guest = Some(guest),
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
        let (send, mut events) = mpsc::unbounded_channel();
        self.error = None;
        self.call = Some(Call {
            name,
            commands,
            peers: Vec::new(),
            state: CallState::Joining,
            can_publish: false,
            microphone: false,
        });
        self.runtime.spawn(voice::run(session, id, receive, send));
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
            }
            Event::Failed(error) => self.error = Some(error),
            Event::Ended(error) => {
                self.call = None;
                self.error = error;
            }
        }
    }

    fn change_server(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        self.installation = None;
        self.guest = None;
        self.error = None;
        cx.notify();
    }

    fn render_workspace(
        &self,
        name: &str,
        me: &Membership,
        session: &Session,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let copy = self.language.copy();
        let channels = me
            .channels
            .iter()
            .filter(|channel| channel.kind == "voice")
            .map(|channel| {
                let (id, name, session) =
                    (channel.id.clone(), channel.name.clone(), session.clone());
                Button::new(gpui::SharedString::from(format!("voice-channel-{id}")))
                    .ghost()
                    .w_full()
                    .label(channel.name.clone())
                    .disabled(self.call.is_some())
                    .on_click(cx.listener(move |app, _, _, cx| {
                        app.join_voice(session.clone(), id.clone(), name.clone(), cx);
                    }))
            });
        div()
            .flex()
            .size_full()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .w(px(248.))
                    .flex_none()
                    .px_6()
                    .py_8()
                    .gap_4()
                    .bg(rgb(SIDEBAR))
                    .border_r_1()
                    .border_color(rgb(LINE))
                    .child(wordmark())
                    .child(
                        div()
                            .mt_8()
                            .font_weight(gpui::FontWeight::SEMIBOLD)
                            .child(name.to_owned()),
                    )
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(MUTED))
                            .child(copy.voice_channels),
                    )
                    .children(channels)
                    .child(
                        div()
                            .mt_auto()
                            .text_sm()
                            .text_color(rgb(MUTED))
                            .child(me.participant.nickname.clone()),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .child(
                        div()
                            .min_h(px(80.))
                            .px_8()
                            .gap_4()
                            .flex()
                            .items_center()
                            .border_b_1()
                            .border_color(rgb(LINE))
                            .child(
                                div()
                                    .flex_1()
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .child(copy.voice_channels),
                            )
                            .child(
                                Button::new("change-server")
                                    .ghost()
                                    .label(copy.change_server)
                                    .disabled(self.call.is_some())
                                    .on_click(cx.listener(|app, _, window, cx| {
                                        app.change_server(window, cx)
                                    })),
                            )
                            .child(self.language_button(cx)),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_1()
                            .items_center()
                            .justify_center()
                            .p_8()
                            .child(self.render_call(cx)),
                    ),
            )
    }

    fn render_call(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let copy = self.language.copy();
        let mut panel = div().flex().flex_col().gap_4().w_full().max_w(px(450.));
        if let Some(call) = &self.call {
            let status = match call.state {
                CallState::Joining => copy.connecting,
                CallState::Connected => copy.connected,
                CallState::Reconnecting => copy.reconnecting,
                CallState::Leaving => copy.disconnecting,
            };
            panel = panel
                .child(
                    div()
                        .text_xl()
                        .font_weight(gpui::FontWeight::SEMIBOLD)
                        .child(call.name.clone()),
                )
                .child(div().text_sm().text_color(rgb(ACCENT)).child(status))
                .children(call.peers.iter().map(|peer| {
                    div()
                        .border_b_1()
                        .border_color(rgb(LINE))
                        .py_2()
                        .child(peer.clone())
                }))
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .gap_3()
                        .child(
                            Button::new("mute")
                                .primary()
                                .label(if call.microphone {
                                    copy.microphone_off
                                } else {
                                    copy.microphone_on
                                })
                                .disabled(!call.can_publish || call.state != CallState::Connected)
                                .on_click(cx.listener(|app, _, _, cx| {
                                    if let Some(call) = &app.call {
                                        if call
                                            .commands
                                            .try_send(Command::ToggleMicrophone)
                                            .is_err()
                                        {
                                            app.error = Some(Failure::Voice);
                                        }
                                        cx.notify();
                                    }
                                })),
                        )
                        .child(
                            Button::new("leave")
                                .label(copy.leave)
                                .disabled(call.state == CallState::Leaving)
                                .on_click(cx.listener(|app, _, _, cx| {
                                    if let Some(call) = &mut app.call {
                                        if call.commands.try_send(Command::Leave).is_ok() {
                                            call.state = CallState::Leaving;
                                        } else {
                                            app.error = Some(Failure::Voice);
                                        }
                                        cx.notify();
                                    }
                                })),
                        ),
                )
                .when(
                    call.state == CallState::Connected && !call.can_publish,
                    |panel| {
                        panel.child(
                            div()
                                .text_sm()
                                .text_color(rgb(MUTED))
                                .child(copy.listening_only),
                        )
                    },
                );
        } else {
            panel = panel.child(div().text_color(rgb(MUTED)).child(copy.select_voice));
        }

        if self.guest.as_ref().is_some_and(|guest| !guest.saved) {
            panel = panel.child(div().text_sm().text_color(rgb(MUTED)).child(copy.unsaved));
        }
        panel.children(self.render_error())
    }

    fn language_button(&self, cx: &mut Context<Self>) -> Button {
        Button::new("locale")
            .ghost()
            .label(self.language.copy().language)
            .on_click(cx.listener(|app, _, _, cx| {
                app.language = app.language.toggle();
                cx.notify();
            }))
    }

    fn render_error(&self) -> Option<gpui::Div> {
        self.error.map(|error| {
            div()
                .text_sm()
                .text_color(rgb(0xf5a9a9))
                .child(self.language.failure(error))
        })
    }
}

impl Render for Yapper {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let copy = self.language.copy();
        let surface = div()
            .size_full()
            .bg(rgb(BACKGROUND))
            .text_color(rgb(FOREGROUND));
        if let (Some((_, installation)), Some(guest)) = (&self.installation, &self.guest) {
            return surface.child(self.render_workspace(
                &installation.name,
                &guest.membership,
                &guest.session,
                cx,
            ));
        }

        let mut form = div()
            .flex()
            .flex_col()
            .w_full()
            .max_w(px(440.))
            .gap_4()
            .child(wordmark());
        if let Some((_, installation)) = &self.installation {
            form = form
                .child(div().text_xl().child(installation.name.clone()))
                .child(field(copy.nickname, &self.nickname, self.pending))
                .when(!installation.open_admission, |form| {
                    form.child(field(copy.invitation, &self.invitation, self.pending))
                })
                .child(
                    Button::new("admit")
                        .primary()
                        .label(copy.join)
                        .loading(self.pending)
                        .disabled(self.pending)
                        .on_click(cx.listener(|app, _, window, cx| app.admit(window, cx))),
                )
                .child(
                    Button::new("change-server")
                        .ghost()
                        .label(copy.change_server)
                        .disabled(self.pending)
                        .on_click(cx.listener(|app, _, window, cx| app.change_server(window, cx))),
                );
        } else {
            form = form
                .child(div().text_xl().child(copy.server))
                .child(field(copy.address, &self.address, self.pending))
                .child(
                    Button::new("connect")
                        .primary()
                        .label(copy.connect)
                        .loading(self.pending)
                        .disabled(self.pending)
                        .on_click(cx.listener(|app, _, _, cx| app.connect(cx))),
                );
        }
        surface
            .flex()
            .flex_col()
            .child(
                div()
                    .flex()
                    .justify_end()
                    .px_8()
                    .py_4()
                    .child(self.language_button(cx)),
            )
            .child(
                div()
                    .flex()
                    .flex_1()
                    .items_center()
                    .justify_center()
                    .p_8()
                    .child(form.children(self.render_error())),
            )
    }
}

fn field(label: &'static str, state: &Entity<InputState>, pending: bool) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .gap_2()
        .child(div().text_sm().child(label))
        .child(Input::new(state).disabled(pending))
}

fn wordmark() -> impl IntoElement {
    div()
        .flex()
        .text_size(px(35.))
        .font_weight(gpui::FontWeight::EXTRA_BOLD)
        .child("Yapper")
        .child(div().text_color(rgb(ACCENT)).child("."))
}
