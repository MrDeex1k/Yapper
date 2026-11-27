use crate::{
    api::{Error, Storage},
    events::Link,
    shortcuts::{Problem, Shortcut},
    voice::State,
};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Language {
    English,
    Polish,
}

impl Language {
    fn text(self, english: &'static str, polish: &'static str) -> &'static str {
        match self {
            Self::English => english,
            Self::Polish => polish,
        }
    }

    pub fn switch(&mut self) {
        *self = match self {
            Self::English => Self::Polish,
            Self::Polish => Self::English,
        };
    }

    pub fn error(self, error: Error) -> &'static str {
        match error {
            Error::Address => self.text(
                "Enter a valid HTTPS server address.",
                "Podaj prawidłowy adres serwera HTTPS.",
            ),
            Error::Network => self.text(
                "Server unavailable. Try again.",
                "Serwer jest niedostępny. Spróbuj ponownie.",
            ),
            Error::Setup => self.text(
                "Set up this server in the browser first.",
                "Najpierw skonfiguruj serwer w przeglądarce.",
            ),
            Error::Blocked => self.text(
                "The server has blocked access.",
                "Serwer zablokował dostęp.",
            ),
            Error::Denied => self.text("The server denied access.", "Serwer odmówił dostępu."),
            Error::Invitation => self.text(
                "Check your invitation code and try again.",
                "Sprawdź kod zaproszenia i spróbuj ponownie.",
            ),
            Error::Nickname => self.text(
                "Enter a nickname of up to 32 characters.",
                "Podaj pseudonim o długości do 32 znaków.",
            ),
            Error::Archived => self.text(
                "This channel is read-only.",
                "Ten kanał jest tylko do odczytu.",
            ),
            Error::Gone => self.text(
                "This message has expired or been removed.",
                "Ta wiadomość wygasła lub została usunięta.",
            ),
            Error::RateLimit => self.text(
                "Too many requests. Wait a moment and try again.",
                "Za dużo żądań. Poczekaj chwilę i spróbuj ponownie.",
            ),
            Error::Invalid => self.text(
                "The server rejected this request.",
                "Serwer odrzucił to żądanie.",
            ),
            Error::Data => self.text(
                "Unexpected server response.",
                "Nieoczekiwana odpowiedź serwera.",
            ),
            Error::Vault => self.text(
                "Credential store unavailable. F3 switches to a temporary session.",
                "Magazyn poświadczeń jest niedostępny. F3 przełącza na sesję tymczasową.",
            ),
            Error::Voice => self.text(
                "Voice connection ended. Join again to reconnect.",
                "Połączenie głosowe zakończone. Dołącz ponownie, aby je wznowić.",
            ),
            Error::Microphone => self.text(
                "Microphone unavailable. Check your device and permissions.",
                "Mikrofon jest niedostępny. Sprawdź urządzenie i uprawnienia.",
            ),
            Error::Kicked => self.text(
                "You were disconnected by the server. Return to the server prompt to reconnect.",
                "Serwer Cię rozłączył. Wróć do wyboru serwera, aby połączyć się ponownie.",
            ),
        }
    }

    pub fn link(self, link: Link) -> &'static str {
        match link {
            Link::Connecting => self.text("Connecting", "Łączenie"),
            Link::Online => self.text("Online", "Połączono"),
            Link::Offline => self.text("Reconnecting", "Ponowne łączenie"),
            Link::Removed(_) => self.text("Disconnected", "Rozłączono"),
        }
    }

    pub fn voice(self, state: State) -> &'static str {
        match state {
            State::Idle => self.text("Voice off", "Poza rozmową"),
            State::Joining => self.text("Joining voice", "Dołączanie do rozmowy"),
            State::Listening => self.text("Listen only", "Tylko odsłuch"),
            State::Muted => self.text("Mic muted", "Mikrofon wyciszony"),
            State::MicrophoneOn => self.text("Mic on", "Mikrofon włączony"),
            State::Reconnecting => self.text("Reconnecting voice", "Wznawianie rozmowy"),
            State::Leaving => self.text("Leaving voice", "Opuszczanie rozmowy"),
            State::Failed(error) => self.error(error),
        }
    }

    pub fn storage(self, storage: Storage) -> &'static str {
        match storage {
            Storage::Remember => self.text("Remember this guest", "Zapamiętaj gościa"),
            Storage::Temporary => self.text("Temporary session", "Sesja tymczasowa"),
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) enum Label {
    InteractiveRequired,
    Usage,
    RetryConnection,
    Nickname,
    Invitation,
    ServerAddress,
    Working,
    Connect,
    Join,
    NextField,
    SessionMode,
    Back,
    SwitchLanguage,
    ConfigureShortcuts,
    Shortcuts,
    ShortcutConflict,
    PressShortcut,
    CancelShortcut,
    SelectShortcut,
    ChangeShortcut,
    ResetShortcuts,
    RetryAction,
    ClearDraft,
    Channels,
    Archive,
    SelectChannel,
    EmptyHistory,
    LoadingHistory,
    ReadOnly,
    Sending,
    Message,
}

