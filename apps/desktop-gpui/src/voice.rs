use crate::server::{Failure, Session};
use livekit::{options::TrackPublishOptions, prelude::*};
use std::time::Duration;
use tokio::sync::{mpsc, mpsc::error::TryRecvError, watch};

pub enum Command {
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
    desired_microphone: watch::Receiver<bool>,
    events: mpsc::UnboundedSender<Event>,
) {
    if leave_requested(&mut commands) {
        let _ = events.send(Event::Ended(None));
        return;
    }
    let grant = session.grant(&channel).await;
    // Keep the grant request alive so a leave can revoke the identity it creates.
    let leaving = leave_requested(&mut commands);
    let grant = match grant {
        Ok(grant) => grant,
        Err(error) => {
            let _ = events.send(Event::Ended((!leaving).then_some(error)));
            return;
        }
    };
    let result = if leaving {
        Ok(())
    } else if session.validate_grant(&grant, &channel).is_ok() {
        Box::pin(call(
            &grant.url,
            &grant.token,
            grant.can_publish,
            commands,
            desired_microphone,
            &events,
        ))
        .await
    } else {
        Err(Failure::Data)
    };
    let mut leave = session.leave(&grant.identity).await;
    if matches!(leave, Err(Failure::Network)) {
        leave = session.leave(&grant.identity).await;
    }
    let _ = events.send(Event::Ended(result.and(leave).err()));
}

fn leave_requested(commands: &mut mpsc::Receiver<Command>) -> bool {
    !matches!(commands.try_recv(), Err(TryRecvError::Empty))
}

async fn call(
    url: &str,
    token: &str,
    can_publish: bool,
    mut commands: mpsc::Receiver<Command>,
    mut desired_microphone: watch::Receiver<bool>,
    events: &mpsc::UnboundedSender<Event>,
) -> Result<(), Failure> {
    if leave_requested(&mut commands) {
        return Ok(());
    }
    let audio = PlatformAudio::new().map_err(|_| Failure::Voice)?;
    let (room, mut room_events) = tokio::select! {
        biased;
        // Dropping the SDK connect future runs its cancellation cleanup.
        // The caller still revokes the exact server grant.
        _ = commands.recv() => return Ok(()),
        joined = tokio::time::timeout(
            Duration::from_secs(20),
            Room::connect(url, token, RoomOptions::default()),
        ) => joined.map_err(|_| Failure::Voice)?.map_err(|_| Failure::Voice)?,
    };
    if leave_requested(&mut commands) {
        return room.close().await.map_err(|_| Failure::Voice);
    }
    let mut microphone: Option<LocalAudioTrack> = None;
    let mut enabled = false;
    let mut connected = true;
    let _ = events.send(Event::Connected {
        can_publish,
        peers: peers(&room),
    });

    let result = loop {
        tokio::select! {
            _ = commands.recv() => break Ok(()),
            changed = desired_microphone.changed() => {
                if changed.is_err() {
                    break Ok(());
                }
                let wanted = *desired_microphone.borrow_and_update() && connected && can_publish;
                if wanted && microphone.is_none() {
                    let track = LocalAudioTrack::create_audio_track("microphone", audio.rtc_source());
                    // Publishing can outlast a space-bar press. Start muted and reread intent.
                    track.mute();
                    let options = TrackPublishOptions { source: TrackSource::Microphone, ..Default::default() };
                    if room.local_participant().publish_track(LocalTrack::Audio(track.clone()), options).await.is_err() {
                        let _ = events.send(Event::Failed(Failure::Microphone));
                        continue;
                    }
                    microphone = Some(track);
                }
                let next = wanted && *desired_microphone.borrow() && desired_microphone.has_changed().is_ok();
                if let Some(track) = &microphone {
                    if next { track.unmute(); } else { track.mute(); }
                }
                if next != enabled {
                    enabled = next;
                    let _ = events.send(Event::Microphone(enabled));
                }
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
    let mut names = vec![room.local_participant().name()];
    names.extend(
        room.remote_participants()
            .values()
            .map(RemoteParticipant::name),
    );
    names[1..].sort();
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
            .begin_admission("GPUI smoke".into(), invitation)
            .await
            .expect("admit the guest")
            .finish()
            .await
            .expect("read guest membership");
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
            .find(|channel| channel.kind == "voice" && !channel.archived)
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
            let participants = peers(&room);
            let closed = room.close().await;
            guest
                .session
                .leave(&grant.identity)
                .await
                .expect("release media admission");
            assert!(closed.is_ok(), "close the LiveKit connection");
            assert_eq!(
                participants.first().map(String::as_str),
                Some(guest.membership.participant.nickname.as_str()),
                "the voice roster starts with the local participant even when alone",
            );
        } else {
            let _ = guest.session.leave(&grant.identity).await;
            panic!("LiveKit connection through the Go signaling gate failed");
        }
    }
}
