use std::io;

use crossterm::event::{Event, KeyCode};
use ratatui::{
    DefaultTerminal, Frame,
    layout::{Constraint, Layout, Rect},
    style::{Color, Style},
    widgets::{Paragraph, Wrap},
};
use tokio::task::JoinHandle;

use crate::{
    Input, InputMode,
    api::{Error, Installation, Membership, Server, Session, Storage},
    copy::{Label, Language},
    field::{Field, safe_text},
    read_event, shortcut_view,
    shortcuts::{Shortcut, Shortcuts},
};

pub(crate) struct Joined {
    pub session: Session,
    pub membership: Membership,
    pub name: String,
    pub storage: Storage,
}

pub(crate) async fn launch(
    terminal: &mut DefaultTerminal,
    input: &mut Input,
    language: &mut Language,
    shortcuts: &mut Shortcuts,
    address: String,
) -> io::Result<Option<Joined>> {
    let mut model = Launcher {
        address: Field::with_text(address),
        ..Launcher::default()
    };
    loop {
        terminal.draw(|frame| model.draw(frame, *language, shortcuts))?;
        tokio::select! {
            event = read_event(input, InputMode::Normal) => match event? {
                None => break,
                Some(Event::Key(key)) if key.code == shortcut_view::SETTINGS_KEY => {
                    if !shortcut_view::edit(terminal, input, shortcuts, *language).await? {
                        break;
                    }
                }
                Some(Event::Key(key)) if key.code == KeyCode::F(1) => language.switch(),
                Some(event) if model.job.is_none() => model.input(event),
                _ => {}
            },
            result = async {
                if let Some(job) = &mut model.job {
                    job.await.unwrap_or(Err(Error::Data))
                } else {
                    std::future::pending().await
                }
            } => {
                model.job = None;
                match result {
                    Ok(Outcome::Form { server, installation, notice }) => {
                        model.server = Some((server, installation));
                        model.notice = notice;
                    }
                    Ok(Outcome::Membership { session, installation, storage, membership }) => match membership {
                        Ok(membership) => return Ok(Some(Joined { session, membership, name: installation.name, storage })),
                        Err(error) => {
                            model.invite = Field::default();
                            model.notice = Some(error);
                            if matches!(error, Error::Denied | Error::Blocked) {
                                model.server = Some((session.server.clone(), installation));
                                model.pending = None;
                                // Re-admission uses the rejected cookie so Go can still enforce bans.
                                model.previous = Some(session);
                            } else {
                                model.pending = Some((session, installation, storage));
                            }
                        }
                    },
                    Err(error) => model.notice = Some(error),
                }
            },
        }
    }
    if let Some(job) = model.job {
        job.abort();
    }
    Ok(None)
}

#[derive(Default)]
struct Launcher {
    address: Field,
    nickname: Field,
    invite: Field,
    invite_focused: bool,
    temporary: bool,
    notice: Option<Error>,
    server: Option<(Server, Installation)>,
    pending: Option<(Session, Installation, Storage)>,
    previous: Option<Session>,
    job: Option<JoinHandle<Result<Outcome, Error>>>,
}

enum Outcome {
    Form {
        server: Server,
        installation: Installation,
        notice: Option<Error>,
    },
    Membership {
        session: Session,
        installation: Installation,
        storage: Storage,
        membership: Result<Membership, Error>,
    },
}

impl Launcher {
    fn input(&mut self, event: Event) {
        match event {
            Event::Key(key) => match key.code {
                KeyCode::Enter => self.submit(),
                KeyCode::Tab | KeyCode::BackTab if self.needs_invite() => {
                    self.invite_focused = !self.invite_focused
                }
                KeyCode::F(3) if self.server.is_some() && self.pending.is_none() => {
                    self.temporary = !self.temporary;
                    if self.temporary && self.notice == Some(Error::Vault) {
                        self.notice = None;
                    }
                }
                KeyCode::Esc => {
                    self.server = None;
                    self.pending = None;
                    self.previous = None;
                    self.notice = None;
                    self.temporary = false;
                    self.invite_focused = false;
                    self.invite = Field::default();
                }
                _ if self.pending.is_none() => {
                    let (field, limit) = self.active_field();
                    field.edit(key, limit);
                }
                _ => {}
            },
            Event::Paste(text) if self.pending.is_none() => {
                let (field, limit) = self.active_field();
                field.paste(&text, limit);
            }
            _ => {}
        }
    }

    fn active_field(&mut self) -> (&mut Field, usize) {
        if self.server.is_none() {
            (&mut self.address, 512)
        } else if self.invite_focused {
            (&mut self.invite, 128)
        } else {
            (&mut self.nickname, 32)
        }
    }

    fn needs_invite(&self) -> bool {
        self.server
            .as_ref()
            .is_some_and(|(_, installation)| !installation.open_admission)
    }