impl Language {
    pub fn label(self, label: Label) -> &'static str {
        match label {
            Label::InteractiveRequired => self.text(
                "Yapper requires an interactive terminal.",
                "Yapper wymaga interaktywnego terminala.",
            ),
            Label::Usage => self.text(
                "Usage: yapper-terminal [--lang en|pl] [SERVER]",
                "Użycie: yapper-terminal [--lang en|pl] [SERWER]",
            ),
            Label::RetryConnection => self.text("Retry connection", "Ponów połączenie"),
            Label::Nickname => self.text("Nickname", "Pseudonim"),
            Label::Invitation => self.text("Invitation code", "Kod zaproszenia"),
            Label::ServerAddress => self.text("Server address", "Adres serwera"),
            Label::Working => self.text("Connecting…", "Łączenie…"),
            Label::Connect => self.text("Connect", "Połącz"),
            Label::Join => self.text("Join", "Dołącz"),
            Label::NextField => self.text("Next field", "Następne pole"),
            Label::SessionMode => self.text("Session mode", "Tryb sesji"),
            Label::Back => self.text("Back", "Wstecz"),
            Label::SwitchLanguage => self.text("Switch to Polish", "Przełącz na angielski"),
            Label::ConfigureShortcuts => self.text("Set shortcuts", "Ustaw skróty"),
            Label::Shortcuts => self.text("Shortcuts", "Skróty"),
            Label::ShortcutConflict => self.text("Already assigned to", "Przypisano już do"),
            Label::PressShortcut => {
                self.text("Press the new shortcut key.", "Naciśnij nowy skrót.")
            }
            Label::CancelShortcut => self.text("Cancel", "Anuluj"),
            Label::SelectShortcut => self.text("Select", "Wybierz"),
            Label::ChangeShortcut => self.text("Change", "Zmień"),
            Label::ResetShortcuts => self.text("Restore defaults", "Przywróć domyślne"),
            Label::RetryAction => self.text("Retry", "Ponów"),
            Label::ClearDraft => self.text("Clear", "Wyczyść"),
            Label::Channels => self.text("Channels", "Kanały"),
            Label::Archive => self.text(" (archive)", " (archiwum)"),
            Label::SelectChannel => self.text("Select a text channel.", "Wybierz kanał tekstowy."),
            Label::EmptyHistory => self.text("No messages yet.", "Brak wiadomości."),
            Label::LoadingHistory => self.text("Loading history…", "Wczytywanie historii…"),
            Label::ReadOnly => self.text("Read-only channel", "Kanał tylko do odczytu"),
            Label::Sending => self.text("Sending…", "Wysyłanie…"),
            Label::Message => self.text("Message", "Wiadomość"),
        }
    }
}

impl Language {
    pub fn shortcut(self, action: Shortcut) -> &'static str {
        match action {
            Shortcut::Focus => self.text("Channels / chat", "Kanały / czat"),
            Shortcut::Open => self.text("Open / send", "Otwórz / wyślij"),
            Shortcut::ScrollUp => self.text("Scroll up", "Przewiń w górę"),
            Shortcut::ScrollDown => self.text("Scroll down", "Przewiń w dół"),
            Shortcut::Microphone => self.text("Microphone", "Mikrofon"),
            Shortcut::Older => self.text("Older messages", "Starsze wiadomości"),
            Shortcut::Leave => self.text("Leave voice", "Opuść rozmowę"),
            Shortcut::Refresh => self.text("Refresh", "Odśwież"),
            Shortcut::Language => self.text("Change language", "Zmień język"),
            Shortcut::Server => self.text("Change server", "Zmień serwer"),
            Shortcut::Quit => self.text("Quit", "Wyjdź"),
        }
    }

    pub fn shortcut_notice(self, problem: Problem) -> &'static str {
        match problem {
            Problem::Load => self.text(
                "Could not read shortcuts. Defaults are active.",
                "Nie udało się odczytać skrótów. Działają ustawienia domyślne.",
            ),
            Problem::Save => self.text(
                "Could not save shortcuts.",
                "Nie udało się zapisać skrótów.",
            ),
            Problem::Unsupported => self.text(
                "Key unavailable. Try F1–F12 or Ctrl/Alt + a letter.",
                "Klawisz niedostępny. Spróbuj F1–F12 lub Ctrl/Alt + litera.",
            ),
            Problem::Saved => self.text("Saved.", "Zapisano."),
            Problem::Conflict(_) => self.label(Label::ShortcutConflict),
        }
    }
}
