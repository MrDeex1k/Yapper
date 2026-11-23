use crate::server::{Failure, Session};
use livekit::{options::TrackPublishOptions, prelude::*};
use std::{collections::HashSet, time::Duration};
use tokio::sync::{mpsc, mpsc::error::TryRecvError, watch};

pub enum Command {
    Leave,
    RefreshDevices,
    Microphone(RecordingDeviceId),
    Output(PlayoutDeviceId),
    Deafen(bool),
    MutePeer(String, bool),
}

pub struct Peer {
    pub identity: String,
    pub name: String,
    pub speaking: bool,
    pub local: bool,
}

pub enum Event {
    Connected { can_publish: bool, peers: Vec<Peer> },
    Peers(Vec<Peer>),
    Devices(Vec<RecordingDeviceInfo>, Vec<PlayoutDeviceInfo>),
    CanPublish(bool),
    Microphone(bool),
    Reconnecting,
    Ended(Option<Failure>),
    Failed(Failure),
}

#[derive(Default)]
struct Playback {
    deafened: bool,
    muted_peers: HashSet<String>,
}

impl Playback {
    fn muted(&self, identity: &ParticipantIdentity) -> bool {
        self.deafened || self.muted_peers.contains(&identity.to_string())
    }

    fn apply(&self, room: &Room) {
        for peer in room.remote_participants().values() {
            let muted = self.muted(&peer.identity());
            for publication in peer.track_publications().values() {
                if let Some(RemoteTrack::Audio(track)) = publication.track() {
                    if muted {
                        track.disable();
                    } else {
                        track.enable();
                    }
                }
            }
        }
    }
}

pub async fn run(
    session: Session,
    channel: String,
    mut commands: mpsc::UnboundedReceiver<Command>,
    mut desired_microphone: watch::Receiver<bool>,
    events: mpsc::UnboundedSender<Event>,
) {
    if leave_requested(&mut commands) {
        let _ = events.send(Event::Ended(None));
        return;
    }
    let grant = session.grant(&channel).await;
    // Keep the grant request alive so a leave can revoke the identity it creates.
    let leaving = leave_requested(&mut commands);
    let mut grant = match grant {
        Ok(grant) => grant,
        Err(error) => {
            let _ = events.send(Event::Ended((!leaving).then_some(error)));
            return;
        }
    };
    let result = if leaving {
        Ok(())
    } else {
        let mut retries = 0;
        let mut playback = Playback::default();
        loop {
            if session.validate_grant(&grant, &channel).is_err() {
                break Err(Failure::Data);
            }
            let result = Box::pin(call(
                &grant.url,
                &grant.token,
                grant.can_publish,
                &mut commands,
                &mut desired_microphone,
                &events,
                &mut playback,
            ))
            .await;
            if !matches!(result, Err(Failure::Voice)) || retries >= 2 {
                break result;
            }
            if leave_requested(&mut commands) {
                break Ok(());
            }
            retries += 1;
            let _ = events.send(Event::Reconnecting);
            tokio::select! {
                biased;
                _ = commands.recv() => break Ok(()),
                () = tokio::time::sleep(Duration::from_secs(1)) => {}
            }
            match session.resume_voice(&channel, &grant.identity).await {
                Ok(next) => grant = next,
                Err(error) => break Err(error),
            }
            if leave_requested(&mut commands) {
                break Ok(());
            }
        }
    };
    let mut leave = session.leave(&grant.identity).await;
    if matches!(leave, Err(Failure::Network)) {
        leave = session.leave(&grant.identity).await;
    }
    let _ = events.send(Event::Ended(result.and(leave).err()));
}

fn leave_requested(commands: &mut mpsc::UnboundedReceiver<Command>) -> bool {
    loop {
        match commands.try_recv() {
            Ok(Command::Leave) | Err(TryRecvError::Disconnected) => return true,
            Err(TryRecvError::Empty) => return false,
            Ok(_) => {}
        }
    }
}

