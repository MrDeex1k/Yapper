use super::appearance::text_length;
use super::{
    Call, CallState, Yapper,
    appearance::{
        ACCENT, BACKGROUND, COMPACT_WIDTH, CONTROL_LINE, DANGER, DANGER_SURFACE, HOVER, LINE,
        MUTED, NAVIGATION, PANEL, SELECTED, SIDEBAR_WIDTH, TEXT, brand, icon, outline_button,
        status_dot, voice_button,
    },
};
use crate::{
    copy::Language,
    server::{Admission, Channel, Session},
    voice::Command,
};
use gpui::prelude::*;
use gpui::{Context, Corner, Div, Entity, Focusable, FontWeight, Window, div, px, rgb};
use gpui_component::{
    Disableable,
    button::{Button, ButtonCustomVariant, ButtonVariants},
    input::{Input, InputState},
    menu::{DropdownMenu, PopupMenuItem},
};

// These dimensions match the entry header and footer at the Web desktop breakpoint.
const ENTRY_HEADER_HEIGHT: f32 = 71.;
const ENTRY_FOOTER_HEIGHT: f32 = 50.;
const ENTRY_HORIZONTAL_PADDING: f32 = 24.;
const ENTRY_MAX_WIDTH: f32 = 408.;
const SAVED_SERVER_PADDING: f32 = 12.;

#[derive(Clone, Copy, PartialEq, Eq)]
enum WorkspaceLayout {
    Desktop,
    Compact,
}

impl Render for Yapper {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let surface = div()
            .size_full()
            .bg(rgb(BACKGROUND))
            .text_color(rgb(TEXT))
            .track_focus(&self.workspace_focus)
            .capture_key_down(cx.listener(Self::key_down))
            .capture_key_up(cx.listener(Self::key_up));
        let width = f32::from(window.viewport_size().width);
        if let (Some((_, installation)), Some(admission)) = (&self.installation, &self.admission) {
            surface.child(self.workspace(&installation.name, admission, width, window, cx))
        } else {
            surface.child(self.entry(width, window, cx))
        }
    }
}

impl Yapper {
    fn entry(&self, width: f32, window: &Window, cx: &mut Context<Self>) -> impl IntoElement {
        let copy = self.language.copy();
        let margin = px((width * 0.04).clamp(18., 64.));
        let footer_height = self
            .installation
            .as_ref()
            .map_or(0., |_| ENTRY_FOOTER_HEIGHT);
        let chrome_height = ENTRY_HEADER_HEIGHT + footer_height;
        let content_height = (f32::from(window.viewport_size().height) - chrome_height).max(0.);

        div()
            .size_full()
            .flex()
            .flex_col()
            .child(
                div()
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_between()
                    .px(margin)
                    .py(px(18.))
                    .bg(rgb(NAVIGATION))
                    .border_b_1()
                    .border_color(rgb(LINE))
                    .child(brand())
                    .child(self.display_controls(cx)),
            )
            .child(
                div()
                    .id("entry-scroll")
                    .flex_1()
                    .min_h(px(0.))
                    .overflow_y_scroll()
                    .child(
                        div()
                            .min_h(px(content_height))
                            .flex()
                            .items_center()
                            .justify_center()
                            .px(px(ENTRY_HORIZONTAL_PADDING))
                            .pt(px(36.))
                            .pb(px(48.))
                            .child(self.entry_form(width, window, cx)),
                    ),
            )
            .when(self.installation.is_some(), |entry| {
                entry.child(
                    div()
                        .flex_none()
                        .flex()
                        .justify_between()
                        .items_center()
                        .h(px(ENTRY_FOOTER_HEIGHT))
                        .px(margin)
                        .border_t_1()
                        .border_color(rgb(LINE))
                        .text_size(text_length(12.))
                        .text_color(rgb(MUTED))
                        .child(copy.privacy)
                        .child(copy.build),
                )
            })
    }

