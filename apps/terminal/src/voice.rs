use std::{sync::Arc, time::Duration};

use async_trait::async_trait;
use livekit::{
    options::TrackPublishOptions,
    prelude::{
        LocalAudioTrack, LocalTrack, PlatformAudio, Room, RoomEvent, RoomOptions, TrackSource,
    },
};
use livekit_net::{
    Header, HttpClient, HttpMethod, HttpResponse, TransportError, WsClient, WsConnectResult,
};
use reqwest::{Client, Url, header::HeaderValue};
use tokio::{sync::watch, task::JoinHandle, time::timeout};
use uuid::Uuid;
use yapper_voice_policy::MicrophoneState;

use crate::api::{self, Error, Grant, GrantError, Session};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum State {
    #[default]
    Idle,
    Joining,
    Listening,
    Muted,
    MicrophoneOn,
    Reconnecting,
    Leaving,
    Failed(Error),
}

#[derive(Debug, Clone, Default)]
pub(crate) struct Status {
    pub state: State,
    controls: Option<Controls>,
    generation: u64,
}

#[derive(Debug, Clone)]
struct Controls {
    channel: Uuid,
    stop: watch::Sender<bool>,
    microphone: watch::Sender<MicrophoneIntent>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MicrophoneIntent {
    Mute,
    Enable(u64),
}

impl Status {
    pub fn channel(&self) -> Option<Uuid> {
        self.controls.as_ref().map(|controls| controls.channel)
    }

    pub fn leave(&self) {
        if let Some(controls) = &self.controls {
            controls.stop.send_replace(true);
        }
    }

    pub fn microphone(&self) {
        if let Some(controls) = &self.controls {
            let intent = match self.state {
                State::Muted => MicrophoneIntent::Enable(self.generation),
                State::MicrophoneOn => MicrophoneIntent::Mute,
                _ => return,
            };
            controls.microphone.send_replace(intent);
        }
    }
}

pub(crate) struct Call {
    pub channel: Uuid,
    stop: watch::Sender<bool>,
    task: JoinHandle<()>,
}

impl Call {
    pub fn start(session: Session, channel: Uuid, status: watch::Sender<Status>) -> Self {
        let (stop, stopped) = watch::channel(false);
        let (microphone, desired) = watch::channel(MicrophoneIntent::Mute);
        status.send_replace(Status {
            controls: Some(Controls {
                channel,
                stop: stop.clone(),
                microphone,
            }),
            state: State::Joining,
            generation: 0,
        });
        let task = tokio::spawn(async move {
            let result = run(&session, channel, stopped, desired, &status).await;
            status.send_replace(Status {
                state: result.map_or_else(State::Failed, |()| State::Idle),
                ..Status::default()
            });
        });
        Self {
            channel,
            stop,
            task,
        }
    }

    pub fn active(&self) -> bool {
        !self.task.is_finished()
    }