async fn call(
    url: &str,
    token: &str,
    mut can_publish: bool,
    commands: &mut mpsc::UnboundedReceiver<Command>,
    desired_microphone: &mut watch::Receiver<bool>,
    events: &mpsc::UnboundedSender<Event>,
    playback: &mut Playback,
) -> Result<(), Failure> {
    if leave_requested(commands) {
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
    if leave_requested(commands) {
        return room.close().await.map_err(|_| Failure::Voice);
    }
    let mut microphone: Option<LocalAudioTrack> = None;
    let mut enabled = false;
    let mut connected = true;
    desired_microphone.borrow_and_update();
    playback.apply(&room);
    publish_devices(&audio, events);
    let _ = events.send(Event::Connected {
        can_publish,
        peers: peers(&room),
    });

    let result = loop {
        tokio::select! {
            command = commands.recv() => match command {
                Some(Command::Leave) | None => break Ok(()),
                Some(Command::RefreshDevices) => publish_devices(&audio, events),
                Some(Command::Microphone(id)) => {
                    if audio.switch_recording_device(&id).is_err() {
                        let _ = events.send(Event::Failed(Failure::Microphone));
                    }
                    publish_devices(&audio, events);
                }
                Some(Command::Output(id)) => {
                    if audio.switch_playout_device(&id).is_err() {
                        let _ = events.send(Event::Failed(Failure::Voice));
                    }
                    publish_devices(&audio, events);
                }
                Some(Command::Deafen(value)) => {
                    playback.deafened = value;
                    if playback.deafened {
                        if let Some(track) = &microphone {
                            track.mute();
                        }
                        enabled = false;
                        let _ = events.send(Event::Microphone(false));
                    }
                    playback.apply(&room);
                }
                Some(Command::MutePeer(id, mute)) => {
                    if mute {
                        playback.muted_peers.insert(id);
                    } else {
                        playback.muted_peers.remove(&id);
                    }
                    playback.apply(&room);
                }
            },
            changed = desired_microphone.changed() => {
                if changed.is_err() {
                    break Ok(());
                }
                let wanted = *desired_microphone.borrow_and_update() && connected && can_publish && !playback.deafened;
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
                Some(RoomEvent::ParticipantConnected(_) | RoomEvent::ParticipantDisconnected(_) | RoomEvent::ActiveSpeakersChanged { .. }) => {
                    let _ = events.send(Event::Peers(peers(&room)));
                }
                Some(RoomEvent::TrackSubscribed { track: RemoteTrack::Audio(track), participant, .. }) => {
                    if playback.muted(&participant.identity()) {
                        track.disable();
                    }
                }
                Some(RoomEvent::ParticipantPermissionChanged { participant, permission })
                    if participant.identity() == room.local_participant().identity() => {
                    can_publish = permission.is_some_and(|permission| permission.can_publish);
                    if !can_publish {
                        if let Some(track) = &microphone {
                            track.mute();
                        }
                        enabled = false;
                        let _ = events.send(Event::Microphone(false));
                    }
                    let _ = events.send(Event::CanPublish(can_publish));
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
                    playback.apply(&room);
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

fn publish_devices(audio: &PlatformAudio, events: &mpsc::UnboundedSender<Event>) {
    let _ = events.send(Event::Devices(
        audio.recording_devices().collect(),
        audio.playout_devices().collect(),
    ));
}

fn peers(room: &Room) -> Vec<Peer> {
    let local = room.local_participant();
    let mut names = vec![Peer {
        identity: local.identity().to_string(),
        name: local.name(),
        speaking: local.is_speaking(),
        local: true,
    }];
    names.extend(room.remote_participants().values().map(|peer| Peer {
        identity: peer.identity().to_string(),
        name: peer.name(),
        speaking: peer.is_speaking(),
        local: false,
    }));
    names[1..].sort_by(|left, right| left.name.cmp(&right.name));
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
                participants
                    .first()
                    .map(|participant| participant.name.as_str()),
                Some(guest.membership.participant.nickname.as_str()),
                "the voice roster starts with the local participant even when alone",
            );
        } else {
            let _ = guest.session.leave(&grant.identity).await;
            panic!("LiveKit connection through the Go signaling gate failed");
        }
    }
}
