use crate::server::{Failure, Session};
use livekit::{options::TrackPublishOptions, prelude::*};
use std::time::Duration;
use tokio::sync::mpsc;

pub enum Command {
    ToggleMicrophone,
    Leave,
}

pub enum Event {
    Connected {
        can_publish: bool,
        peers: Vec<String>,
    },
    Peers(Vec<String>),
    Microphone(bool),
    Reconnecting,
    Ended(Option<Failure>),
    Failed(Failure),
}

pub async fn run(
    session: Session,
    channel: String,
    mut commands: mpsc::Receiver<Command>,
    events: mpsc::UnboundedSender<Event>,
) {
    let grant = match session.grant(&channel).await {
        Ok(grant) => grant,
        Err(error) => {
            let _ = events.send(Event::Ended(Some(error)));
            return;
        }
    };
    let result = if session.validate_grant(&grant, &channel).is_ok() {
        call(
            &grant.url,
            &grant.token,
            grant.can_publish,
            &mut commands,
            &events,
        )
        .await
    } else {
        Err(Failure::Data)
    };
    let leave = session.leave(&grant.identity).await;
    let _ = events.send(Event::Ended(result.and(leave).err()));
}

async fn call(
    url: &str,
    token: &str,
    can_publish: bool,
    commands: &mut mpsc::Receiver<Command>,
    events: &mpsc::UnboundedSender<Event>,
) -> Result<(), Failure> {
    let audio = PlatformAudio::new().map_err(|_| Failure::Voice)?;
    let (room, mut room_events) = tokio::time::timeout(
        Duration::from_secs(20),
        Room::connect(url, token, RoomOptions::default()),
    )
    .await
    .map_err(|_| Failure::Voice)?
    .map_err(|_| Failure::Voice)?;
    let mut microphone: Option<LocalAudioTrack> = None;
    let mut enabled = false;
    let mut connected = true;
    let _ = events.send(Event::Connected {
        can_publish,
        peers: peers(&room),
    });

    let result = loop {
        tokio::select! {
            command = commands.recv() => match command {
                Some(Command::ToggleMicrophone) if can_publish && connected => {
                    if let Some(track) = &microphone {
                        if enabled {
                            track.mute();
                        } else {
                            track.unmute();
                        }
                    } else {
                        let track = LocalAudioTrack::create_audio_track("microphone", audio.rtc_source());
                        let options = TrackPublishOptions { source: TrackSource::Microphone, ..Default::default() };
                        if room.local_participant().publish_track(LocalTrack::Audio(track.clone()), options).await.is_err() {
                            let _ = events.send(Event::Failed(Failure::Microphone));
                            continue;
                        }
                        microphone = Some(track);
                    }
                    enabled = !enabled;
                    let _ = events.send(Event::Microphone(enabled));
                }
                Some(Command::ToggleMicrophone) => {}
                Some(Command::Leave) | None => break Ok(()),
            },
            event = room_events.recv() => match event {
                Some(RoomEvent::ParticipantConnected(_) | RoomEvent::ParticipantDisconnected(_)) => {
                    let _ = events.send(Event::Peers(peers(&room)));
                }
                Some(RoomEvent::Reconnecting) => {
                    connected = false;
                    enabled = false;
                    if let Some(track) = &microphone {
                        track.mute();
                    }
                    let _ = events.send(Event::Reconnecting);
                }
                Some(RoomEvent::Reconnected) => {
                    connected = true;
                    let _ = events.send(Event::Connected { can_publish, peers: peers(&room) });
                }
                Some(RoomEvent::Disconnected { .. }) | None => break Err(Failure::Voice),
                _ => {}
            },
        }
    };
    if let Some(track) = microphone {
        track.mute();
    }
    let closed = room.close().await.map_err(|_| Failure::Voice);
    result.and(closed)
}

fn peers(room: &Room) -> Vec<String> {
    let mut names: Vec<_> = room
        .remote_participants()
        .values()
        .map(|peer| peer.name())
        .collect();
    names.sort();
    names
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{server::Server, signaling};

    #[tokio::test]
    #[ignore = "requires an invitation to a disposable Stage 2 installation"]
    async fn joins_through_yapper_signaling_gate() {
        signaling::install();
        let address =
            std::env::var("YAPPER_GPUI_TEST_SERVER").expect("set YAPPER_GPUI_TEST_SERVER");
        let invitation =
            std::env::var("YAPPER_GPUI_TEST_INVITATION").expect("set YAPPER_GPUI_TEST_INVITATION");
        let (server, _) = Server::connect(&address)
            .await
            .expect("connect to the server");
        let guest = server
            .join("GPUI smoke".into(), invitation)
            .await
            .expect("admit the guest");
        assert_eq!(guest.membership.participant.nickname, "GPUI smoke");
        if guest.saved {
            let restored = server
                .restore()
                .await
                .expect("restore session")
                .expect("saved guest");
            assert_eq!(
                restored.membership.participant.nickname,
                guest.membership.participant.nickname
            );
        }
        let channel = guest
            .membership
            .channels
            .iter()
            .find(|channel| channel.kind == "voice")
            .expect("voice channel");
        let grant = guest
            .session
            .grant(&channel.id)
            .await
            .expect("get the media grant");
        guest
            .session
            .validate_grant(&grant, &channel.id)
            .expect("same-origin signaling");
        let connected = tokio::time::timeout(
            Duration::from_secs(20),
            Room::connect(&grant.url, &grant.token, RoomOptions::default()),
        )
        .await;
        if let Ok(Ok((room, _events))) = connected {
            let closed = room.close().await;
            guest
                .session
                .leave(&grant.identity)
                .await
                .expect("release media admission");
            assert!(closed.is_ok(), "close the LiveKit connection");
        } else {
            let _ = guest.session.leave(&grant.identity).await;
            panic!("LiveKit connection through the Go signaling gate failed");
        }
    }
}
