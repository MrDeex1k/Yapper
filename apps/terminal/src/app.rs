use std::{collections::HashMap, io};

use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};
use ratatui::{
    DefaultTerminal, Frame,
    layout::{Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Wrap},
};
use uuid::Uuid;

use crate::{
    Input,
    api::{Channel, Error, Kind, Storage},
    copy::{Label, Language},
    events::Link,
    field::{Field, safe_message, safe_text},
    launcher::{Joined, draw_value},
    read_event, shortcut_view,
    shortcuts::{Binding, Shortcut, Shortcuts},
    voice,
    workspace::{Action, Snapshot, Workspace},
};

const COMPOSE_LIMIT: usize = 2000;
const WIDE_TERMINAL: u16 = 76;
const ACCENT: Color = Color::Cyan;

pub(crate) async fn run(
    terminal: &mut DefaultTerminal,
    input: &mut Input,
    language: &mut Language,
    shortcuts: &mut Shortcuts,
    joined: Joined,
) -> io::Result<bool> {
    let mut work = Workspace::start(joined.session, joined.membership);
    let mut model = App {
        name: joined.name,
        storage: joined.storage,
        cursor: *work.selected.borrow(),
        ..App::default()
    };
    let result = interact(terminal, input, language, shortcuts, &mut model, &mut work).await;
    work.close().await;
    result
}

async fn interact(
    terminal: &mut DefaultTerminal,
    input: &mut Input,
    language: &mut Language,
    shortcuts: &mut Shortcuts,
    model: &mut App,
    work: &mut Workspace,
) -> io::Result<bool> {
    let mut snapshot_open = true;
    let mut voice_open = true;
    loop {
        let snapshot = work.snapshot.borrow_and_update().clone();
        let voice = *work.voice.borrow_and_update();
        model.update(&snapshot);
        terminal.draw(|frame| model.draw(frame, &snapshot, voice, *language, shortcuts))?;
        tokio::select! {
            event = read_event(input) => match event? {
                None => return Ok(false),
                Some(Event::Key(key)) if key.code == shortcut_view::SETTINGS_KEY => {
                    if !shortcut_view::edit(terminal, input, shortcuts, *language).await? {
                        return Ok(false);
                    }
                }
                Some(Event::Key(key)) => match shortcuts.action(key) {
                    Some(Shortcut::Language) => language.switch(),
                    Some(Shortcut::Server) => return Ok(true),
                    Some(Shortcut::Quit) => return Ok(false),
                    action => model.key(key, action, &snapshot, work),
                },
                Some(Event::Paste(text)) => model.paste(&text, &snapshot, work),
                _ => {},
            },
            updated = work.snapshot.changed(), if snapshot_open => snapshot_open = updated.is_ok(),
            updated = work.voice.changed(), if voice_open => voice_open = updated.is_ok(),
        }
    }
}

#[derive(Default)]
struct App {
    name: String,
    storage: Storage,
    cursor: Option<Uuid>,
    focus: Focus,
    drafts: HashMap<Uuid, Draft>,
    sending: Option<(Uuid, Uuid)>,
    list: ListState,
    scroll_back: u16,
}

#[derive(Default)]
struct Draft {
    field: Field,
    request: Option<Uuid>,
}

enum ComposeInput {
    Send,
    Edit(KeyEvent),
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum Focus {
    #[default]
    Channels,
    Compose,
}

impl App {
    fn update(&mut self, snapshot: &Snapshot) {
        if !self
            .cursor
            .is_some_and(|id| channel_entries(snapshot).any(|entry| entry.id == id))
        {
            self.cursor = channel_entries(snapshot).next().map(|entry| entry.id);
        }
        if let (Some((channel, attempt)), Some((sent, result))) = (self.sending, snapshot.sent)
            && attempt == sent
        {
            self.sending = None;
            let draft = self.drafts.entry(channel).or_default();
            match result {
                Ok(()) | Err(Error::Gone) => {
                    self.drafts.remove(&channel);
                }
                Err(Error::Network | Error::RateLimit | Error::Data) => {}
                Err(_) => draft.request = None,
            }
        }
    }