    fn submit(&mut self) {
        if let Some((session, installation, storage)) = &self.pending {
            let (session, installation, storage) =
                (session.clone(), installation.clone(), *storage);
            self.job = Some(tokio::spawn(async move {
                Ok(finish(session, installation, storage).await)
            }));
        } else if let Some((server, installation)) = &self.server {
            if self.notice == Some(Error::Vault) && !self.temporary {
                return;
            }
            let server = server.clone();
            let installation = installation.clone();
            let previous = self.previous.clone();
            let nickname = self.nickname.text.clone();
            let invitation = self.invite.text.clone();
            let storage = if self.temporary {
                Storage::Temporary
            } else {
                Storage::Remember
            };
            self.job = Some(tokio::spawn(async move {
                let (session, storage) = server
                    .admit(&nickname, &invitation, storage, previous.as_ref())
                    .await?;
                Ok(finish(session, installation, storage).await)
            }));
        } else {
            let address = self.address.text.clone();
            self.job = Some(tokio::spawn(async move {
                let (server, installation) = Server::connect(&address).await?;
                let notice = match server.restore().await {
                    Ok(Some(session)) => {
                        return Ok(finish(session, installation, Storage::Remember).await);
                    }
                    Ok(None) => None,
                    Err(Error::Vault) => Some(Error::Vault),
                    Err(error) => return Err(error),
                };
                Ok(Outcome::Form {
                    server,
                    installation,
                    notice,
                })
            }));
        }
        self.notice = None;
    }

    fn draw(&self, frame: &mut Frame, lang: Language, shortcuts: &Shortcuts) {
        let editing = self.job.is_none() && self.pending.is_none();
        let settings = lang.label(Label::ConfigureShortcuts);
        let mut entries = Vec::new();
        if self.job.is_none() {
            let submit = if !editing {
                Label::RetryConnection
            } else if self.server.is_some() {
                Label::Join
            } else {
                Label::Connect
            };
            entries.push(("Enter".to_owned(), lang.label(submit)));
            if editing && self.needs_invite() {
                entries.push(("Tab".to_owned(), lang.label(Label::NextField)));
            }
            if editing && self.server.is_some() {
                entries.push(("F3".to_owned(), lang.label(Label::SessionMode)));
            }
        }
        entries.extend([
            ("F1".to_owned(), lang.label(Label::SwitchLanguage)),
            ("F2".to_owned(), settings),
        ]);
        if self.job.is_none() && (self.server.is_some() || self.pending.is_some()) {
            entries.push(("Esc".to_owned(), lang.label(Label::Back)));
        }
        entries.push(("Ctrl+C".to_owned(), lang.shortcut(Shortcut::Quit)));
        let lines = shortcut_view::grid(&entries, ("F2", settings), frame.area());
        let [header, body, footer] = Layout::vertical([
            Constraint::Length(2),
            Constraint::Min(1),
            Constraint::Length(lines.len() as u16 + 1),
        ])
        .areas(frame.area());
        frame.render_widget(
            Paragraph::new(" Yapper").style(Style::default().fg(Color::Cyan).bold()),
            header,
        );
        let body = Rect {
            width: body.width.min(66),
            ..body
        };
        let [title, first, second, detail, feedback] = Layout::vertical([
            Constraint::Length(1),
            Constraint::Length(2),
            Constraint::Length(2),
            Constraint::Length(1),
            Constraint::Min(1),
        ])
        .areas(body);
        if let Some((_, installation)) = &self.server {
            frame.render_widget(Paragraph::new(safe_text(&installation.name)), title);
        }
        if let Some((_, installation, _)) = &self.pending {
            frame.render_widget(Paragraph::new(safe_text(&installation.name)), title);
        } else if self.server.is_some() {
            draw_field(
                frame,
                first,
                lang.label(Label::Nickname),
                &self.nickname,
                self.invite_focused || !editing,
                false,
            );
            if self.needs_invite() {
                draw_field(
                    frame,
                    second,
                    lang.label(Label::Invitation),
                    &self.invite,
                    !self.invite_focused || !editing,
                    true,
                );
            }
            let storage = if self.temporary {
                Storage::Temporary
            } else {
                Storage::Remember
            };
            frame.render_widget(Paragraph::new(lang.storage(storage)), detail);
        } else {
            draw_field(
                frame,
                first,
                lang.label(Label::ServerAddress),
                &self.address,
                !editing,
                false,
            );
        }
        if self.job.is_some() {
            frame.render_widget(Paragraph::new(lang.label(Label::Working)), feedback);
        } else if let Some(error) = self.notice {
            frame.render_widget(
                Paragraph::new(lang.error(error))
                    .wrap(Wrap { trim: true })
                    .style(Style::default().fg(Color::Yellow)),
                feedback,
            );
        } else if let Some(notice) = shortcuts.startup_notice {
            frame.render_widget(
                Paragraph::new(lang.shortcut_notice(notice)).wrap(Wrap { trim: true }),
                feedback,
            );
        }
        shortcut_view::draw_footer(frame, footer, lines);
    }
}

async fn finish(session: Session, installation: Installation, storage: Storage) -> Outcome {
    let membership = session.membership().await;
    Outcome::Membership {
        session,
        installation,
        storage,
        membership,
    }
}

pub(crate) fn draw_value(
    frame: &mut Frame,
    area: Rect,
    field: &Field,
    focused: bool,
    masked: bool,
) {
    if area.width == 0 || area.height == 0 {
        return;
    }
    let (text, cursor) = field.display(masked);
    let start = cursor.saturating_sub(area.width.saturating_sub(1));
    frame.render_widget(Paragraph::new(text).scroll((0, start)), area);
    if focused {
        frame.set_cursor_position((area.x + cursor - start, area.y));
    }
}

fn draw_field(
    frame: &mut Frame,
    area: Rect,
    label: &str,
    field: &Field,
    inactive: bool,
    masked: bool,
) {
    let [title, value] =
        Layout::vertical([Constraint::Length(1), Constraint::Length(1)]).areas(area);
    let color = if inactive { Color::Reset } else { Color::Cyan };
    frame.render_widget(
        Paragraph::new(label).style(Style::default().fg(color)),
        title,
    );
    draw_value(frame, value, field, !inactive, masked);
}