    fn entry_form(&self, width: f32, window: &Window, cx: &mut Context<Self>) -> Div {
        let copy = self.language.copy();
        let mut form = div().flex().flex_col().mt(px(14.)).gap(px(18.)).w_full();
        let mut content = div()
            .w_full()
            .max_w(px(ENTRY_MAX_WIDTH))
            .flex()
            .flex_col()
            .gap(px(10.));

        if let Some((server, installation)) = &self.installation {
            content = content
                .child(
                    div()
                        .p(px(12.))
                        .rounded(px(8.))
                        .border_1()
                        .border_color(rgb(CONTROL_LINE))
                        .bg(rgb(PANEL))
                        .flex()
                        .flex_col()
                        .gap(px(8.))
                        .child(
                            div()
                                .text_size(text_length(12.))
                                .text_color(rgb(ACCENT))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(copy.current_server),
                        )
                        .child(server_identity(&installation.name, &server.origin())),
                )
                .child(entry_title(
                    if self.show_sign_in_form {
                        copy.sign_in
                    } else {
                        copy.join_heading
                    },
                    width,
                ))
                .when(!self.show_sign_in_form, |content| {
                    content.child(entry_description(copy.join_description))
                });
            let admitted = self.pending_admission.is_some();
            if self.show_sign_in_form {
                form = form
                    .child(field(
                        copy.username,
                        &self.username,
                        self.session_request_pending,
                        window,
                        cx,
                    ))
                    .child(field(
                        copy.password,
                        &self.password,
                        self.session_request_pending,
                        window,
                        cx,
                    ))
                    .children(self.render_error())
                    .child(
                        primary_entry("sign-in", copy.sign_in, self.session_request_pending)
                            .on_click(cx.listener(|app, _, window, cx| app.sign_in(window, cx))),
                    );
            } else {
                form = form
                    .when(!admitted, |form| {
                        form.child(field(
                            copy.nickname,
                            &self.nickname,
                            self.session_request_pending,
                            window,
                            cx,
                        ))
                        .when(!installation.open_admission, |form| {
                            form.child(field(
                                copy.invitation,
                                &self.invitation,
                                self.session_request_pending,
                                window,
                                cx,
                            ))
                        })
                    })
                    .children(self.render_error())
                    .child(
                        primary_entry(
                            "admit",
                            if admitted {
                                copy.retry_membership
                            } else {
                                copy.join
                            },
                            self.session_request_pending,
                        )
                        .on_click(cx.listener(|app, _, window, cx| app.admit(window, cx))),
                    )
                    .child(
                        div()
                            .text_size(text_length(12.))
                            .line_height(text_length(20.))
                            .text_color(rgb(MUTED))
                            .child(copy.identity_notice),
                    );
            }
            form = form
                .when(!admitted, |form| {
                    form.child(
                        Button::new("switch-entry-mode")
                            .ghost()
                            .label(if self.show_sign_in_form {
                                copy.continue_as_guest
                            } else {
                                copy.sign_in
                            })
                            .disabled(self.session_request_pending)
                            .on_click(cx.listener(|app, _, window, cx| {
                                app.show_sign_in_form = !app.show_sign_in_form;
                                app.password
                                    .update(cx, |input, cx| input.set_value("", window, cx));
                                app.error = None;
                                cx.notify();
                            })),
                    )
                })
                .child(
                    Button::new("change-server")
                        .ghost()
                        .h(px(40.))
                        .label(copy.change_server)
                        .disabled(self.session_request_pending)
                        .on_click(cx.listener(|app, _, window, cx| app.change_server(window, cx))),
                );
        } else {
            content = content.child(entry_title(copy.server, width));
            if !self.preferences.servers.is_empty() {
                content = content.child(self.saved_server_list(width, cx));
                form = form.border_t_1().border_color(rgb(LINE)).pt(px(16.));
            }
            form = form
                .child(field(
                    copy.address,
                    &self.address,
                    self.session_request_pending,
                    window,
                    cx,
                ))
                .children(self.render_error())
                .child(
                    primary_entry("connect", copy.connect, self.session_request_pending)
                        .on_click(cx.listener(|app, _, window, cx| app.connect(window, cx))),
                );
        }

        content.child(form)
    }

