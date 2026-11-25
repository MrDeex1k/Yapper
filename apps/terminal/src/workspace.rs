use std::{sync::Arc, time::Duration};

use tokio::{
    sync::{mpsc, watch},
    task::JoinHandle,
    time::{Instant, MissedTickBehavior},
};
use uuid::Uuid;

use crate::{
    api::{Change, Error, Kind, Membership, Message, Session, Timeline},
    events::{self, Link, Update},
    voice::{self, Call},
};

pub(crate) enum Action {
    Older(Uuid),
    Refresh,
    Send {
        channel: Uuid,
        attempt: Uuid,
        request: Uuid,
        body: String,
    },
    Join(Uuid),
    Leave,
    Microphone,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct History {
    pub channel: Option<Uuid>,
    pub messages: Vec<Message>,
    pub before: i64,
    revision: i64,
    pub loaded: bool,
}

impl History {
    fn load(&mut self, timeline: Timeline) {
        if !self.loaded {
            self.revision = timeline.revision;
            self.loaded = true;
        }
        self.before = timeline.before;
        for message in timeline.messages {
            self.upsert(message);
        }
    }

    fn apply(&mut self, change: Change) {
        self.revision = self.revision.max(change.revision);
        if let Some(message) = change.message {
            // Edits to unloaded older messages will arrive with their history page.
            let in_window = self.before == 0 || message.sequence >= self.before;
            if in_window {
                self.upsert(message);
            }
        } else {
            self.messages
                .retain(|message| message.id != change.id || message.revision > change.revision);
        }
    }

