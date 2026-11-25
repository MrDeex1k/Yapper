use crate::{
    api::{Error, Storage},
    events::Link,
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
                "You were disconnected by the server. Reconnect with F4.",
                "Serwer Cię rozłączył. Połącz się ponownie klawiszem F4.",
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
    LaunchShortcuts,
    WorkspaceShortcuts,
    Channels,
    Archive,
    SelectChannel,
    EmptyHistory,
    LoadingHistory,
    ReadOnly,
    Sending,
    RetrySend,
    Message,
}

impl Language {
    pub fn label(self, label: Label) -> &'static str {
        match label {
            Label::InteractiveRequired => self.text("Yapper requires an interactive terminal.", "Yapper wymaga interaktywnego terminala."),
            Label::Usage => self.text("Usage: yapper-terminal [--lang en|pl] [SERVER]", "Użycie: yapper-terminal [--lang en|pl] [SERWER]"),
            Label::RetryConnection => self.text("Enter  Retry connection", "Enter  Ponów połączenie"),
            Label::Nickname => self.text("Nickname", "Pseudonim"),
            Label::Invitation => self.text("Invitation code", "Kod zaproszenia"),
            Label::ServerAddress => self.text("Server address", "Adres serwera"),
            Label::Working => self.text("Connecting…", "Łączenie…"),
            Label::LaunchShortcuts => self.text("Enter  Continue    Tab  Next field\nF1  Polski    Esc  Back    Ctrl+C  Quit", "Enter  Dalej    Tab  Następne pole\nF1  English    Esc  Wstecz    Ctrl+C  Wyjdź"),
            Label::WorkspaceShortcuts => self.text("Tab  Channel / chat    Enter  Open / send    PgUp/PgDn  Scroll\nF5  Mic    F6  Older    F7  Leave    F8  Refresh\nF1  Polski    F4  Server    Ctrl+C  Quit", "Tab  Kanały / czat    Enter  Otwórz / wyślij    PgUp/PgDn  Przewiń\nF5  Mikrofon    F6  Starsze    F7  Opuść    F8  Odśwież\nF1  English    F4  Serwer    Ctrl+C  Wyjdź"),
            Label::Channels => self.text("Channels", "Kanały"),
            Label::Archive => self.text(" (archive)", " (archiwum)"),
            Label::SelectChannel => self.text("Select a text channel.", "Wybierz kanał tekstowy."),
            Label::EmptyHistory => self.text("No messages yet.", "Brak wiadomości."),
            Label::LoadingHistory => self.text("Loading history…", "Wczytywanie historii…"),
            Label::ReadOnly => self.text("Read-only channel", "Kanał tylko do odczytu"),
            Label::Sending => self.text("Sending…", "Wysyłanie…"),
            Label::RetrySend => self.text("Enter  Retry    Ctrl+U  Clear", "Enter  Ponów    Ctrl+U  Wyczyść"),
            Label::Message => self.text("Message", "Wiadomość"),
        }
    }
}