    fn saved_server_list(&self, width: f32, cx: &mut Context<Self>) -> Div {
        let copy = self.language.copy();
        let row_width = (width - 2. * ENTRY_HORIZONTAL_PADDING).clamp(0., ENTRY_MAX_WIDTH);
        let row_content_width = (row_width - 2. * SAVED_SERVER_PADDING - 2.).max(0.);
        let rows = self.preferences.servers.iter().map(|server| {
            let address = server.address.clone();
            Button::new(gpui::SharedString::from(format!("saved-{address}")))
                .custom(
                    ButtonCustomVariant::new(cx)
                        .border(rgb(CONTROL_LINE).into())
                        .color(rgb(PANEL).into())
                        .hover(rgb(SELECTED).into())
                        .active(rgb(HOVER).into()),
                )
                .rounded(px(8.))
                .w_full()
                .h(px(72.))
                .px(px(SAVED_SERVER_PADDING))
                .tooltip(address.clone())
                .child(
                    div()
                        .w(px(row_content_width))
                        .min_w(px(0.))
                        .flex()
                        .items_center()
                        .gap(px(12.))
                        .child(server_identity(&server.name, &address).flex_1())
                        .child(
                            div()
                                .flex_none()
                                .flex()
                                .items_center()
                                .gap(px(6.))
                                .px(px(9.))
                                .py(px(6.))
                                .rounded(px(6.))
                                .bg(gpui::rgba((ACCENT << 8) | 0x24))
                                .text_color(rgb(ACCENT))
                                .text_size(text_length(13.))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(copy.connect_saved_server)
                                .child(icon("icons/arrow-right.svg", 14., ACCENT)),
                        )
                        .into_any_element(),
                )
                .disabled(self.session_request_pending)
                .on_click(cx.listener(move |app, _, window, cx| {
                    app.connect_address(address.clone(), window, cx)
                }))
        });

        div()
            .mt(px(12.))
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(entry_section_title(copy.saved_servers))
            .children(rows)
    }

    fn workspace(
        &self,
        name: &str,
        admission: &Admission,
        width: f32,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let body = match (&self.chat, self.selected_text(admission)) {
            (Some(chat), Some(channel)) => self.chat_view(
                admission,
                chat,
                channel,
                (width * 0.03).clamp(18., 34.),
                window,
                cx,
            ),
            _ => self.workspace_body(admission),
        };
        let scale = f32::from(self.preferences.message_size()) / 14.;
        if width <= COMPACT_WIDTH * scale.max(1.) {
            div()
                .size_full()
                .flex()
                .flex_col()
                .child(self.topbar(admission, WorkspaceLayout::Compact, width, cx))
                .when(self.channels_open, |workspace| {
                    workspace
                        .child(self.sidebar(name, admission, WorkspaceLayout::Compact, cx))
                        .child(self.profile(admission, WorkspaceLayout::Compact, cx))
                })
                .child(body)
                .children(
                    self.call
                        .as_ref()
                        .map(|call| self.voice_dock(call, WorkspaceLayout::Compact, cx)),
                )
        } else {
            div()
                .size_full()
                .flex()
                .child(
                    div()
                        .flex()
                        .flex_none()
                        .flex_col()
                        .w(px(SIDEBAR_WIDTH))
                        .min_h(px(0.))
                        .bg(rgb(NAVIGATION))
                        .border_r_1()
                        .border_color(rgb(LINE))
                        .child(self.sidebar(name, admission, WorkspaceLayout::Desktop, cx))
                        .children(
                            self.call
                                .as_ref()
                                .map(|call| self.voice_dock(call, WorkspaceLayout::Desktop, cx)),
                        )
                        .child(self.profile(admission, WorkspaceLayout::Desktop, cx)),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w(px(0.))
                        .child(self.topbar(admission, WorkspaceLayout::Desktop, width, cx))
                        .child(body),
                )
        }
    }

    fn sidebar(
        &self,
        name: &str,
        admission: &Admission,
        layout: WorkspaceLayout,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let compact = layout == WorkspaceLayout::Compact;
        let copy = self.language.copy();
        let mut groups = Vec::new();
        for (kind, heading) in [("text", copy.text_channels), ("voice", copy.voice_channels)] {
            let mut rows = Vec::new();
            let categories = std::iter::once(("", "")).chain(
                admission
                    .membership
                    .categories
                    .iter()
                    .map(|category| (category.id.as_str(), category.name.as_str())),
            );
            for (id, title) in categories {
                let channels = admission.membership.channels.iter().filter(|channel| {
                    channel.kind == kind
                        && channel.category_id == id
                        && (kind == "text" || !channel.archived)
                });
                let entries = channels
                    .map(|channel| {
                        if kind == "text" {
                            self.text_channel(channel, if compact { 40. } else { 36. }, cx)
                        } else {
                            self.voice_channel(channel, &admission.session, layout, cx)
                        }
                    })
                    .collect::<Vec<_>>();
                if !entries.is_empty() && !title.is_empty() {
                    rows.push(
                        div()
                            .px(px(7.))
                            .pt(px(7.))
                            .text_size(text_length(11.))
                            .text_color(rgb(MUTED))
                            .child(title.to_owned()),
                    );
                }
                rows.extend(entries);
            }
            if !rows.is_empty() {
                groups.push(channel_group(heading, rows));
            }
        }

        div()
            .flex()
            .flex_col()
            .bg(rgb(NAVIGATION))
            .min_h(px(0.))
            .when(compact, |sidebar| {
                sidebar.max_h(px(190.)).border_b_1().border_color(rgb(LINE))
            })
            .when(!compact, gpui::Styled::flex_1)
            .child(
                div()
                    .flex_none()
                    .flex()
                    .gap(px(12.))
                    .px(px(18.))
                    .pt(px(15.))
                    .pb(px(13.))
                    .border_b_1()
                    .border_color(rgb(LINE))
                    .when(compact, |header| {
                        header.items_center().justify_between().py(px(8.))
                    })
                    .when(!compact, gpui::Styled::flex_col)
                    .child(brand())
                    .child(
                        div()
                            .truncate()
                            .text_size(text_length(13.))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(name.to_owned()),
                    ),
            )
            .child(
                div()
                    .id("channel-list")
                    .min_h(px(0.))
                    .overflow_y_scroll()
                    .px(px(11.))
                    .pt(px(5.))
                    .pb(px(12.))
                    .children(groups),
            )
    }