    fn upsert(&mut self, message: Message) {
        match self
            .messages
            .binary_search_by_key(&message.sequence, |entry| entry.sequence)
        {
            Ok(index) if self.messages[index].revision <= message.revision => {
                self.messages[index] = message;
            }
            Ok(_) => {}
            Err(index) => self.messages.insert(index, message),
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct Snapshot {
    pub membership: Arc<Membership>,
    pub history: Arc<History>,
    pub link: Link,
    pub notice: Option<Error>,
    pub call_channel: Option<Uuid>,
    pub sent: Option<(Uuid, Result<(), Error>)>,
}

pub(crate) struct Workspace {
    pub selected: watch::Sender<Option<Uuid>>,
    pub actions: mpsc::Sender<Action>,
    pub snapshot: watch::Receiver<Snapshot>,
    pub voice: watch::Receiver<voice::State>,
    stop: watch::Sender<bool>,
    task: JoinHandle<()>,
}

impl Workspace {
    pub fn start(session: Session, membership: Membership) -> Self {
        let first = membership
            .channels
            .iter()
            .find(|channel| matches!(channel.kind, Kind::Text) && !channel.archived)
            .or_else(|| {
                membership
                    .channels
                    .iter()
                    .find(|channel| matches!(channel.kind, Kind::Text))
            })
            .map(|channel| channel.id);
        let snapshot = Snapshot {
            membership: Arc::new(membership),
            history: Arc::new(History::default()),
            link: Link::Connecting,
            notice: None,
            call_channel: None,
            sent: None,
        };
        let (selected, selection) = watch::channel(first);
        let (actions, commands) = mpsc::channel(8);
        let (output, read) = watch::channel(snapshot.clone());
        let (voice, voice_state) = watch::channel(voice::State::Idle);
        let (stop, stopped) = watch::channel(false);
        let worker = Worker {
            session,
            snapshot,
            output,
            voice,
            call: None,
            stopped,
        };
        let task = tokio::spawn(worker.run(selection, commands));
        Self {
            selected,
            actions,
            snapshot: read,
            voice: voice_state,
            stop,
            task,
        }
    }

    pub async fn close(self) {
        self.stop.send_replace(true);
        let _ = self.task.await;
    }
}

struct Worker {
    session: Session,
    snapshot: Snapshot,
    output: watch::Sender<Snapshot>,
    voice: watch::Sender<voice::State>,
    call: Option<Call>,
    stopped: watch::Receiver<bool>,
}

impl Worker {
    async fn run(
        mut self,
        mut selected: watch::Receiver<Option<Uuid>>,
        mut commands: mpsc::Receiver<Action>,
    ) {
        let (updates, mut inbound) = watch::channel(Update::default());
        tokio::spawn(events::watch(self.session.clone(), updates));
        let mut prior = Update::default();
        let interval = Duration::from_secs(15);
        let mut fallback = tokio::time::interval_at(Instant::now() + interval, interval);
        fallback.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let initial = *selected.borrow_and_update();
        self.select(initial).await;
        loop {
            if *self.stopped.borrow() {
                break;
            }
            tokio::select! {
                _ = self.stopped.changed() => break,
                update = inbound.changed() => {
                    let next = *inbound.borrow_and_update();
                    self.snapshot.link = next.link;
                    if let Link::Removed(error) = next.link {
                        self.remove(error).await;
                        break;
                    }
                    if update.is_err() {
                        self.remove(Error::Network).await;
                        break;
                    }
                    if next.catalog != prior.catalog {
                        self.catalog().await;
                    }
                    if next.history != prior.history {
                        self.refresh().await;
                    }
                    prior = next;
                }
                change = selected.changed() => {
                    if change.is_err() {
                        break;
                    }
                    let channel = *selected.borrow_and_update();
                    self.select(channel).await;
                }
                command = commands.recv() => match command {
                    Some(command) => self.action(command).await,
                    None => break,
                },
                _ = fallback.tick() => {
                    self.catalog().await;
                    self.refresh().await;
                }
            }
            self.publish();
        }
        self.stop_call().await;
    }

    fn publish(&self) {
        self.output.send_replace(self.snapshot.clone());
    }

    async fn remove(&mut self, error: Error) {
        self.snapshot.link = Link::Removed(error);
        self.snapshot.notice = Some(error);
        self.snapshot.history = Arc::new(History::default());
        self.publish();
        self.stop_call().await;
    }

    async fn action(&mut self, command: Action) {
        match command {
            Action::Older(channel) if self.snapshot.history.channel == Some(channel) => {
                self.older().await
            }
            Action::Older(_) => {}
            Action::Refresh => {
                self.catalog().await;
                self.refresh().await;
            }
            Action::Send {
                channel,
                attempt,
                request,
                body,
            } => {
                let result = self.send(channel, request, &body).await;
                self.snapshot.sent = Some((attempt, result));
                self.snapshot.notice = result.err();
            }
            Action::Join(channel) => self.join(channel).await,
            Action::Leave => self.stop_call().await,
            Action::Microphone => {
                if let Some(call) = &self.call {
                    let current = *self.voice.borrow();
                    call.microphone(current);
                }
            }
        }
    }

    async fn catalog(&mut self) {
        match self.session.membership().await {
            Ok(membership) => self.snapshot.membership = Arc::new(membership),
            Err(error) => self.snapshot.notice = Some(error),
        }
        if let Some(channel) = self.snapshot.history.channel
            && !self
                .snapshot
                .membership
                .channels
                .iter()
                .any(|entry| entry.id == channel && matches!(entry.kind, Kind::Text))
        {
            self.snapshot.history = Arc::new(History::default());
        }
        if let Some(call) = &self.call
            && !self.snapshot.membership.channels.iter().any(|entry| {
                entry.id == call.channel && !entry.archived && matches!(entry.kind, Kind::Voice)
            })
        {
            self.stop_call().await;
        }
    }

    async fn select(&mut self, channel: Option<Uuid>) {
        if self.snapshot.history.channel != channel {
            self.snapshot.history = Arc::new(History {
                channel,
                ..History::default()
            });
            self.snapshot.notice = None;
            self.publish();
        }
        self.refresh().await;
        self.publish();
    }

    async fn refresh(&mut self) {
        let Some(channel) = self.snapshot.history.channel else {
            return;
        };
        let result = if self.snapshot.history.loaded {
            self.reconcile(channel).await
        } else {
            self.session
                .timeline(channel, 0)
                .await
                .map(|timeline| Arc::make_mut(&mut self.snapshot.history).load(timeline))
        };
        if let Err(error) = result {
            self.snapshot.notice = Some(error);
        } else if self.snapshot.notice == Some(Error::Network) {
            self.snapshot.notice = None;
        }
    }

    async fn reconcile(&mut self, channel: Uuid) -> Result<(), Error> {
        // Bound each turn so a busy server cannot indefinitely hold up input or shutdown.
        for _ in 0..10 {
            if *self.stopped.borrow() {
                break;
            }
            let revision = self.snapshot.history.revision;
            let changes = self.session.changes(channel, revision).await?;
            let more = changes.len() == 100;
            let history = Arc::make_mut(&mut self.snapshot.history);
            for change in changes {
                if change.revision > history.revision {
                    history.apply(change);
                }
            }
            if !more || revision == history.revision {
                break;
            }
        }
        Ok(())
    }

    async fn older(&mut self) {
        let Some(channel) = self.snapshot.history.channel else {
            return;
        };
        let before = self.snapshot.history.before;
        if before > 0 {
            match self.session.timeline(channel, before).await {
                Ok(timeline) => {
                    Arc::make_mut(&mut self.snapshot.history).load(timeline);
                    self.refresh().await;
                }
                Err(error) => self.snapshot.notice = Some(error),
            }
        }
    }

    async fn send(&mut self, channel: Uuid, request: Uuid, body: &str) -> Result<(), Error> {
        if matches!(self.snapshot.link, Link::Removed(_)) {
            return Err(Error::Denied);
        }
        let entry = self
            .snapshot
            .membership
            .channels
            .iter()
            .find(|entry| entry.id == channel && matches!(entry.kind, Kind::Text))
            .ok_or(Error::Denied)?;
        if entry.archived {
            return Err(Error::Archived);
        }
        let message = self.session.send_message(channel, body, request).await?;
        if self.snapshot.history.channel == Some(channel) && self.snapshot.history.loaded {
            Arc::make_mut(&mut self.snapshot.history).upsert(message);
        }
        Ok(())
    }

    async fn join(&mut self, channel: Uuid) {
        if matches!(self.snapshot.link, Link::Removed(_))
            || !self.snapshot.membership.channels.iter().any(|entry| {
                entry.id == channel && !entry.archived && matches!(entry.kind, Kind::Voice)
            })
        {
            self.snapshot.notice = Some(Error::Denied);
            return;
        }
        if self
            .call
            .as_ref()
            .is_some_and(|call| call.channel == channel && call.active())
        {
            return;
        }
        self.stop_call().await;
        if *self.stopped.borrow() {
            return;
        }
        self.snapshot.call_channel = Some(channel);
        self.call = Some(Call::start(
            self.session.clone(),
            channel,
            self.voice.clone(),
        ));
    }

    async fn stop_call(&mut self) {
        if let Some(call) = self.call.take() {
            call.close().await;
        }
        self.snapshot.call_channel = None;
        self.publish();
    }
}

#[cfg(test)]
mod tests {
    use super::{Change, History, Message, Timeline};
    use uuid::Uuid;

    #[test]
    fn history_merges_sends_edits_and_tombstones_without_duplicates() {
        let id = Uuid::new_v4();
        let message = Message {
            id,
            sequence: 1,
            revision: 1,
            nickname: "Ada".into(),
            body: "start".into(),
        };
        let mut timeline = History::default();
        timeline.load(Timeline {
            messages: vec![message.clone()],
            before: 0,
            revision: 1,
        });
        let edited = Message {
            revision: 2,
            body: "edited".into(),
            ..message.clone()
        };
        timeline.apply(Change {
            id,
            revision: 2,
            message: Some(edited),
        });
        timeline.upsert(message);
        assert_eq!(timeline.messages.len(), 1);
        assert_eq!(timeline.messages[0].body, "edited");
        timeline.apply(Change {
            id,
            revision: 3,
            message: None,
        });
        assert!(timeline.messages.is_empty());
        assert_eq!(timeline.revision, 3);
    }
}
