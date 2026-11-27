use std::fmt;
use std::time::Duration;

use reqwest::header::{COOKIE, HeaderValue, ORIGIN, SET_COOKIE};
use reqwest::{Client, Method, Response, StatusCode, Url, redirect::Policy};
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json};
use uuid::Uuid;

const VAULT_SERVICE: &str = "Yapper Terminal";
const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Error {
    Address,
    Network,
    Setup,
    Denied,
    Blocked,
    Invitation,
    Nickname,
    Archived,
    Gone,
    RateLimit,
    Invalid,
    Data,
    Vault,
    Voice,
    Microphone,
    Kicked,
}

impl fmt::Display for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for Error {}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Installation {
    pub name: String,
    configured: bool,
    pub open_admission: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct Membership {
    pub participant: Participant,
    pub channels: Vec<Channel>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct Participant {
    pub nickname: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Kind {
    Text,
    Voice,
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct Channel {
    pub id: Uuid,
    pub name: String,
    pub kind: Kind,
    #[serde(default)]
    pub archived: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct Message {
    pub id: Uuid,
    pub sequence: i64,
    pub revision: i64,
    pub nickname: String,
    pub body: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct Timeline {
    pub messages: Vec<Message>,
    pub before: i64,
    pub revision: i64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct Change {
    pub id: Uuid,
    pub revision: i64,
    pub message: Option<Message>,
}

#[derive(Debug)]
pub(crate) enum GrantError {
    Rejected(Error),
    Unconfirmed(Error),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Grant {
    pub url: String,
    pub token: String,
    pub identity: String,
    channel_id: Uuid,
    pub can_publish: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct Server {
    origin: Url,
    client: Client,
}

#[derive(Debug, Clone)]
pub(crate) struct Session {
    pub server: Server,
    cookie: HeaderValue,
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum Storage {
    #[default]
    Remember,
    Temporary,
}

impl Server {
    pub async fn connect(address: &str) -> Result<(Self, Installation), Error> {
        let origin = parse_origin(address, cfg!(debug_assertions))?;
        let client = http_client(Duration::from_secs(8))?;
        let server = Self { origin, client };
        let state: Installation = decode(
            server
                .send(Method::GET, "/api/v1/state", None, None)
                .await?,
        )
        .await?;
        if !state.configured {
            return Err(Error::Setup);
        }
        Ok((server, state))
    }

    pub fn origin(&self) -> String {
        self.origin.origin().ascii_serialization()
    }

    pub fn socket_url(&self, path: &str) -> Result<Url, Error> {
        let mut url = self.origin.join(path).map_err(|_| Error::Data)?;
        let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
        url.set_scheme(scheme).map_err(|()| Error::Data)?;
        Ok(url)
    }

    pub async fn restore(&self) -> Result<Option<Session>, Error> {
        let origin = self.origin();
        let secret = tokio::task::spawn_blocking(move || {
            keyring::Entry::new(VAULT_SERVICE, &origin)?.get_password()
        })
        .await
        .map_err(|_| Error::Vault)?;
        match secret {
            Ok(secret) => self.session(&secret).map(Some),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(Error::Vault),
        }
    }

    pub async fn admit(
        &self,
        nickname: &str,
        invitation: &str,
        storage: Storage,
        previous: Option<&Session>,
    ) -> Result<(Session, Storage), Error> {
        let previous = previous.filter(|session| session.server.origin() == self.origin());
        let response = self
            .send(
                Method::POST,
                "/api/v1/guests",
                previous.map(|session| &session.cookie),
                Some(json!({ "nickname": nickname.trim(), "invitation": invitation.trim() })),
            )
            .await?;
        let secret = if response.status() == StatusCode::OK {
            // Go returned the still-valid identity without setting a new cookie.
            previous
                .and_then(|session| session.cookie.to_str().ok())
                .and_then(|value| value.split_once('='))
                .map(|(_, secret)| secret)
        } else {
            response
                .headers()
                .get_all(SET_COOKIE)
                .iter()
                .filter_map(|header| header.to_str().ok()?.split(';').next()?.split_once('='))
                .find_map(|(name, value)| (name == self.cookie_name()).then_some(value))
        }
        .ok_or(Error::Data)?;
        let session = self.session(secret)?;
        if storage == Storage::Remember {
            let secret = secret.to_owned();
            let origin = self.origin();
            let result = tokio::task::spawn_blocking(move || {
                keyring::Entry::new(VAULT_SERVICE, &origin)?.set_password(&secret)
            })
            .await;
            if matches!(result, Ok(Ok(()))) {
                return Ok((session, Storage::Remember));
            }
        }
        Ok((session, Storage::Temporary))
    }

    fn cookie_name(&self) -> &'static str {
        if self.origin.scheme() == "https" {
            "__Host-yapper_guest"
        } else {
            "yapper_guest"
        }
    }

    fn session(&self, secret: &str) -> Result<Session, Error> {
        if secret.is_empty()
            || secret.len() > 128
            || !secret
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(Error::Data);
        }
        let mut cookie = HeaderValue::from_str(&format!("{}={secret}", self.cookie_name()))
            .map_err(|_| Error::Data)?;
        cookie.set_sensitive(true);
        Ok(Session {
            server: self.clone(),
            cookie,
        })
    }

    async fn send(
        &self,
        method: Method,
        path: &str,
        cookie: Option<&HeaderValue>,
        body: Option<Value>,
    ) -> Result<Response, Error> {
        let url = self.origin.join(path).map_err(|_| Error::Data)?;
        let mut request = self
            .client
            .request(method, url)
            .header(ORIGIN, self.origin());
        if let Some(cookie) = cookie {
            request = request.header(COOKIE, cookie);
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.map_err(|_| Error::Network)?;
        if response.status().is_success() {
            return Ok(response);
        }
        let status = response.status();
        #[derive(Deserialize)]
        struct Failure {
            code: String,
        }
        let code = decode::<Failure>(response).await.ok();
        Err(match code.as_ref().map(|code| code.code.as_str()) {
            Some("participant_banned" | "ip_blocked") => Error::Blocked,
            Some("invalid_nickname") => Error::Nickname,
            Some("invitation_denied" | "invalid_invitation") => Error::Invitation,
            Some("channel_archived") => Error::Archived,
            Some("media_unavailable") => Error::Voice,
            _ => match status {
                StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Error::Denied,
                StatusCode::GONE => Error::Gone,
                StatusCode::TOO_MANY_REQUESTS => Error::RateLimit,
                StatusCode::BAD_REQUEST | StatusCode::CONFLICT => Error::Invalid,
                status if status.is_server_error() => Error::Network,
                _ => Error::Data,
            },
        })
    }
}

impl Session {
    async fn request<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<T, Error> {
        decode(
            self.server
                .send(method, path, Some(&self.cookie), body)
                .await?,
        )
        .await
    }

    pub async fn membership(&self) -> Result<Membership, Error> {
        self.request(Method::GET, "/api/v1/me", None).await
    }

    pub async fn ticket(&self) -> Result<String, Error> {
        #[derive(Deserialize)]
        struct Ticket {
            ticket: String,
        }
        let ticket: Ticket = self
            .request(Method::POST, "/api/v1/events/ticket", Some(json!({})))
            .await?;
        if ticket.ticket.len() != 64 || !ticket.ticket.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(Error::Data);
        }
        Ok(ticket.ticket)
    }

    pub async fn timeline(&self, channel: Uuid, before: i64) -> Result<Timeline, Error> {
        self.request(
            Method::GET,
            &format!("/api/v1/channels/{channel}/timeline?before={before}"),
            None,
        )
        .await
    }

    pub async fn changes(&self, channel: Uuid, after: i64) -> Result<Vec<Change>, Error> {
        #[derive(Deserialize)]
        struct Changes {
            changes: Vec<Change>,
        }
        let result: Changes = self
            .request(
                Method::GET,
                &format!("/api/v1/channels/{channel}/messages/changes?after={after}"),
                None,
            )
            .await?;
        Ok(result.changes)
    }

    pub async fn send_message(
        &self,
        channel: Uuid,
        body: &str,
        request: Uuid,
    ) -> Result<Message, Error> {
        self.request(
            Method::POST,
            &format!("/api/v1/channels/{channel}/messages"),
            Some(json!({ "body": body, "requestId": request })),
        )
        .await
    }

    pub async fn grant(&self, channel: Uuid) -> Result<Grant, GrantError> {
        let response = self
            .server
            .send(
                Method::POST,
                "/api/v1/voice/grant",
                Some(&self.cookie),
                Some(json!({ "channelId": channel })),
            )
            .await
            .map_err(|error| match error {
                Error::Network => GrantError::Unconfirmed(error),
                error => GrantError::Rejected(error),
            })?;
        let grant: Grant = decode(response).await.map_err(GrantError::Unconfirmed)?;
        if grant.identity.is_empty() {
            return Err(GrantError::Unconfirmed(Error::Data));
        }
        Ok(grant)
    }

    pub async fn leave(&self, identity: &str) -> Result<(), Error> {
        self.server
            .send(
                Method::POST,
                "/api/v1/voice/leave",
                Some(&self.cookie),
                Some(json!({ "identity": identity })),
            )
            .await?;
        Ok(())
    }

    pub fn grant_url(&self, grant: &Grant, channel: Uuid) -> Result<Url, Error> {
        let expected = self.server.socket_url("/livekit")?;
        let url = Url::parse(&grant.url).map_err(|_| Error::Data)?;
        if grant.channel_id != channel || grant.identity.is_empty() || url != expected {
            return Err(Error::Data);
        }
        Ok(url)
    }
}

pub(crate) fn http_client(timeout: Duration) -> Result<Client, Error> {
    Client::builder()
        .redirect(Policy::none())
        .timeout(timeout)
        .build()
        .map_err(|_| Error::Network)
}

async fn decode<T: DeserializeOwned>(mut response: Response) -> Result<T, Error> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| Error::Network)? {
        if chunk.len() > MAX_RESPONSE_BYTES - body.len() {
            return Err(Error::Data);
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| Error::Data)
}

fn parse_origin(address: &str, debug_loopback: bool) -> Result<Url, Error> {
    let address = address.trim();
    let input = if address.contains("://") {
        address.to_owned()
    } else {
        format!("https://{address}")
    };
    let url = Url::parse(&input).map_err(|_| Error::Address)?;
    let loopback = debug_loopback
        && url.scheme() == "http"
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if !(url.scheme() == "https" || loopback)
        || url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(Error::Address);
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::parse_origin;

    #[test]
    fn origins_are_canonical_and_http_is_development_loopback_only() {
        assert_eq!(
            parse_origin("YAPPER.example:443", false).unwrap().as_str(),
            "https://yapper.example/"
        );
        for address in [
            "http://yapper.example",
            "https://name@yapper.example",
            "https://yapper.example/path",
            "https://yapper.example/?code=secret",
            "https://yapper.example/#channel",
        ] {
            assert!(parse_origin(address, true).is_err(), "{address}");
        }
        assert!(parse_origin("http://[::1]:8090", true).is_ok());
        assert!(parse_origin("http://127.0.0.1:8090", false).is_err());
    }
}
