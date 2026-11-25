use std::io::{self, IsTerminal, stdout};
use std::process::ExitCode;
use std::{future::Future, pin::Pin};

use crossterm::{
    event::{
        DisableBracketedPaste, EnableBracketedPaste, Event, EventStream, KeyCode, KeyEventKind,
        KeyModifiers,
    },
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use futures_util::StreamExt;
use ratatui::{Terminal, backend::CrosstermBackend};

mod api;
mod app;
mod copy;
mod events;
mod field;
mod launcher;
mod shortcut_view;
mod shortcuts;
mod voice;
mod workspace;

use copy::{Label, Language};

struct TerminalGuard;

impl Drop for TerminalGuard {
    fn drop(&mut self) {
        restore_terminal();
    }
}

fn restore_terminal() {
    let _ = disable_raw_mode();
    let _ = execute!(
        stdout(),
        DisableBracketedPaste,
        LeaveAlternateScreen,
        crossterm::cursor::Show
    );
}

#[tokio::main]
async fn main() -> ExitCode {
    let args = match Arguments::parse() {
        Ok(Some(args)) => args,
        Ok(None) => return ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            return ExitCode::from(2);
        }
    };
    if !io::stdin().is_terminal() || !stdout().is_terminal() {
        eprintln!("{}", args.lang.label(Label::InteractiveRequired));
        return ExitCode::FAILURE;
    }
    std::panic::set_hook(Box::new(|_| {
        restore_terminal();
        eprintln!("Yapper stopped unexpectedly. / Yapper niespodziewanie zakończył pracę.");
    }));
    if run(args).await.is_err() {
        eprintln!("Terminal error. / Błąd terminala.");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}

async fn run(args: Arguments) -> io::Result<()> {
    let _guard = TerminalGuard;
    enable_raw_mode()?;
    let mut output = stdout();
    execute!(output, EnterAlternateScreen, EnableBracketedPaste)?;
    let mut terminal = Terminal::new(CrosstermBackend::new(output))?;
    let mut input = Input {
        events: EventStream::new(),
        stop: Box::pin(shutdown_signal()),
    };
    let mut language = args.lang;
    let mut address = args.address;
    let mut shortcuts = shortcuts::Shortcuts::load();
    while let Some(joined) = launcher::launch(
        &mut terminal,
        &mut input,
        &mut language,
        &mut shortcuts,
        address,
    )
    .await?
    {
        address = joined.session.server.origin();
        if !app::run(
            &mut terminal,
            &mut input,
            &mut language,
            &mut shortcuts,
            joined,
        )
        .await?
        {
            break;
        }
    }
    Ok(())
}

pub(crate) struct Input {
    events: EventStream,
    stop: Pin<Box<dyn Future<Output = ()> + Send>>,
}

pub(crate) async fn read_event(input: &mut Input) -> io::Result<Option<Event>> {
    loop {
        let event = tokio::select! {
            () = input.stop.as_mut() => return Ok(None),
            event = input.events.next() => event.transpose()?,
        };
        match event {
            Some(Event::Key(key)) if key.kind == KeyEventKind::Release => continue,
            Some(Event::Key(key))
                if key.code == KeyCode::Char('c')
                    && key.modifiers.contains(KeyModifiers::CONTROL) =>
            {
                return Ok(None);
            }
            event => return Ok(event),
        }
    }
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        if let Ok(mut terminate) = signal(SignalKind::terminate()) {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = terminate.recv() => {}
            }
            return;
        }
    }
    let _ = tokio::signal::ctrl_c().await;
}

struct Arguments {
    lang: Language,
    address: String,
}

impl Arguments {
    fn parse() -> Result<Option<Self>, &'static str> {
        let mut args = std::env::args().skip(1);
        let mut result = Self {
            lang: Language::English,
            address: String::new(),
        };
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--help" | "-h" => {
                    println!("{}", result.lang.label(Label::Usage));
                    return Ok(None);
                }
                "--version" => {
                    println!("yapper-terminal {}", env!("CARGO_PKG_VERSION"));
                    return Ok(None);
                }
                "--lang" => {
                    result.lang = match args.next().as_deref() {
                        Some("en") => Language::English,
                        Some("pl") => Language::Polish,
                        _ => {
                            return Err(
                                "Expected --lang en or --lang pl. / Podaj --lang en albo --lang pl.",
                            );
                        }
                    };
                }
                _ if result.address.is_empty() && !arg.starts_with('-') => {
                    result.address = field::safe_text(&arg)
                }
                _ => {
                    return Err(
                        "Unknown argument. See --help. / Nieznany argument. Zobacz --help.",
                    );
                }
            }
        }
        Ok(Some(result))
    }
}
