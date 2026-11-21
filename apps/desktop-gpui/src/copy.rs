use crate::server::Failure;

#[derive(Clone, Copy)]
pub enum Language {
    English,
    Polish,
}

pub struct Copy {
    pub server: &'static str,
    pub address: &'static str,
    pub connect: &'static str,
    pub change_server: &'static str,
    pub join: &'static str,
    pub nickname: &'static str,
    pub invitation: &'static str,
    pub voice_channels: &'static str,
    pub select_voice: &'static str,
    pub connected: &'static str,
    pub connecting: &'static str,
    pub reconnecting: &'static str,
    pub disconnecting: &'static str,
    pub microphone_on: &'static str,
    pub microphone_off: &'static str,
    pub listening_only: &'static str,
    pub leave: &'static str,
    pub unsaved: &'static str,
    pub language: &'static str,
}

const EN: Copy = Copy {
    server: "Connect to a server",
    address: "Server address",
    connect: "Connect",
    change_server: "Change server",
    join: "Join server",
    nickname: "Nickname",
    invitation: "Invitation",
    voice_channels: "Voice channels",
    select_voice: "Select a voice channel to join.",
    connected: "Connected",
    connecting: "Connecting…",
    reconnecting: "Reconnecting…",
    disconnecting: "Disconnecting…",
    microphone_on: "Enable microphone",
    microphone_off: "Mute microphone",
    listening_only: "Listening only",
    leave: "Disconnect",
    unsaved: "Credential storage is unavailable. This session ends when you close Yapper.",
    language: "Polski",
};

const PL: Copy = Copy {
    server: "Połącz z serwerem",
    address: "Adres serwera",
    connect: "Połącz",
    change_server: "Zmień serwer",
    join: "Dołącz do serwera",
    nickname: "Pseudonim",
    invitation: "Zaproszenie",
    voice_channels: "Kanały głosowe",
    select_voice: "Wybierz kanał głosowy, aby dołączyć.",
    connected: "Połączono",
    connecting: "Łączenie…",
    reconnecting: "Ponowne łączenie…",
    disconnecting: "Rozłączanie…",
    microphone_on: "Włącz mikrofon",
    microphone_off: "Wycisz mikrofon",
    listening_only: "Tylko odsłuch",
    leave: "Rozłącz",
    unsaved: "Magazyn poświadczeń jest niedostępny. Sesja zakończy się po zamknięciu Yappera.",
    language: "English",
};

impl Language {
    pub fn copy(self) -> &'static Copy {
        match self {
            Self::English => &EN,
            Self::Polish => &PL,
        }
    }

    pub fn toggle(self) -> Self {
        match self {
            Self::English => Self::Polish,
            Self::Polish => Self::English,
        }
    }

    pub fn failure(self, error: Failure) -> &'static str {
        let (en, pl) = match error {
            Failure::Address => (
                "Enter a valid HTTPS server address.",
                "Wpisz prawidłowy adres HTTPS serwera.",
            ),
            Failure::Network => (
                "Could not reach the server.",
                "Nie można połączyć się z serwerem.",
            ),
            Failure::Setup => (
                "The server owner must complete setup first.",
                "Właściciel musi najpierw skonfigurować serwer.",
            ),
            Failure::Denied => (
                "The server denied the request. Check your invitation or permissions.",
                "Serwer odrzucił żądanie. Sprawdź zaproszenie lub uprawnienia.",
            ),
            Failure::Data => (
                "The server returned an unexpected response.",
                "Serwer zwrócił nieoczekiwaną odpowiedź.",
            ),
            Failure::Voice => (
                "The voice connection could not be established or was interrupted.",
                "Nie udało się nawiązać połączenia głosowego lub zostało ono przerwane.",
            ),
            Failure::Microphone => (
                "Could not start the microphone.",
                "Nie można włączyć mikrofonu.",
            ),
        };
        match self {
            Self::English => en,
            Self::Polish => pl,
        }
    }
}