    pub async fn close(self) {
        self.stop.send_replace(true);
        let _ = self.task.await;
    }
}

fn set_state(status: &watch::Sender<Status>, state: State) {
    status.send_modify(|status| status.state = state);
}

async fn run(
    session: &Session,
    channel: Uuid,
    mut stop: watch::Receiver<bool>,
    desired: watch::Receiver<MicrophoneIntent>,
    status: &watch::Sender<Status>,
) -> Result<(), Error> {
    // A completed grant must be learned and revoked even if the user leaves while it is requested.
    let grant = match session.grant(channel).await {
        Ok(grant) => grant,
        Err(GrantError::Rejected(error)) => return Err(error),
        Err(GrantError::Unconfirmed(error)) => {
            // Match Web's recovery when the grant may have committed without an identity.
            release_grant(session, "").await?;
            return Err(error);
        }
    };
    let result = if *stop.borrow() {
        Ok(())
    } else {
        call(session, channel, &grant, &mut stop, desired, status).await
    };
    set_state(status, State::Leaving);
    result.and(release_grant(session, &grant.identity).await)
}

async fn release_grant(session: &Session, identity: &str) -> Result<(), Error> {
    let mut result = session.leave(identity).await;
    // Retrying an identity-specific release cannot revoke a replacement grant.
    if result == Err(Error::Network) && !identity.is_empty() {
        result = session.leave(identity).await;
    }
    match result {
        Err(Error::Denied | Error::Blocked) => Ok(()),
        result => result,
    }
}

async fn call(
    session: &Session,
    channel: Uuid,
    grant: &Grant,
    stop: &mut watch::Receiver<bool>,
    desired: watch::Receiver<MicrophoneIntent>,
    status: &watch::Sender<Status>,
) -> Result<(), Error> {
    let url = session.grant_url(grant, channel)?;
    let _transport = Signaling::install(session, url.clone())?;
    let audio = PlatformAudio::new().map_err(|_| Error::Voice)?;
    let connection = timeout(
        Duration::from_secs(20),
        Room::connect(url.as_str(), &grant.token, RoomOptions::default()),
    );
    let (room, events) = tokio::select! {
        biased;
        _ = stop.changed() => return Ok(()),
        connected = connection => connected.map_err(|_| Error::Voice)?.map_err(|_| Error::Voice)?,
    };
    let result = use_room(
        &room,
        events,
        &audio,
        grant.can_publish,
        stop,
        desired,
        status,
    )
    .await;
    let closed = timeout(Duration::from_secs(5), room.close())
        .await
        .map_err(|_| Error::Voice)
        .and_then(|result| result.map_err(|_| Error::Voice));
    result.and(closed)
}

async fn use_room(
    room: &Room,
    mut events: tokio::sync::mpsc::UnboundedReceiver<RoomEvent>,
    audio: &PlatformAudio,
    mut can_publish: bool,
    stop: &mut watch::Receiver<bool>,
    mut desired: watch::Receiver<MicrophoneIntent>,
    status: &watch::Sender<Status>,
) -> Result<(), Error> {
    let mut track: Option<LocalAudioTrack> = None;
    let mut connected = true;
    let mut pending_enable = false;
    set_state(status, muted_state(can_publish));

    let result = loop {
        tokio::select! {
            biased;
            _ = stop.changed() => break Ok(()),
            event = events.recv() => match event {
                Some(RoomEvent::Reconnecting) => {
                    connected = false;
                    pending_enable = false;
                    if let Some(track) = &track {
                        mute(track, audio);
                    }
                    status.send_modify(|status| {
                        status.generation += 1;
                        status.state = State::Reconnecting;
                    });
                }
                Some(RoomEvent::Reconnected) => {
                    connected = true;
                    desired.borrow_and_update();
                    set_state(status, muted_state(can_publish));
                }
                Some(RoomEvent::ParticipantPermissionChanged { participant, permission })
                    if participant.identity() == room.local_participant().identity() => {
                    can_publish = permission.is_some_and(|permission| permission.can_publish);
                    pending_enable = false;
                    desired.borrow_and_update();
                    if let Some(track) = &track {
                        mute(track, audio);
                    }
                    status.send_modify(|status| {
                        status.generation += 1;
                        if connected {
                            status.state = muted_state(can_publish);
                        }
                    });
                }
                Some(RoomEvent::Disconnected { .. }) | None => break Err(Error::Voice),
                _ => {}
            },
            change = desired.changed() => {
                if change.is_err() {
                    break Ok(());
                }
                let requested = *desired.borrow_and_update()
                    == MicrophoneIntent::Enable(status.borrow().generation);
                pending_enable = MicrophoneState {
                    requested,
                    connected,
                    can_publish,
                    deafened: false,
                }.allows_publication();
                if !pending_enable && let Some(track) = &track {
                    mute(track, audio);
                    if connected {
                        set_state(status, muted_state(can_publish));
                    }
                }
                if pending_enable && track.is_none() {
                    track = Some(tokio::select! {
                        biased;
                        _ = stop.changed() => break Ok(()),
                        published = publish(room, audio) => match published {
                            Ok(track) => track,
                            Err(error) => break Err(error),
                        },
                    });
                }
            },
            // Process any permission change, disconnect, mute, or leave queued during publish
            // before unmuting the new track.
            () = std::future::ready(()), if pending_enable => {
                pending_enable = false;
                if let Some(track) = &track {
                    if audio.start_recording().is_err() {
                        break Err(Error::Microphone);
                    }
                    track.unmute();
                    set_state(status, State::MicrophoneOn);
                }
            },
        }
    };
    if let Some(track) = &track {
        mute(track, audio);
    }
    result
}

fn mute(track: &LocalAudioTrack, audio: &PlatformAudio) {
    track.mute();
    if audio.is_recording_initialized() {
        let _ = audio.stop_recording();
    }
}

async fn publish(room: &Room, audio: &PlatformAudio) -> Result<LocalAudioTrack, Error> {
    if audio.recording_devices().next().is_none() {
        return Err(Error::Microphone);
    }
    let track = LocalAudioTrack::create_audio_track("microphone", audio.rtc_source());
    track.mute();
    let options = TrackPublishOptions {
        source: TrackSource::Microphone,
        ..Default::default()
    };
    timeout(
        Duration::from_secs(5),
        room.local_participant()
            .publish_track(LocalTrack::Audio(track.clone()), options),
    )
    .await
    .map_err(|_| Error::Microphone)?
    .map_err(|_| Error::Microphone)?;
    Ok(track)
}

fn muted_state(can_publish: bool) -> State {
    if can_publish {
        State::Muted
    } else {
        State::Listening
    }
}

struct Signaling {
    socket_origin: Url,
    http_origin: String,
    ws: Arc<dyn WsClient>,
    http: Client,
}

struct TransportScope {
    ws: Arc<dyn WsClient>,
    http: Arc<dyn HttpClient>,
}

impl Drop for TransportScope {
    fn drop(&mut self) {
        livekit_net::set_ws_client(Arc::clone(&self.ws));
        livekit_net::set_http_client(Arc::clone(&self.http));
    }
}

impl Signaling {
    fn install(session: &Session, socket_origin: Url) -> Result<TransportScope, Error> {
        let ws = livekit_net::ws_client().ok_or(Error::Voice)?;
        let http = livekit_net::http_client().ok_or(Error::Voice)?;
        let transport = Arc::new(Self {
            socket_origin,
            http_origin: session.server.origin(),
            ws: Arc::clone(&ws),
            http: api::http_client(Duration::from_secs(8))?,
        });
        // The terminal has one active room. Its scoped transport is released before room replacement.
        livekit_net::set_ws_client(transport.clone());
        livekit_net::set_http_client(transport);
        Ok(TransportScope { ws, http })
    }