    fn paste(&mut self, text: &str, snapshot: &Snapshot, work: &Workspace) {
        if self.focus == Focus::Compose && !matches!(snapshot.link, Link::Removed(_)) {
            let draft = self.draft(*work.selected.borrow());
            if let Some(draft) = draft.filter(|draft| draft.request.is_none()) {
                draft.field.paste(text, COMPOSE_LIMIT);
            }
        }
    }

    fn key(
        &mut self,
        key: KeyEvent,
        action: Option<Shortcut>,
        snapshot: &Snapshot,
        work: &Workspace,
    ) {
        if matches!(snapshot.link, Link::Removed(_)) {
            return;
        }
        match action {
            Some(Shortcut::Focus) => {
                self.focus = if self.focus == Focus::Channels {
                    Focus::Compose
                } else {
                    Focus::Channels
                };
            }
            Some(Shortcut::Microphone) => {
                let _ = work.actions.try_send(Action::Microphone);
            }
            Some(Shortcut::Older) => {
                if let Some(channel) = *work.selected.borrow() {
                    let _ = work.actions.try_send(Action::Older(channel));
                }
            }
            Some(Shortcut::Leave) => {
                let _ = work.actions.try_send(Action::Leave);
            }
            Some(Shortcut::Refresh) => {
                let _ = work.actions.try_send(Action::Refresh);
            }
            Some(Shortcut::ScrollUp) => self.scroll_back = self.scroll_back.saturating_add(8),
            Some(Shortcut::ScrollDown) => self.scroll_back = self.scroll_back.saturating_sub(8),
            Some(Shortcut::Open) if self.focus == Focus::Channels => self.open(snapshot, work),
            Some(Shortcut::Open) => self.compose(ComposeInput::Send, snapshot, work),
            None => self.edit_key(key, snapshot, work),
            _ => {}
        }
    }

    fn edit_key(&mut self, key: KeyEvent, snapshot: &Snapshot, work: &Workspace) {
        match key.code {
            KeyCode::Esc => self.focus = Focus::Channels,
            KeyCode::Up | KeyCode::Down if self.focus == Focus::Channels => {
                let choices: Vec<_> = channel_entries(snapshot).map(|entry| entry.id).collect();
                if let Some(index) = self
                    .cursor
                    .and_then(|current| choices.iter().position(|&id| id == current))
                {
                    let next = if key.code == KeyCode::Up {
                        index.saturating_sub(1)
                    } else {
                        index + 1
                    };
                    self.cursor = choices.get(next).copied().or(self.cursor);
                }
            }
            _ if self.focus == Focus::Compose => {
                self.compose(ComposeInput::Edit(key), snapshot, work)
            }
            _ => {}
        }
    }

    fn open(&mut self, snapshot: &Snapshot, work: &Workspace) {
        let Some(channel) = channel_entries(snapshot).find(|entry| Some(entry.id) == self.cursor)
        else {
            return;
        };
        match channel.kind {
            Kind::Text => {
                if *work.selected.borrow() != Some(channel.id) {
                    work.selected.send_replace(Some(channel.id));
                    self.scroll_back = 0;
                }
                self.focus = Focus::Compose;
            }
            Kind::Voice if !channel.archived => {
                let _ = work.actions.try_send(Action::Join(channel.id));
            }
            _ => {}
        }
    }

    fn draft(&mut self, channel: Option<Uuid>) -> Option<&mut Draft> {
        channel.map(|channel| self.drafts.entry(channel).or_default())
    }