    fn voice_channel(
        &self,
        channel: &Channel,
        session: &Session,
        layout: WorkspaceLayout,
        cx: &mut Context<Self>,
    ) -> Div {
        let compact = layout == WorkspaceLayout::Compact;
        let row_height = if compact { 40. } else { 36. };
        let (id, name, session) = (channel.id.clone(), channel.name.clone(), session.clone());
        let active_call = self.call.as_ref().filter(|call| call.channel_id == id);
        let selected = active_call.is_some();
        let row = Button::new(gpui::SharedString::from(format!("voice-channel-{id}")))
            .custom(
                ButtonCustomVariant::new(cx)
                    .hover(rgb(HOVER).into())
                    .active(rgb(SELECTED).into()),
            )
            .w_full()
            .h(px(row_height))
            .justify_start()
            .px(px(7.))
            .text_size(text_length(13.))
            .when(selected, |row| row.bg(rgb(SELECTED)))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(10.))
                    .min_w(px(0.))
                    .child(icon("icons/volume-2.svg", 16., MUTED))
                    .child(
                        div()
                            .truncate()
                            .text_size(text_length(13.))
                            .child(channel.name.clone()),
                    )
                    .into_any_element(),
            )
            .disabled(self.switching_server)
            .on_click(cx.listener(move |app, _, window, cx| {
                window.focus(&app.workspace_focus);
                app.join_voice(session.clone(), id.clone(), name.clone(), window, cx);
            }));
        div()
            .flex()
            .flex_col()
            .child(div().relative().child(row).when(selected, |row| {
                row.child(
                    div()
                        .absolute()
                        .left_0()
                        .top(px(4.))
                        .w(px(2.))
                        .h(px(row_height - 8.))
                        .rounded_full()
                        .bg(rgb(ACCENT)),
                )
            }))
            .when_some(active_call, |group, call| {
                group.child(
                    div()
                        .ml(px(20.))
                        .mb(px(5.))
                        .pl(px(11.))
                        .border_l_1()
                        .border_color(rgb(LINE))
                        .children(call.peers.iter().map(|peer| {
                            let id = peer.identity.clone();
                            let muted = call.muted_peers.contains(&id);
                            let copy = self.language.copy();
                            div()
                                .flex()
                                .items_center()
                                .gap(px(8.))
                                .py(px(5.))
                                .text_size(text_length(12.))
                                .text_color(rgb(MUTED))
                                .child(status_dot(if peer.speaking { ACCENT } else { MUTED }))
                                .child(div().flex_1().truncate().child(peer.name.clone()))
                                .when(!peer.local, |row| {
                                    row.child(
                                        Button::new(gpui::SharedString::from(format!("peer-{id}")))
                                            .ghost()
                                            .compact()
                                            .disabled(call.state != CallState::Connected)
                                            .h(px(24.))
                                            .w(px(24.))
                                            .tooltip(if muted {
                                                copy.unmute_playback
                                            } else {
                                                copy.mute_playback
                                            })
                                            .child(
                                                icon(
                                                    "icons/volume-2.svg",
                                                    12.,
                                                    if muted { DANGER } else { MUTED },
                                                )
                                                .into_any_element(),
                                            )
                                            .on_click(cx.listener(move |app, _, _, cx| {
                                                if let Some(call) = &mut app.call
                                                    && call
                                                        .commands
                                                        .send(Command::MutePeer(id.clone(), !muted))
                                                        .is_ok()
                                                {
                                                    if muted {
                                                        call.muted_peers.remove(&id);
                                                    } else {
                                                        call.muted_peers.insert(id.clone());
                                                    }
                                                    cx.notify();
                                                }
                                            })),
                                    )
                                })
                        })),
                )
            })
    }

    fn profile(
        &self,
        admission: &Admission,
        layout: WorkspaceLayout,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let compact = layout == WorkspaceLayout::Compact;
        let nickname = &admission.membership.participant.nickname;
        let initial: String = nickname
            .chars()
            .take(1)
            .flat_map(char::to_uppercase)
            .collect();
        div()
            .flex_none()
            .flex()
            .items_center()
            .gap(px(9.))
            .px(px(16.))
            .py(px(10.))
            .border_t_1()
            .border_color(rgb(LINE))
            .bg(rgb(NAVIGATION))
            .child(
                div()
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_center()
                    .size(px(32.))
                    .rounded_full()
                    .bg(rgb(SELECTED))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_size(text_length(13.))
                    .child(initial),
            )
            .child(
                div()
                    .flex_1()
                    .min_w(px(0.))
                    .child(
                        div()
                            .truncate()
                            .text_size(text_length(13.))
                            .font_weight(FontWeight::BOLD)
                            .child(nickname.clone()),
                    )
                    .child(
                        div()
                            .text_size(text_length(11.))
                            .text_color(rgb(MUTED))
                            .child(match admission.membership.participant.role.as_str() {
                                "owner" => self.language.copy().owner,
                                "moderator" => self.language.copy().moderator,
                                _ => self.language.copy().participant,
                            }),
                    ),
            )
            .when(compact, |profile| profile.child(self.display_controls(cx)))
            .when(admission.session.is_account(), |profile| {
                profile.child(
                    Button::new("sign-out")
                        .ghost()
                        .label(self.language.copy().sign_out)
                        .disabled(self.session_request_pending || self.call.is_some())
                        .on_click(cx.listener(|app, _, window, cx| app.sign_out(window, cx))),
                )
            })
    }

    fn topbar(
        &self,
        admission: &Admission,
        layout: WorkspaceLayout,
        width: f32,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let compact = layout == WorkspaceLayout::Compact;
        let copy = self.language.copy();
        let channel = self.selected_text(admission);
        let title = match (channel, &self.call) {
            (Some(channel), _) => channel.name.clone(),
            (_, Some(call)) => call.name.clone(),
            (_, None) if compact => copy.channels.into(),
            _ => copy.voice_channels.into(),
        };
        let glyph = if channel.is_some() {
            "icons/hash.svg"
        } else {
            "icons/volume-2.svg"
        };
        let label = div()
            .flex()
            .min_w(px(0.))
            .items_center()
            .gap(px(8.))
            .font_weight(FontWeight::BOLD)
            .text_size(text_length(15.))
            .child(icon(glyph, 17., MUTED))
            .child(div().truncate().child(title.clone()));
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(14.))
            .min_h(px(58.))
            .px(px((width * 0.03).clamp(18., 34.)))
            .border_b_1()
            .border_color(rgb(LINE))
            .when(compact, |bar| {
                bar.child(
                    Button::new("channels-toggle")
                        .ghost()
                        .flex_1()
                        .min_w(px(0.))
                        .justify_start()
                        .h(px(44.))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(9.))
                                .min_w(px(0.))
                                .child(icon("icons/panel-left.svg", 17., MUTED))
                                .child(div().truncate().child(title.clone()))
                                .child(icon("icons/chevron-down.svg", 15., MUTED))
                                .into_any_element(),
                        )
                        .on_click(cx.listener(|app, _, _, cx| {
                            app.channels_open = !app.channels_open;
                            cx.notify();
                        })),
                )
            })
            .when(!compact, |bar| {
                bar.child(div().flex_1().min_w(px(0.)).child(label)).child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .text_size(text_length(12.))
                        .text_color(rgb(MUTED))
                        .child(status_dot(MUTED))
                        .child(if self.events_connected {
                            copy.connected
                        } else {
                            copy.reconnecting
                        }),
                )
            })
            .child(
                Button::new("change-server")
                    .ghost()
                    .label(copy.change_server)
                    .disabled(self.session_request_pending || self.switching_server)
                    .on_click(cx.listener(|app, _, window, cx| app.change_server(window, cx))),
            )
            .when(!compact, |bar| bar.child(self.display_controls(cx)))
    }

    fn workspace_body(&self, admission: &Admission) -> Div {
        let copy = self.language.copy();
        div()
            .flex_1()
            .min_h(px(0.))
            .min_w(px(0.))
            .flex()
            .items_center()
            .justify_center()
            .px(px(24.))
            .child(
                div()
                    .w_full()
                    .max_w(px(408.))
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .text_size(text_length(14.))
                    .text_color(rgb(MUTED))
                    .when(self.call.is_none(), |body| body.child(copy.select_voice))
                    .when(!admission.credential_saved, |body| {
                        body.child(
                            div()
                                .text_size(text_length(12.))
                                .line_height(text_length(20.))
                                .child(copy.unsaved),
                        )
                    })
                    .children(self.render_error()),
            )
    }

    fn voice_dock(
        &self,
        call: &Call,
        layout: WorkspaceLayout,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let compact = layout == WorkspaceLayout::Compact;
        let copy = self.language.copy();
        let status = match call.state {
            CallState::Joining => copy.connecting,
            CallState::Reconnecting => copy.reconnecting,
            CallState::Leaving => copy.disconnecting,
            CallState::Connected if !call.can_publish => copy.listening_only,
            CallState::Connected if call.deafened => copy.deafen,
            CallState::Connected if call.microphone_active => copy.microphone_on_status,
            CallState::Connected => copy.microphone_muted_status,
        };
        let summary = div()
            .flex()
            .flex_1()
            .min_w(px(0.))
            .items_center()
            .gap(px(8.))
            .child(icon(
                "icons/volume-2.svg",
                16.,
                if call.microphone_active {
                    ACCENT
                } else {
                    MUTED
                },
            ))
            .child(
                div()
                    .min_w(px(0.))
                    .child(
                        div()
                            .truncate()
                            .font_weight(FontWeight::BOLD)
                            .text_size(text_length(13.))
                            .child(call.name.clone()),
                    )
                    .child(
                        div()
                            .truncate()
                            .text_size(text_length(11.))
                            .text_color(rgb(MUTED))
                            .child(status),
                    ),
            );
        let actions = self.voice_controls(call, if compact { 38. } else { 32. }, cx);

        div()
            .flex_none()
            .w_full()
            .flex()
            .items_center()
            .gap(px(if compact { 12. } else { 4. }))
            .px(px(12.))
            .py(px(9.))
            .bg(rgb(NAVIGATION))
            .border_t_1()
            .border_color(rgb(LINE))
            .child(summary)
            .child(actions)
    }

    fn voice_controls(&self, call: &Call, size: f32, cx: &mut Context<Self>) -> Div {
        let copy = self.language.copy();
        let (mic_label, mic_icon, mic_color) = if call.microphone_active {
            (copy.microphone_off, "icons/mic.svg", TEXT)
        } else {
            (copy.microphone_on, "icons/mic-off.svg", MUTED)
        };
        let mic_style = ButtonCustomVariant::new(cx)
            .color(
                rgb(if call.microphone_active {
                    SELECTED
                } else {
                    HOVER
                })
                .into(),
            )
            .hover(rgb(SELECTED).into())
            .active(rgb(SELECTED).into());
        let leave_style = ButtonCustomVariant::new(cx)
            .hover(rgb(DANGER_SURFACE).into())
            .active(rgb(DANGER_SURFACE).into());
        div()
            .flex()
            .flex_none()
            .gap(px(4.))
            .when(
                call.can_publish && !self.microphone_mode.is_push_to_talk(),
                |controls| {
                    controls.child(
                        voice_button("mute", mic_icon, mic_label, mic_color, mic_style)
                            .size(px(size))
                            .disabled(call.state != CallState::Connected || call.deafened)
                            .on_click(cx.listener(|app, _, _, cx| app.toggle_microphone(cx))),
                    )
                },
            )
            .child(
                voice_button(
                    "deafen",
                    "icons/headphones.svg",
                    if call.deafened {
                        copy.undeafen
                    } else {
                        copy.deafen
                    },
                    if call.deafened { DANGER } else { MUTED },
                    ButtonCustomVariant::new(cx).hover(rgb(HOVER).into()),
                )
                .size(px(size))
                .disabled(call.state != CallState::Connected)
                .on_click(cx.listener(|app, _, _, cx| {
                    if let Some(call) = &mut app.call {
                        let next = !call.deafened;
                        if call.commands.send(Command::Deafen(next)).is_ok() {
                            call.deafened = next;
                            if next {
                                call.microphone_intent.send_replace(false);
                                app.microphone_mode.release_key();
                            }
                            cx.notify();
                        }
                    }
                })),
            )
            .child(self.audio_devices(call, size, cx))
            .child(
                voice_button(
                    "leave",
                    "icons/phone-off.svg",
                    copy.leave,
                    DANGER,
                    leave_style,
                )
                .size(px(size))
                .disabled(call.state == CallState::Leaving)
                .on_click(cx.listener(|app, _, _, cx| {
                    if let Some(call) = &mut app.call {
                        call.leave();
                        app.microphone_mode.release_key();
                        cx.notify();
                    }
                })),
            )
    }

    fn audio_devices(&self, call: &Call, size: f32, cx: &mut Context<Self>) -> impl IntoElement {
        let copy = self.language.copy();
        let app = cx.entity().downgrade();
        let can_publish = call.can_publish;
        let push_to_talk = self.microphone_mode.is_push_to_talk();
        let microphones = call.microphones.clone();
        let outputs = call.outputs.clone();
        let commands = call.commands.clone();
        voice_button(
            "audio-devices",
            "icons/sliders-horizontal.svg",
            copy.audio_settings,
            MUTED,
            ButtonCustomVariant::new(cx).hover(rgb(HOVER).into()),
        )
        .size(px(size))
        .disabled(call.state != CallState::Connected)
        .dropdown_menu_with_anchor(Corner::BottomLeft, move |mut menu, _, _| {
            if can_publish {
                let app = app.clone();
                menu = menu.item(
                    PopupMenuItem::new(format!(
                        "{} ({})",
                        copy.push_to_talk, copy.push_to_talk_key
                    ))
                    .checked(push_to_talk)
                    .on_click(move |_, window, cx| {
                        let _ = app.update(cx, |app, cx| app.toggle_push_to_talk(window, cx));
                    }),
                );
            }
            let refresh = commands.clone();
            menu = menu.item(
                PopupMenuItem::new(copy.refresh_devices).on_click(move |_, _, _| {
                    let _ = refresh.send(Command::RefreshDevices);
                }),
            );
            for device in &microphones {
                let sender = commands.clone();
                let id = device.id.clone();
                menu = menu.item(
                    PopupMenuItem::new(format!("{} · {}", copy.microphone_devices, device.name))
                        .on_click(move |_, _, _| {
                            let _ = sender.send(Command::SelectMicrophone(id.clone()));
                        }),
                );
            }
            for device in &outputs {
                let sender = commands.clone();
                let id = device.id.clone();
                menu = menu.item(
                    PopupMenuItem::new(format!("{} · {}", copy.output_devices, device.name))
                        .on_click(move |_, _, _| {
                            let _ = sender.send(Command::Output(id.clone()));
                        }),
                );
            }
            menu
        })
    }

    fn display_controls(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let copy = self.language.copy();
        let current_size = self.preferences.message_size();
        let owner = cx.entity().downgrade();
        let settings = outline_button("display-settings", cx)
            .tooltip(copy.settings)
            .child(icon("icons/sliders-horizontal.svg", 16., TEXT).into_any_element())
            .dropdown_menu_with_anchor(Corner::TopRight, move |menu, _, _| {
                let menu = menu.label(copy.message_size);
                super::Preferences::MESSAGE_SIZES
                    .into_iter()
                    .fold(menu, |menu, size| {
                        let owner = owner.clone();
                        let label = if size == 14 {
                            format!("{} (14 px)", copy.default_size)
                        } else {
                            format!("{size} px")
                        };
                        menu.item(
                            PopupMenuItem::new(label)
                                .checked(current_size == size)
                                .on_click(move |_, _, cx| {
                                    let _ = owner.update(cx, |app, cx| {
                                        app.preferences.message_size = Some(size);
                                        app.preferences.save();
                                        super::appearance::apply_message_size(size, cx);
                                        cx.refresh_windows();
                                    });
                                }),
                        )
                    })
            });
        let current = self.language;
        let app = cx.entity().downgrade();
        let menu = outline_button("locale", cx)
            .h(px(34.))
            .px(px(9.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(div().text_size(text_length(12.)).child(current.code()))
                    .child(icon("icons/chevron-down.svg", 12., TEXT))
                    .into_any_element(),
            )
            .dropdown_menu_with_anchor(Corner::TopRight, move |menu, _, _| {
                [Language::English, Language::Polish]
                    .into_iter()
                    .fold(menu, |menu, language| {
                        let app = app.clone();
                        menu.item(
                            PopupMenuItem::new(language.code())
                                .checked(current == language)
                                .on_click(move |_, window, cx| {
                                    let _ = app.update(cx, |app, cx| {
                                        app.language = language;
                                        app.preferences.language =
                                            Some(language.code().to_ascii_lowercase());
                                        app.preferences.save();
                                        app.message_input.update(cx, |input, cx| {
                                            input.set_placeholder(
                                                language.copy().message_placeholder,
                                                window,
                                                cx,
                                            );
                                        });
                                        cx.notify();
                                    });
                                }),
                        )
                    })
            });
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(8.))
            .child(
                div()
                    .text_size(text_length(12.))
                    .text_color(rgb(MUTED))
                    .child(self.language.copy().language),
            )
            .child(menu)
            .child(settings)
    }

    pub(super) fn render_error(&self) -> Option<Div> {
        self.error.map(|error| {
            div()
                .text_size(text_length(13.))
                .line_height(text_length(20.))
                .text_color(rgb(DANGER))
                .child(self.language.failure(error))
        })
    }
}