    fn authorize(
        &self,
        raw_url: &str,
        headers: &mut Vec<Header>,
        route: Route,
    ) -> Result<(), TransportError> {
        let url = Url::parse(raw_url).map_err(|_| transport_error())?;
        validate_target(&url, &self.socket_origin, &self.http_origin, route)?;
        if headers
            .iter()
            .filter(|header| header.name.eq_ignore_ascii_case("authorization"))
            .count()
            != 1
        {
            return Err(transport_error());
        }
        headers.retain(|header| !header.name.eq_ignore_ascii_case("origin"));
        headers.push(Header {
            name: "Origin".into(),
            value: self.http_origin.clone(),
        });
        Ok(())
    }
}

#[derive(Clone, Copy)]
enum Route {
    Upgrade,
    Validate,
}

fn validate_target(
    url: &Url,
    socket_origin: &Url,
    http_origin: &str,
    route: Route,
) -> Result<(), TransportError> {
    let origin = url.origin();
    let allowed = match route {
        Route::Upgrade => {
            origin == socket_origin.origin()
                && matches!(url.path(), "/livekit/rtc" | "/livekit/rtc/v1")
        }
        Route::Validate => {
            origin.ascii_serialization() == http_origin
                && matches!(
                    url.path(),
                    "/livekit/rtc/validate" | "/livekit/rtc/v1/validate"
                )
        }
    };
    if !allowed
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.query_pairs().any(|(key, _)| key == "access_token")
    {
        return Err(transport_error());
    }
    Ok(())
}

fn transport_error() -> TransportError {
    TransportError::Other("Invalid Yapper signaling request".into())
}

#[async_trait]
impl WsClient for Signaling {
    async fn connect(
        &self,
        url: String,
        mut headers: Vec<Header>,
        timeout_ms: u64,
    ) -> Result<WsConnectResult, TransportError> {
        self.authorize(&url, &mut headers, Route::Upgrade)?;
        self.ws.connect(url, headers, timeout_ms).await
    }
}

#[async_trait]
impl HttpClient for Signaling {
    async fn request(
        &self,
        method: HttpMethod,
        url: String,
        mut headers: Vec<Header>,
        body: Option<Vec<u8>>,
    ) -> Result<HttpResponse, TransportError> {
        self.authorize(&url, &mut headers, Route::Validate)?;
        let mut request = match method {
            HttpMethod::Get => self.http.get(url),
            HttpMethod::Post => self.http.post(url),
        };
        for header in headers {
            let mut value = HeaderValue::from_str(&header.value).map_err(|_| transport_error())?;
            value.set_sensitive(header.name.eq_ignore_ascii_case("authorization"));
            request = request.header(&header.name, value);
        }
        if let Some(body) = body {
            request = request.body(body);
        }
        let mut response = request.send().await.map_err(|_| transport_error())?;
        let status = response.status().as_u16();
        let headers = response
            .headers()
            .iter()
            .filter_map(|(name, value)| {
                Some(Header {
                    name: name.to_string(),
                    value: value.to_str().ok()?.to_owned(),
                })
            })
            .collect();
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| transport_error())? {
            if chunk.len() > 64 * 1024 - body.len() {
                return Err(transport_error());
            }
            body.extend_from_slice(&chunk);
        }
        Ok(HttpResponse {
            status,
            headers,
            body,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{Route, Url, validate_target};

    #[test]
    fn controls_use_the_displayed_intent_and_cannot_target_a_replacement_call() {
        use super::{Controls, MicrophoneIntent, State, Status};
        use tokio::sync::watch;
        use uuid::Uuid;

        let channel = Uuid::new_v4();
        let (stop, stopped) = watch::channel(false);
        let (microphone, intent) = watch::channel(MicrophoneIntent::Mute);
        let shown = Status {
            state: State::MicrophoneOn,
            controls: Some(Controls {
                channel,
                stop,
                microphone,
            }),
            generation: 7,
        };
        let (replacement_stop, replacement_stopped) = watch::channel(false);
        let (replacement_mic, replacement_intent) = watch::channel(MicrophoneIntent::Mute);
        let replacement = Status {
            state: State::Muted,
            controls: Some(Controls {
                channel,
                stop: replacement_stop,
                microphone: replacement_mic,
            }),
            generation: 0,
        };

        shown.microphone();
        assert!(intent.has_changed().unwrap());
        assert_eq!(*intent.borrow(), MicrophoneIntent::Mute);
        assert!(!replacement_intent.has_changed().unwrap());
        shown.leave();
        assert!(*stopped.borrow());
        assert!(!*replacement_stopped.borrow());

        let before_reconnect = Status {
            state: State::Muted,
            ..shown
        };
        before_reconnect.microphone();
        assert_eq!(*intent.borrow(), MicrophoneIntent::Enable(7));
        assert_ne!(*intent.borrow(), MicrophoneIntent::Enable(8));
        replacement.microphone();
        assert_eq!(*replacement_intent.borrow(), MicrophoneIntent::Enable(0));
    }

    #[test]
    fn bearer_signaling_is_scoped_to_the_selected_server_and_gate() {
        let socket = Url::parse("wss://chat.example:8043/livekit").unwrap();
        let origin = "https://chat.example:8043";
        for (address, route, expected) in [
            (
                "wss://chat.example:8043/livekit/rtc/v1?protocol=15",
                Route::Upgrade,
                true,
            ),
            (
                "https://chat.example:8043/livekit/rtc/validate",
                Route::Validate,
                true,
            ),
            ("wss://chat.example/livekit/rtc", Route::Upgrade, false),
            ("ws://chat.example:8043/livekit/rtc", Route::Upgrade, false),
            (
                "wss://other.example:8043/livekit/rtc",
                Route::Upgrade,
                false,
            ),
            ("wss://chat.example:8043/rtc", Route::Upgrade, false),
            (
                "wss://chat.example:8043/livekit/rtc?access_token=x",
                Route::Upgrade,
                false,
            ),
        ] {
            let address = Url::parse(address).unwrap();
            assert_eq!(
                validate_target(&address, &socket, origin, route).is_ok(),
                expected,
                "{address}"
            );
        }
    }
}