    fn compose(&mut self, input: ComposeInput, snapshot: &Snapshot, work: &Workspace) {
        let Some(channel) = *work.selected.borrow() else {
            return;
        };
        if self.sending.is_some()
            || !channel_entries(snapshot).any(|entry| entry.id == channel && !entry.archived)
        {
            return;
        }
        let draft = self.drafts.entry(channel).or_default();
        if matches!(input, ComposeInput::Send) {
            let body = draft.field.text.trim();
            if !body.is_empty() {
                let request = draft.request.unwrap_or_else(Uuid::new_v4);
                let attempt = Uuid::new_v4();
                if work
                    .actions
                    .try_send(Action::Send {
                        channel,
                        attempt,
                        request,
                        body: body.to_owned(),
                    })
                    .is_ok()
                {
                    draft.request = Some(request);
                    self.sending = Some((channel, attempt));
                    self.scroll_back = 0;
                }
            }
        } else if let ComposeInput::Edit(key) = input {
            if key.code == KeyCode::Char('u') && key.modifiers == KeyModifiers::CONTROL {
                *draft = Draft::default();
            } else if draft.request.is_none() {
                draft.field.edit(key, COMPOSE_LIMIT);
            }
        }
    }

    fn draw(
        &mut self,
        frame: &mut Frame,
        snapshot: &Snapshot,
        voice: voice::State,
        lang: Language,
        shortcuts: &Shortcuts,
    ) {
        let wide = frame.area().width >= WIDE_TERMINAL;
        let lines = shortcut_view::footer(shortcuts, lang, frame.area());
        let notice = snapshot
            .notice
            .map(|notice| lang.error(notice))
            .or_else(|| {
                shortcuts
                    .startup_notice
                    .map(|notice| lang.shortcut_notice(notice))
            })
            .or_else(|| (self.storage == Storage::Temporary).then(|| lang.storage(self.storage)));
        let [heading, content, feedback, footer] = Layout::vertical([
            Constraint::Length(if wide { 2 } else { 3 }),
            Constraint::Min(1),
            Constraint::Length(u16::from(notice.is_some())),
            Constraint::Length(lines.len() as u16 + 1),
        ])
        .areas(frame.area());
        let open = shortcuts.key(Shortcut::Open);
        let brand = Line::from(vec![
            Span::styled(" Yapper  ", Style::default().fg(ACCENT).bold()),
            Span::raw(safe_text(&self.name)),
        ]);
        let nickname = safe_text(&snapshot.membership.participant.nickname);
        let room = snapshot
            .call_channel
            .and_then(|id| channel_entries(snapshot).find(|entry| entry.id == id));
        let voice_label = match room {
            Some(room) if !matches!(voice, voice::State::Idle | voice::State::Failed(_)) => {
                format!("{} · {}", lang.voice(voice), safe_text(&room.name))
            }
            _ => lang.voice(voice).to_owned(),
        };
        let link = lang.link(snapshot.link);
        let heading_lines = if wide {
            vec![
                brand,
                Line::from(format!(" {nickname} · {link}  |  {voice_label}")),
            ]
        } else {
            vec![
                brand,
                Line::from(format!(" {nickname} · {link}")),
                Line::from(format!(" {voice_label}")),
            ]
        };
        frame.render_widget(Paragraph::new(heading_lines), heading);
        if wide {
            let [navigation, chat] =
                Layout::horizontal([Constraint::Length(26), Constraint::Min(1)]).areas(content);
            self.draw_channels(frame, navigation, snapshot, lang);
            self.draw_chat(frame, chat, snapshot, lang, open);
        } else if self.focus == Focus::Channels {
            self.draw_channels(frame, content, snapshot, lang);
        } else {
            self.draw_chat(frame, content, snapshot, lang, open);
        }

        if let Some(notice) = notice {
            frame.render_widget(
                Paragraph::new(notice).style(Style::default().fg(Color::Yellow)),
                feedback,
            );
        }
        shortcut_view::draw_footer(frame, footer, lines);
    }