fn channel_group(title: &'static str, rows: impl IntoIterator<Item = Div>) -> Div {
    div()
        .child(
            div()
                .mt(px(18.))
                .mb(px(6.))
                .mx(px(9.))
                .text_size(text_length(11.))
                .text_color(rgb(MUTED))
                .font_weight(FontWeight::SEMIBOLD)
                .child(title),
        )
        .child(div().flex().flex_col().gap(px(3.)).children(rows))
}

fn entry_section_title(title: &'static str) -> Div {
    div()
        .text_size(text_length(14.))
        .font_weight(FontWeight::SEMIBOLD)
        .child(title)
}

fn server_identity(name: &str, address: &str) -> Div {
    div()
        .min_w(px(0.))
        .flex()
        .items_center()
        .gap(px(12.))
        .child(
            div()
                .size(px(40.))
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(6.))
                .bg(gpui::rgba((ACCENT << 8) | 0x32))
                .child(icon("icons/server.svg", 18., ACCENT)),
        )
        .child(
            div()
                .flex_1()
                .min_w(px(0.))
                .flex()
                .flex_col()
                .gap(px(2.))
                .child(
                    div()
                        .truncate()
                        .text_color(rgb(TEXT))
                        .text_size(text_length(16.))
                        .line_height(text_length(20.))
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(name.to_owned()),
                )
                .child(
                    div()
                        .truncate()
                        .text_size(text_length(12.))
                        .line_height(text_length(16.))
                        .text_color(rgb(MUTED))
                        .child(address.to_owned()),
                ),
        )
}

