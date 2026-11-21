use crate::server::Failure;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Language {
    English,
    Polish,
}

pub struct Copy {
    pub server: &'static str,
    pub server_hint: &'static str,
    pub address: &'static str,
    pub connect: &'static str,
    pub change_server: &'static str,
    pub join: &'static str,
    pub join_heading: &'static str,
    pub join_description: &'static str,
    pub identity_notice: &'static str,
    pub nickname: &'static str,
    pub invitation: &'static str,
    pub channels: &'static str,
    pub voice_channels: &'static str,
    pub text_channels: &'static str,
    pub empty_chat: &'static str,
    pub empty_chat_description: &'static str,
    pub loading_chat: &'static str,
    pub message_placeholder: &'static str,
    pub send: &'static str,
    pub message_too_long: &'static str,
    pub archived_chat: &'static str,
    pub participant: &'static str,
    pub select_voice: &'static str,
    pub connected: &'static str,
    pub connecting: &'static str,
    pub reconnecting: &'static str,
    pub disconnecting: &'static str,
    pub microphone_on: &'static str,
    pub microphone_off: &'static str,
    pub microphone_on_status: &'static str,
    pub microphone_muted_status: &'static str,
    pub push_to_talk: &'static str,
    pub push_to_talk_hint: &'static str,
    pub push_to_talk_key: &'static str,
    pub listening_only: &'static str,
    pub leave: &'static str,
    pub unsaved: &'static str,
    pub privacy: &'static str,
    pub build: &'static str,
    pub language: &'static str,
}

const EN: Copy = Copy {
    server: "Where are your people?",
    server_hint: "Enter a trusted HTTPS domain or IP address.",
    address: "Server address",
    connect: "Connect to server",
    change_server: "Change server",
    join: "Join server",
    join_heading: "Join the conversation",
    join_description: "A familiar voice is one nickname away.",
    identity_notice: "Your identity stays on this device. Removing the saved credential creates a new identity. A nickname cannot restore it.",
    nickname: "Your nickname",
    invitation: "Invitation",
    channels: "Channels",
    voice_channels: "Voice channels",
    text_channels: "Text channels",
    empty_chat: "Start the conversation",
    empty_chat_description: "Send the first message in this channel.",
    loading_chat: "Loading messages…",
    message_placeholder: "Write a message…",
    send: "Send",
    message_too_long: "Messages can contain up to 2,000 characters.",
    archived_chat: "This channel is archived.",
    participant: "Participant",
    select_voice: "Select a voice channel to join.",
    connected: "Connected",
    connecting: "Connecting…",
    reconnecting: "Reconnecting…",
    disconnecting: "Disconnecting…",
    microphone_on: "Enable microphone",
    microphone_off: "Mute microphone",
    microphone_on_status: "Microphone on",
    microphone_muted_status: "Microphone muted",
    push_to_talk: "Push to talk",
    push_to_talk_hint: "Hold Space to talk while the window is active and the message field is unfocused.",
    push_to_talk_key: "Space",
    listening_only: "Listening only",
    leave: "Leave voice",
    unsaved: "Credential storage is unavailable. This session ends when you close Yapper.",
    privacy: "Hosted by you.",
    build: "Development preview",
    language: "Language",
};

const PL: Copy = Copy {
    server: "Gdzie są Twoi znajomi?",
    server_hint: "Wpisz domenę lub adres IP z zaufanym HTTPS.",
    address: "Adres serwera",
    connect: "Połącz z serwerem",
    change_server: "Zmień serwer",
    join: "Dołącz do serwera",
    join_heading: "Dołącz do rozmowy",
    join_description: "Od znajomego głosu dzieli Cię tylko nick.",
    identity_notice: "Twoja tożsamość zostaje na tym urządzeniu. Usunięcie zapisanych danych logowania tworzy nową tożsamość. Nick nie pozwala jej odzyskać.",
    nickname: "Twój nick",
    invitation: "Zaproszenie",
    channels: "Kanały",
    voice_channels: "Kanały głosowe",
    text_channels: "Kanały tekstowe",
    empty_chat: "Zacznij rozmowę",
    empty_chat_description: "Wyślij pierwszą wiadomość na tym kanale.",
    loading_chat: "Ładowanie wiadomości…",
    message_placeholder: "Napisz wiadomość…",
    send: "Wyślij",
    message_too_long: "Wiadomość może mieć najwyżej 2000 znaków.",
    archived_chat: "Ten kanał jest zarchiwizowany.",
    participant: "Uczestnik",
    select_voice: "Wybierz kanał głosowy, aby dołączyć.",
    connected: "Połączono",
    connecting: "Łączenie…",
    reconnecting: "Ponowne łączenie…",
    disconnecting: "Rozłączanie…",
    microphone_on: "Włącz mikrofon",
    microphone_off: "Wycisz mikrofon",
    microphone_on_status: "Mikrofon włączony",
    microphone_muted_status: "Mikrofon wyciszony",
    push_to_talk: "Naciśnij i mów",
    push_to_talk_hint: "Przytrzymaj spację, aby mówić w aktywnym oknie poza polem wiadomości.",
    push_to_talk_key: "Spacja",
    listening_only: "Tylko odsłuch",
    leave: "Opuść rozmowę",
    unsaved: "Magazyn poświadczeń jest niedostępny. Sesja zakończy się po zamknięciu Yappera.",
    privacy: "Na Twoim serwerze.",
    build: "Wersja rozwojowa",
    language: "Język",
};

impl Language {
    pub fn copy(self) -> &'static Copy {
        match self {
            Self::English => &EN,
            Self::Polish => &PL,
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Self::English => "EN",
            Self::Polish => "PL",
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
