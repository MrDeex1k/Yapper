use super::{Failure, Session};
use futures_util::StreamExt;
use reqwest::Method;
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Message, client::IntoClientRequest, http::HeaderValue},
};

pub enum Hint {
    Ready,
    Catalog,
    Chat(String),
    Reconnecting,
    Removed,
}

impl Session {
    pub async fn watch_events(&self, hints: mpsc::UnboundedSender<Hint>) {
        loop {
            let result = tokio::select! {
                () = hints.closed() => return,
                result = self.events_once(&hints) => result,
            };
            if matches!(result, Err(Failure::Denied)) {
                let _ = hints.send(Hint::Removed);
                return;
            }
            if hints.send(Hint::Reconnecting).is_err() {
                return;
            }
            tokio::select! {
                () = hints.closed() => return,
                () = tokio::time::sleep(Duration::from_secs(2)) => {}
            }
        }
    }

    async fn events_once(&self, hints: &mpsc::UnboundedSender<Hint>) -> Result<(), Failure> {
        #[derive(Deserialize)]
        struct Ticket {
            ticket: String,
        }
        let ticket: Ticket = self
            .request(Method::POST, "/api/v1/events/ticket", Some(json!({})))
            .await?;
        if ticket.ticket.is_empty() || !ticket.ticket.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(Failure::Data);
        }
        let mut address = self
            .server
            .origin
            .join("/api/v1/events")
            .map_err(|_| Failure::Data)?;
        address
            .set_scheme(if address.scheme() == "https" {
                "wss"
            } else {
                "ws"
            })
            .map_err(|()| Failure::Data)?;
        let mut request = address
            .as_str()
            .into_client_request()
            .map_err(|_| Failure::Data)?;
        let origin = HeaderValue::from_str(&self.server.origin()).map_err(|_| Failure::Data)?;
        request.headers_mut().insert("origin", origin);
        let mut protocols =
            HeaderValue::from_str(&format!("yapper.v1, yapper.ticket.{}", ticket.ticket))
                .map_err(|_| Failure::Data)?;
        protocols.set_sensitive(true);
        request
            .headers_mut()
            .insert("sec-websocket-protocol", protocols);
        let (mut socket, _) = tokio::time::timeout(Duration::from_secs(8), connect_async(request))
            .await
            .map_err(|_| Failure::Network)?
            .map_err(|_| Failure::Network)?;
        while let Some(Ok(message)) = socket.next().await {
            match message {
                Message::Text(text) => {
                    if let Some(hint) = parse_hint(text.as_str()) {
                        let _ = hints.send(hint);
                    }
                }
                Message::Close(frame) => {
                    if frame.is_some_and(|frame| u16::from(frame.code) == 4001) {
                        return Err(Failure::Denied);
                    }
                    return Ok(());
                }
                _ => {}
            }
        }
        Ok(())
    }
}

fn parse_hint(text: &str) -> Option<Hint> {
    #[derive(Deserialize)]
    struct Envelope {
        #[serde(rename = "type")]
        kind: String,
        payload: Option<Payload>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Payload {
        channel_id: Option<String>,
    }
    let envelope: Envelope = serde_json::from_str(text).ok()?;
    match envelope.kind.as_str() {
        "ready" => Some(Hint::Ready),
        "catalog.changed" | "members.changed" => Some(Hint::Catalog),
        "message.created" | "messages.changed" => Some(Hint::Chat(envelope.payload?.channel_id?)),
        _ => None,
    }
}
