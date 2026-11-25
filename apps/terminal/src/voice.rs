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

use crate::api::{self, Error, Grant, Session};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum State {
    Idle,
    Joining,
    Listening,
    Muted,
    MicrophoneOn,
    Reconnecting,
    Leaving,
    Failed(Error),
}

pub(crate) struct Call {
    pub channel: Uuid,
    stop: watch::Sender<bool>,
    microphone: watch::Sender<bool>,
    task: JoinHandle<()>,
}

impl Call {
    pub fn start(session: Session, channel: Uuid, state: watch::Sender<State>) -> Self {
        let (stop, stopped) = watch::channel(false);
        let (microphone, desired) = watch::channel(false);
        state.send_replace(State::Joining);
        let task = tokio::spawn(async move {
            let result = run(&session, channel, stopped, desired, &state).await;
            state.send_replace(result.map_or_else(State::Failed, |()| State::Idle));
        });
        Self {
            channel,
            stop,
            microphone,
            task,
        }
    }

    pub fn active(&self) -> bool {
        !self.task.is_finished()
    }

    pub fn microphone(&self, state: State) {
        match state {
            State::Muted => {
                self.microphone.send_replace(true);
            }
            State::MicrophoneOn => {
                self.microphone.send_replace(false);
            }
            _ => {}
        }
    }

    pub async fn close(self) {
        self.stop.send_replace(true);
        let _ = self.task.await;
    }
}

async fn run(
    session: &Session,
    channel: Uuid,
    mut stop: watch::Receiver<bool>,
    desired: watch::Receiver<bool>,
    state: &watch::Sender<State>,
) -> Result<(), Error> {
    // A completed grant must be learned and revoked even if the user leaves while it is requested.
    let grant = session.grant(channel).await?;
    let result = if *stop.borrow() {
        Ok(())
    } else {
        call(session, channel, &grant, &mut stop, desired, state).await
    };
    state.send_replace(State::Leaving);
    if grant.identity.is_empty() {
        return result.and(Err(Error::Data));
    }
    let mut leave = session.leave(&grant.identity).await;
    if matches!(leave, Err(Error::Network)) {
        leave = session.leave(&grant.identity).await;
    }
    // A revoked guest cannot request cleanup. The server already owns revocation.
    if leave == Err(Error::Denied) {
        leave = Ok(());
    }
    result.and(leave)
}

async fn call(
    session: &Session,
    channel: Uuid,
    grant: &Grant,
    stop: &mut watch::Receiver<bool>,
    desired: watch::Receiver<bool>,
    state: &watch::Sender<State>,
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
        state,
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
    mut desired: watch::Receiver<bool>,
    state: &watch::Sender<State>,
) -> Result<(), Error> {
    let mut track: Option<LocalAudioTrack> = None;
    let mut connected = true;
    let mut pending_enable = false;
    state.send_replace(muted_state(can_publish));

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
                    state.send_replace(State::Reconnecting);
                }
                Some(RoomEvent::Reconnected) => {
                    connected = true;
                    desired.borrow_and_update();
                    state.send_replace(muted_state(can_publish));
                }
                Some(RoomEvent::ParticipantPermissionChanged { participant, permission })
                    if participant.identity() == room.local_participant().identity() => {
                    can_publish = permission.is_some_and(|permission| permission.can_publish);
                    pending_enable = false;
                    desired.borrow_and_update();
                    if let Some(track) = &track {
                        mute(track, audio);
                    }
                    if connected {
                        state.send_replace(muted_state(can_publish));
                    }
                }
                Some(RoomEvent::Disconnected { .. }) | None => break Err(Error::Voice),
                _ => {}
            },
            change = desired.changed() => {
                if change.is_err() {
                    break Ok(());
                }
                let requested = *desired.borrow_and_update();
                pending_enable = MicrophoneState {
                    requested,
                    connected,
                    can_publish,
                    deafened: false,
                }.allows_publication();
                if !pending_enable && let Some(track) = &track {
                    mute(track, audio);
                    if connected {
                        state.send_replace(muted_state(can_publish));
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
                    state.send_replace(State::MicrophoneOn);
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
