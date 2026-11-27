use std::io;

use crossterm::event::{Event, KeyCode, KeyEventKind};
use ratatui::{
    DefaultTerminal, Frame,
    layout::{Constraint, Layout, Rect},
    style::{Color, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListState, Paragraph, Wrap},
};
use unicode_width::UnicodeWidthStr;

use crate::{
    Input, InputMode,
    copy::{Label, Language},
    read_event,
    shortcuts::{Binding, Problem, Shortcut, Shortcuts},
};

pub(crate) const SETTINGS_KEY: KeyCode = KeyCode::F(2);
const KEY_STYLE: Style = Style::new().fg(Color::Cyan).bold();

pub(crate) fn footer(shortcuts: &Shortcuts, lang: Language, area: Rect) -> Vec<Line<'static>> {
    let settings = ("F2".to_owned(), lang.label(Label::Shortcuts));
    let mut entries: Vec<_> = Shortcut::ALL
        .into_iter()
        .map(|action| (shortcuts.key(action).to_string(), lang.shortcut(action)))
        .collect();
    entries.push(settings.clone());
    grid(&entries, (&settings.0, settings.1), area)
}

pub(crate) fn grid(
    entries: &[(String, &'static str)],
    fallback: (&str, &'static str),
    area: Rect,
) -> Vec<Line<'static>> {
    // Pad before each key so the keycap stays next to its action.
    for columns in (1..=entries.len().min(4)).rev() {
        let widths: Vec<_> = (0..columns)
            .map(|column| {
                entries.iter().skip(column).step_by(columns).fold(
                    (0, 0),
                    |(key_width, label_width), (key, label)| {
                        (key_width.max(key.width()), label_width.max(label.width()))
                    },
                )
            })
            .collect();
        let required_width = widths
            .iter()
            .map(|(key, label)| key + 3 + label)
            .sum::<usize>()
            + (columns - 1) * 3;
        let rows = entries.len().div_ceil(columns);
        if columns > entries.len().div_ceil(rows)
            || required_width > usize::from(area.width)
            || rows + 1 > usize::from(area.height / 2)
        {
            continue;
        }
        return entries
            .chunks(columns)
            .map(|row| {
                let mut spans = Vec::with_capacity(row.len() * 3);
                for (column, (key, label)) in row.iter().enumerate() {
                    let (key_width, label_width) = widths[column];
                    let indent = key_width - key.width();
                    if indent > 0 {
                        spans.push(Span::raw(" ".repeat(indent)));
                    }
                    spans.push(Span::styled(format!("[{key}]"), KEY_STYLE));
                    let gap = if column + 1 == row.len() {
                        0
                    } else {
                        3 + label_width - label.width()
                    };
                    spans.push(Span::raw(format!(" {label}{:gap$}", "")));
                }
                Line::from(spans)
            })
            .collect();
    }

    vec![Line::from(vec![
        Span::styled(format!("[{}]", fallback.0), KEY_STYLE),
        Span::raw(format!(" {}", fallback.1)),
    ])]
}

pub(crate) async fn edit(
    terminal: &mut DefaultTerminal,
    input: &mut Input,
    shortcuts: &mut Shortcuts,
    lang: Language,
) -> io::Result<bool> {
    let mut settings = Settings {
        state: ListState::default().with_selected(Some(0)),
        recording: false,
        notice: shortcuts.startup_notice,
    };
    loop {
        terminal.draw(|frame| settings.draw(frame, shortcuts, lang))?;
        let mode = if settings.recording
            && settings
                .state
                .selected()
                .is_some_and(|index| Shortcut::ALL[index] == Shortcut::Quit)
        {
            InputMode::CaptureQuit
        } else {
            InputMode::Normal
        };
        let Some(event) = read_event(input, mode).await? else {
            return Ok(false);
        };
        let Event::Key(key) = event else { continue };
        if key.kind == KeyEventKind::Repeat
            && (settings.recording || !matches!(key.code, KeyCode::Up | KeyCode::Down))
        {
            continue;
        }
        if key.code == KeyCode::Esc {
            if settings.recording {
                settings.recording = false;
                settings.notice = None;
                continue;
            }
            return Ok(true);
        }
        let selected = settings.state.selected().unwrap_or_default();
        if settings.recording {
            let result = Binding::from_event(key)
                .ok_or(Problem::Unsupported)
                .and_then(|binding| shortcuts.assign(Shortcut::ALL[selected], binding));
            settings.notice = Some(result.err().unwrap_or(Problem::Saved));
            settings.recording = result.is_err();
            continue;
        }
        match key.code {
            KeyCode::Up => settings.state.select(Some(selected.saturating_sub(1))),
            KeyCode::Down => settings
                .state
                .select(Some((selected + 1).min(Shortcut::ALL.len() - 1))),
            KeyCode::Enter => {
                settings.recording = true;
                settings.notice = None;
            }
            KeyCode::F(3) => {
                settings.notice = Some(shortcuts.reset().err().unwrap_or(Problem::Saved));
            }
            _ => {}
        }
    }
}

struct Settings {
    state: ListState,
    recording: bool,
    notice: Option<Problem>,
}

impl Settings {
    fn draw(&mut self, frame: &mut Frame, shortcuts: &Shortcuts, lang: Language) {
        let back = (
            "Esc",
            lang.label(if self.recording {
                Label::CancelShortcut
            } else {
                Label::Back
            }),
        );
        let mut entries = Vec::new();
        if !self.recording {
            entries.extend([
                ("↑/↓".to_owned(), lang.label(Label::SelectShortcut)),
                ("Enter".to_owned(), lang.label(Label::ChangeShortcut)),
                ("F3".to_owned(), lang.label(Label::ResetShortcuts)),
            ]);
        }
        entries.push((back.0.to_owned(), back.1));
        let help_lines = grid(&entries, back, frame.area());
        let [heading, body, feedback, help] = Layout::vertical([
            Constraint::Length(2),
            Constraint::Min(1),
            Constraint::Length(2),
            Constraint::Length(help_lines.len() as u16 + 1),
        ])
        .areas(frame.area());
        frame.render_widget(
            Paragraph::new(lang.label(Label::Shortcuts)).style(KEY_STYLE),
            heading,
        );

        let items: Vec<_> = Shortcut::ALL
            .into_iter()
            .map(|action| {
                Line::from(vec![
                    Span::styled(
                        format!("{:<6}", shortcuts.key(action).to_string()),
                        KEY_STYLE,
                    ),
                    Span::raw(format!("  {}", lang.shortcut(action))),
                ])
            })
            .collect();
        frame.render_stateful_widget(
            List::new(items)
                .highlight_symbol("› ")
                .highlight_style(Style::default().bold()),
            body,
            &mut self.state,
        );

        let detail = match self.notice {
            Some(Problem::Conflict(action)) => format!(
                "{} {}",
                lang.label(Label::ShortcutConflict),
                lang.shortcut(action)
            ),
            Some(problem) => lang.shortcut_notice(problem).to_owned(),
            None if self.recording => lang.label(Label::PressShortcut).to_owned(),
            None => String::new(),
        };
        frame.render_widget(Paragraph::new(detail).wrap(Wrap { trim: true }), feedback);
        draw_footer(frame, help, help_lines);
    }
}

pub(crate) fn draw_footer(frame: &mut Frame, area: Rect, lines: Vec<Line<'static>>) {
    frame.render_widget(
        Paragraph::new(lines).block(
            Block::new()
                .borders(Borders::TOP)
                .border_style(Style::new().fg(Color::DarkGray)),
        ),
        area,
    );
}