    fn draw_channels(
        &mut self,
        frame: &mut Frame,
        area: Rect,
        snapshot: &Snapshot,
        lang: Language,
    ) {
        let active = self.focus == Focus::Channels;
        let title = lang.label(Label::Channels);
        let items = channel_entries(snapshot).map(|entry| {
            let prefix = match entry.kind {
                Kind::Voice => "~",
                _ => "#",
            };
            let archive = if entry.archived {
                lang.label(Label::Archive)
            } else {
                ""
            };
            ListItem::new(format!("{prefix} {}{archive}", safe_text(&entry.name)))
        });
        let index = channel_entries(snapshot).position(|entry| Some(entry.id) == self.cursor);
        self.list.select(index);
        let list = List::new(items)
            .block(
                Block::new()
                    .borders(Borders::RIGHT)
                    .title(title)
                    .title_style(focus_style(active)),
            )
            .highlight_symbol("› ")
            .highlight_style(focus_style(active).add_modifier(Modifier::BOLD));
        frame.render_stateful_widget(list, area, &mut self.list);
    }

    fn draw_chat(
        &mut self,
        frame: &mut Frame,
        area: Rect,
        snapshot: &Snapshot,
        lang: Language,
        open: Binding,
    ) {
        let [title, history, compose] = Layout::vertical([
            Constraint::Length(1),
            Constraint::Min(1),
            Constraint::Length(2),
        ])
        .areas(area);
        let history_data = &snapshot.history;
        let channel =
            channel_entries(snapshot).find(|entry| Some(entry.id) == history_data.channel);
        let Some(channel) = channel else {
            frame.render_widget(Paragraph::new(lang.label(Label::SelectChannel)), title);
            return;
        };
        frame.render_widget(
            Paragraph::new(format!("# {}", safe_text(&channel.name)))
                .style(Style::default().bold()),
            title,
        );
        let mut lines = Vec::new();
        for entry in &history_data.messages {
            let nickname = safe_text(&entry.nickname);
            let message = safe_message(&entry.body);
            let mut parts = message.split('\n');
            if let Some(first) = parts.next() {
                lines.push(Line::from(vec![
                    Span::styled(nickname, Style::default().bold()),
                    Span::raw("  "),
                    Span::raw(first.to_owned()),
                ]));
            }
            lines.extend(parts.map(|line| Line::raw(line.to_owned())));
        }
        if lines.is_empty() {
            let empty = if history_data.loaded {
                lang.label(Label::EmptyHistory)
            } else {
                lang.label(Label::LoadingHistory)
            };
            lines.push(Line::raw(empty));
        }
        let paragraph = Paragraph::new(lines).wrap(Wrap { trim: false });
        let bottom = paragraph
            .line_count(history.width)
            .saturating_sub(usize::from(history.height));
        let max_scroll = u16::try_from(bottom).unwrap_or(u16::MAX);
        self.scroll_back = self.scroll_back.min(max_scroll);
        frame.render_widget(
            paragraph.scroll((max_scroll - self.scroll_back, 0)),
            history,
        );

        let draft = self.drafts.get(&channel.id);
        let sending = self.sending.is_some_and(|(id, _)| id == channel.id);
        let label = if channel.archived {
            Line::raw(lang.label(Label::ReadOnly))
        } else if sending {
            Line::raw(lang.label(Label::Sending))
        } else if draft.is_some_and(|draft| draft.request.is_some()) {
            Line::raw(format!(
                "{open}  {}    Ctrl+U  {}",
                lang.label(Label::RetryAction),
                lang.label(Label::ClearDraft)
            ))
        } else {
            Line::raw(lang.label(Label::Message))
        };
        let [label_area, input_area] =
            Layout::vertical([Constraint::Length(1), Constraint::Length(1)]).areas(compose);
        let focused = self.focus == Focus::Compose && !channel.archived && !sending;
        frame.render_widget(
            Paragraph::new(label).style(focus_style(focused)),
            label_area,
        );
        if !channel.archived {
            let empty = Field::default();
            let field = draft.map_or(&empty, |draft| &draft.field);
            draw_value(frame, input_area, field, focused, false);
        }
    }
}

fn channel_entries(snapshot: &Snapshot) -> impl Iterator<Item = &Channel> {
    snapshot
        .membership
        .channels
        .iter()
        .filter(|entry| matches!(entry.kind, Kind::Text | Kind::Voice))
}

fn focus_style(active: bool) -> Style {
    if active {
        Style::default().fg(ACCENT)
    } else {
        Style::default()
    }
}
