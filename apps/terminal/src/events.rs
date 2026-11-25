use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::watch;
use tokio_tungstenite::{
    connect_async_with_config,
    tungstenite::{
        Message, client::IntoClientRequest, http::HeaderValue, protocol::WebSocketConfig,
    },
};

use crate::api::{Error, Session};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum Link {
    #[default]
    Connecting,
    Online,
    Offline,
    Removed(Error),
}

#[derive(Clone, Copy, Default)]
pub(crate) struct Update {
    pub link: Link,
    pub catalog: u64,
    pub history: u64,
}

pub(crate) async fn watch(session: Session, updates: watch::Sender<Update>) {
    loop {
        let result = tokio::select! {
            () = updates.closed() => return,
            result = listen(&session, &updates) => result,
        };
        if let Err(error @ (Error::Denied | Error::Kicked)) = result {
            updates.send_modify(|update| update.link = Link::Removed(error));
            return;
        }
        updates.send_modify(|update| update.link = Link::Offline);
        tokio::select! {
            () = updates.closed() => return,
            () = tokio::time::sleep(Duration::from_secs(2)) => {}
        }
    }
}

async fn listen(session: &Session, updates: &watch::Sender<Update>) -> Result<(), Error> {
    let ticket = session.ticket().await?;
    let url = session.server.socket_url("/api/v1/events")?;
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|_| Error::Data)?;
    let origin = HeaderValue::from_str(&session.server.origin()).map_err(|_| Error::Data)?;
    request.headers_mut().insert("origin", origin);
    let mut protocol = HeaderValue::from_str(&format!("yapper.v1, yapper.ticket.{ticket}"))
        .map_err(|_| Error::Data)?;
    protocol.set_sensitive(true);
    request
        .headers_mut()
        .insert("sec-websocket-protocol", protocol);
    let config = WebSocketConfig::default()
        .max_message_size(Some(64 * 1024))
        .max_frame_size(Some(64 * 1024));
    let (mut socket, response) = tokio::time::timeout(
        Duration::from_secs(8),
        connect_async_with_config(request, Some(config), true),
    )
    .await
    .map_err(|_| Error::Network)?
    .map_err(|_| Error::Network)?;
    if response
        .headers()
        .get("sec-websocket-protocol")
        .and_then(|value| value.to_str().ok())
        != Some("yapper.v1")
    {
        return Err(Error::Data);
    }
    loop {
        let message = match tokio::time::timeout(Duration::from_secs(25), socket.next()).await {
            Ok(message) => message,
            Err(_) => {
                tokio::time::timeout(
                    Duration::from_secs(8),
                    socket.send(Message::Ping(Vec::new().into())),
                )
                .await
                .map_err(|_| Error::Network)?
                .map_err(|_| Error::Network)?;
                tokio::time::timeout(Duration::from_secs(10), socket.next())
                    .await
                    .map_err(|_| Error::Network)?
            }
        };
        let Some(message) = message else { break };
        match message.map_err(|_| Error::Network)? {
            Message::Text(text) => {
                if let Ok(event) = serde_json::from_str::<Envelope>(&text)
                    && event.version == 1
                {
                    apply(&event.kind, updates);
                }
            }
            Message::Ping(_) => socket.flush().await.map_err(|_| Error::Network)?,
            Message::Close(frame) => {
                if frame.is_some_and(|frame| u16::from(frame.code) == 4001) {
                    return Err(Error::Kicked);
                }
                break;
            }
            _ => {}
        }
    }
    Ok(())
}

#[derive(Deserialize)]
struct Envelope {
    version: u8,
    #[serde(rename = "type")]
    kind: String,
}

fn apply(kind: &str, updates: &watch::Sender<Update>) {
    updates.send_if_modified(|update| {
        match kind {
            "ready" => {
                update.link = Link::Online;
                update.catalog += 1;
                update.history += 1;
            }
            "catalog.changed" | "members.changed" => update.catalog += 1,
            "message.created" | "messages.changed" => update.history += 1,
            _ => return false,
        }
        true
    });
}