fn entry_title(title: &'static str, width: f32) -> Div {
    let size = (width * 0.04).clamp(27., 34.);
    div()
        .text_size(text_length(size))
        .line_height(text_length(size * 1.13))
        .font_weight(FontWeight::BOLD)
        .child(title)
}

fn entry_description(description: &'static str) -> Div {
    div()
        .text_size(text_length(14.))
        .line_height(text_length(22.))
        .text_color(rgb(MUTED))
        .child(description)
}

fn primary_entry(id: &'static str, label: &'static str, pending: bool) -> Button {
    Button::new(id)
        .primary()
        .w_full()
        .h(px(47.))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(10.))
                .text_size(text_length(14.))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(rgb(NAVIGATION))
                .child(label)
                .when(!pending, |content| {
                    content.child(icon("icons/arrow-right.svg", 18., NAVIGATION))
                })
                .into_any_element(),
        )
        .loading(pending)
        .disabled(pending)
}

fn field(
    label: &'static str,
    state: &Entity<InputState>,
    pending: bool,
    window: &Window,
    cx: &Context<Yapper>,
) -> impl IntoElement {
    let focused = state.read(cx).focus_handle(cx).is_focused(window);
    div()
        .flex()
        .flex_col()
        .gap(px(8.))
        .child(
            div()
                .text_size(text_length(13.))
                .line_height(text_length(17.))
                .child(label),
        )
        .child(
            div()
                .h(px(48.))
                .flex()
                .items_center()
                .rounded(px(7.))
                .border_1()
                .border_color(rgb(if focused { ACCENT } else { CONTROL_LINE }))
                .bg(rgb(NAVIGATION))
                .child(
                    Input::new(state)
                        .appearance(false)
                        .px(px(14.))
                        .disabled(pending),
                ),
        )
}
