use crate::server::{Failure, Session};
use livekit::{options::TrackPublishOptions, prelude::*};
use std::{collections::HashSet, ops::ControlFlow, time::Duration};
use tokio::sync::{mpsc, mpsc::error::TryRecvError, watch};
use yapper_voice_policy::MicrophoneState;

pub enum Command {
    Leave,
    RefreshDevices,
    SelectMicrophone(RecordingDeviceId),
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
    MicrophoneActiveChanged(bool),
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
    fn mute_peer(&mut self, identity: String, mute: bool) {
        if mute {
            self.muted_peers.insert(identity);
        } else {
            self.muted_peers.remove(&identity);
        }
    }

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

struct VoiceCommands {
    receiver: mpsc::UnboundedReceiver<Command>,
    playback: Playback,
    recording_device: Option<RecordingDeviceId>,
    playout_device: Option<PlayoutDeviceId>,
}

impl VoiceCommands {
    fn new(receiver: mpsc::UnboundedReceiver<Command>) -> Self {
        Self {
            receiver,
            playback: Playback::default(),
            recording_device: None,
            playout_device: None,
        }
    }

    fn remember(&mut self, command: Option<Command>) -> ControlFlow<()> {
        match command {
            None | Some(Command::Leave) => return ControlFlow::Break(()),
            // Each new connection publishes a fresh device list.
            Some(Command::RefreshDevices) => {}
            Some(Command::SelectMicrophone(id)) => self.recording_device = Some(id),
            Some(Command::Output(id)) => self.playout_device = Some(id),
            Some(Command::Deafen(value)) => self.playback.deafened = value,
            Some(Command::MutePeer(id, muted)) => self.playback.mute_peer(id, muted),
        }
        ControlFlow::Continue(())
    }

    fn drain(&mut self) -> ControlFlow<()> {
        loop {
            match self.receiver.try_recv() {
                Ok(command) => self.remember(Some(command))?,
                Err(TryRecvError::Empty) => return ControlFlow::Continue(()),
                Err(TryRecvError::Disconnected) => return ControlFlow::Break(()),
            }
        }
    }

    async fn wait_for<T>(&mut self, completion: impl Future<Output = T>) -> ControlFlow<(), T> {
        let mut completion = std::pin::pin!(completion);
        loop {
            tokio::select! {
                biased;
                // Keep the original timer or SDK connection future when a control arrives.
                result = &mut completion => return ControlFlow::Continue(result),
                command = self.receiver.recv() => self.remember(command)?,
            }
        }
    }

    fn select_recording_device(
        &mut self,
        id: RecordingDeviceId,
        audio: &PlatformAudio,
        events: &mpsc::UnboundedSender<Event>,
    ) {
        if audio.switch_recording_device(&id).is_ok() {
            self.recording_device = Some(id);
        } else {
            let _ = events.send(Event::Failed(Failure::Microphone));
        }
    }

    fn select_playout_device(
        &mut self,
        id: PlayoutDeviceId,
        audio: &PlatformAudio,
        events: &mpsc::UnboundedSender<Event>,
    ) {
        if audio.switch_playout_device(&id).is_ok() {
            self.playout_device = Some(id);
        } else {
            let _ = events.send(Event::Failed(Failure::Voice));
        }
    }

