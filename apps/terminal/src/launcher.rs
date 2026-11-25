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
    Input,
    api::{Error, Installation, Membership, Server, Session, Storage},
    copy::{Label, Language},
    field::{Field, safe_text},
    read_event,
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
    address: String,
) -> io::Result<Option<Joined>> {
    let mut model = Launcher {
        address: Field::with_text(address),
        ..Launcher::default()
    };
    loop {
        terminal.draw(|frame| model.draw(frame, *language))?;
        tokio::select! {
            event = read_event(input) => match event? {
                None => {
                    if let Some(job) = model.job {
                        job.abort();
                    }
                    return Ok(None);
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
                    Ok(Outcome::Membership { session, name, storage, membership }) => match membership {
                        Ok(membership) => return Ok(Some(Joined { session, membership, name, storage })),
                        Err(error) => {
                            model.pending = Some((session, name, storage));
                            model.invite = Field::default();
                            model.notice = Some(error);
                        }
                    },
                    Err(error) => model.notice = Some(error),
                }
            },
        }
    }
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
    pending: Option<(Session, String, Storage)>,
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
        name: String,
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
        if let Some((session, name, storage)) = &self.pending {
            let (session, name, storage) = (session.clone(), name.clone(), *storage);
            self.job = Some(tokio::spawn(async move {
                Ok(finish(session, name, storage).await)
            }));
        } else if let Some((server, installation)) = &self.server {
            if self.notice == Some(Error::Vault) && !self.temporary {
                return;
            }
            let server = server.clone();
            let name = installation.name.clone();
            let nickname = self.nickname.text.clone();
            let invitation = self.invite.text.clone();
            let storage = if self.temporary {
                Storage::Temporary
            } else {
                Storage::Remember
            };
            self.job = Some(tokio::spawn(async move {
                let (session, storage) = server.admit(&nickname, &invitation, storage).await?;
                Ok(finish(session, name, storage).await)
            }));
        } else {
            let address = self.address.text.clone();
            self.job = Some(tokio::spawn(async move {
                let (server, installation) = Server::connect(&address).await?;
                let notice = match server.restore().await {
                    Ok(Some(session)) => {
                        return Ok(finish(session, installation.name, Storage::Remember).await);
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

    fn draw(&self, frame: &mut Frame, lang: Language) {
        let [header, body, footer] = Layout::vertical([
            Constraint::Length(2),
            Constraint::Min(1),
            Constraint::Length(3),
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
        let editing = self.job.is_none() && self.pending.is_none();
        if self.pending.is_some() {
            frame.render_widget(Paragraph::new(lang.label(Label::RetryConnection)), first);
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
            frame.render_widget(
                Paragraph::new(format!("F3  {}", lang.storage(storage))),
                detail,
            );
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
        }
        frame.render_widget(
            Paragraph::new(lang.label(Label::LaunchShortcuts)).wrap(Wrap { trim: true }),
            footer,
        );
    }
}

async fn finish(session: Session, name: String, storage: Storage) -> Outcome {
    let membership = session.membership().await;
    Outcome::Membership {
        session,
        name,
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