    fn apply_devices(&mut self, audio: &PlatformAudio, events: &mpsc::UnboundedSender<Event>) {
        if let Some(id) = self.recording_device.take() {
            self.select_recording_device(id, audio, events);
        }
        if let Some(id) = self.playout_device.take() {
            self.select_playout_device(id, audio, events);
        }
    }
}

pub async fn run(
    session: Session,
    channel: String,
    commands: mpsc::UnboundedReceiver<Command>,
    mut desired_microphone: watch::Receiver<bool>,
    events: mpsc::UnboundedSender<Event>,
) {
    let mut controls = VoiceCommands::new(commands);
    if controls.drain().is_break() {
        let _ = events.send(Event::Ended(None));
        return;
    }
    let grant = session.grant(&channel).await;
    // Keep the grant request alive so a leave can revoke the identity it creates.
    let leaving = controls.drain().is_break();
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
        loop {
            if session.validate_grant(&grant, &channel).is_err() {
                break Err(Failure::Data);
            }
            let result = Box::pin(call(
                &grant.url,
                &grant.token,
                grant.can_publish,
                &mut controls,
                &mut desired_microphone,
                &events,
            ))
            .await;
            if !matches!(result, Err(Failure::Voice)) || retries >= 2 {
                break result;
            }
            if controls.drain().is_break() {
                break Ok(());
            }
            retries += 1;
            let _ = events.send(Event::Reconnecting);
            if controls
                .wait_for(tokio::time::sleep(Duration::from_secs(1)))
                .await
                .is_break()
                || controls.drain().is_break()
            {
                break Ok(());
            }

            // A successful resume can issue a replacement identity. Learn it before leaving.
            let resumed = session.resume_voice(&channel, &grant.identity).await;
            let leaving = controls.drain().is_break();
            match resumed {
                Ok(next) => grant = next,
                Err(_) if leaving => break Ok(()),
                Err(error) => break Err(error),
            }
            if leaving {
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

async fn call(
    url: &str,
    token: &str,
    mut can_publish: bool,
    controls: &mut VoiceCommands,
    desired_microphone: &mut watch::Receiver<bool>,
    events: &mpsc::UnboundedSender<Event>,
) -> Result<(), Failure> {
    if controls.drain().is_break() {
        return Ok(());
    }
    let audio = PlatformAudio::new().map_err(|_| Failure::Voice)?;
    // Dropping the SDK connect future on leave runs its cancellation cleanup.
    let joined = controls
        .wait_for(tokio::time::timeout(
            Duration::from_secs(20),
            Room::connect(url, token, RoomOptions::default()),
        ))
        .await;
    let ControlFlow::Continue(joined) = joined else {
        return Ok(());
    };
    let (room, mut room_events) = joined
        .map_err(|_| Failure::Voice)?
        .map_err(|_| Failure::Voice)?;
    if controls.drain().is_break() {
        return room.close().await.map_err(|_| Failure::Voice);
    }
    let mut microphone: Option<LocalAudioTrack> = None;
    let mut enabled = false;
    let mut connected = true;
    desired_microphone.borrow_and_update();
    controls.playback.apply(&room);
    controls.apply_devices(&audio, events);
    publish_devices(&audio, events);
    let _ = events.send(Event::Connected {
        can_publish,
        peers: peers(&room),
    });

    let result = loop {
        tokio::select! {
            command = controls.receiver.recv() => match command {
                Some(Command::Leave) | None => break Ok(()),
                Some(Command::RefreshDevices) => publish_devices(&audio, events),
                Some(Command::SelectMicrophone(id)) => {
                    controls.select_recording_device(id, &audio, events);
                    publish_devices(&audio, events);
                }
                Some(Command::Output(id)) => {
                    controls.select_playout_device(id, &audio, events);
                    publish_devices(&audio, events);
                }
                Some(Command::Deafen(value)) => {
                    controls.playback.deafened = value;
                    if value {
                        if let Some(track) = &microphone {
                            track.mute();
                        }
                        enabled = false;
                        let _ = events.send(Event::MicrophoneActiveChanged(false));
                    }
                    controls.playback.apply(&room);
                }
                Some(Command::MutePeer(id, mute)) => {
                    controls.playback.mute_peer(id, mute);
                    controls.playback.apply(&room);
                }
            },
            changed = desired_microphone.changed() => {
                if changed.is_err() {
                    break Ok(());
                }
                let wanted = MicrophoneState {
                    requested: *desired_microphone.borrow_and_update(),
                    connected,
                    can_publish,
                    deafened: controls.playback.deafened,
                }
                .allows_publication();
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
                    let _ = events.send(Event::MicrophoneActiveChanged(enabled));
                }
            },
            event = room_events.recv() => match event {
                Some(RoomEvent::ParticipantConnected(_) | RoomEvent::ParticipantDisconnected(_) | RoomEvent::ActiveSpeakersChanged { .. }) => {
                    let _ = events.send(Event::Peers(peers(&room)));
                }
                Some(RoomEvent::TrackSubscribed { track: RemoteTrack::Audio(track), participant, .. }) => {
                    if controls.playback.muted(&participant.identity()) {
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
                        let _ = events.send(Event::MicrophoneActiveChanged(false));
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
                    controls.playback.apply(&room);
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
    async fn reconnection_keeps_playback_and_device_commands_while_waiting() {
        let (send, receive) = mpsc::unbounded_channel();
        let mut controls = VoiceCommands::new(receive);
        let (finish, completion) = tokio::sync::oneshot::channel();
        let recording = RecordingDeviceId::from_index(1);
        let playout = PlayoutDeviceId::from_index(2);
        {
            let mut waiting = std::pin::pin!(controls.wait_for(completion));
            assert!(futures_util::poll!(&mut waiting).is_pending());
            send.send(Command::RefreshDevices).unwrap();
            send.send(Command::Deafen(true)).unwrap();
            send.send(Command::MutePeer("peer".to_owned(), true))
                .unwrap();
            send.send(Command::SelectMicrophone(recording.clone()))
                .unwrap();
            send.send(Command::Output(playout.clone())).unwrap();
            assert!(futures_util::poll!(&mut waiting).is_pending());
            finish.send(()).unwrap();
            assert_eq!(waiting.await, ControlFlow::Continue(Ok(())));
        }
        assert!(controls.playback.deafened);
        assert!(controls.playback.muted_peers.contains("peer"));
        assert_eq!(controls.recording_device, Some(recording));
        assert_eq!(controls.playout_device, Some(playout));
    }

    #[test]
    fn commands_queued_before_reconnection_apply_the_latest_mute_state() {
        let (send, receive) = mpsc::unbounded_channel();
        let mut controls = VoiceCommands::new(receive);
        for command in [
            Command::Deafen(true),
            Command::MutePeer("unmuted-again".to_owned(), true),
            Command::MutePeer("still-muted".to_owned(), true),
            Command::Deafen(false),
            Command::MutePeer("unmuted-again".to_owned(), false),
        ] {
            send.send(command).unwrap();
        }
        assert_eq!(controls.drain(), ControlFlow::Continue(()));
        assert!(!controls.playback.deafened);
        assert_eq!(
            controls.playback.muted_peers,
            HashSet::from(["still-muted".to_owned()])
        );
    }

    #[tokio::test]
    async fn leave_and_sender_drop_end_a_pending_connection() {
        for leave in [true, false] {
            let (send, receive) = mpsc::unbounded_channel();
            let mut controls = VoiceCommands::new(receive);
            let mut waiting = std::pin::pin!(controls.wait_for(std::future::pending::<()>()));
            assert!(futures_util::poll!(&mut waiting).is_pending());
            send.send(Command::RefreshDevices).unwrap();
            if leave {
                send.send(Command::Leave).unwrap();
            } else {
                drop(send);
            }
            assert_eq!(waiting.await, ControlFlow::Break(()));
        }
    }

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
        if guest.credential_saved {
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
