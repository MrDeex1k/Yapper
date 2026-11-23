use reqwest::header::{AUTHORIZATION, COOKIE, HeaderName, HeaderValue, ORIGIN, SET_COOKIE};
use reqwest::{Client, Method, Response, StatusCode, Url, redirect::Policy};
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};

mod account;
pub(crate) mod events;

const SERVICE: &str = "Yapper GPUI";
const SECURE_COOKIE: &str = "__Host-yapper_guest";
const DEV_COOKIE: &str = "yapper_guest";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failure {
    Address,
    Network,
    CredentialStore,
    Setup,
    Denied,
    RateLimited,
    Data,
    Voice,
    Microphone,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Installation {
    pub name: String,
    pub configured: bool,
    pub open_admission: bool,
}

#[derive(Deserialize, PartialEq, Eq)]
pub struct Participant {
    pub id: String,
    pub nickname: String,
    pub role: String,
}

#[derive(Deserialize, PartialEq, Eq)]
pub struct Membership {
    pub participant: Participant,
    #[serde(default)]
    pub categories: Vec<Category>,
    pub channels: Vec<Channel>,
}

#[derive(Deserialize, PartialEq, Eq)]
pub struct Category {
    pub id: String,
    pub name: String,
}

#[derive(Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    pub id: String,
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub category_id: String,
    #[serde(default)]
    pub archived: bool,
}

#[derive(Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub author_id: String,
    pub sequence: i64,
    pub revision: i64,
    pub nickname: String,
    pub body: String,
}

#[derive(Deserialize)]
pub struct Timeline {
    pub messages: Vec<Message>,
    pub before: i64,
    pub revision: i64,
}

#[derive(Deserialize)]
pub struct MessageChange {
    pub id: String,
    pub revision: i64,
    pub message: Option<Message>,
}

#[derive(Deserialize)]
struct MessageChanges {
    changes: Vec<MessageChange>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Grant {
    pub url: String,
    pub token: String,
    pub identity: String,
    pub channel_id: String,
    pub can_publish: bool,
}

#[derive(Clone)]
pub struct Server {
    origin: Url,
    client: Client,
}

#[derive(Clone)]
pub struct Session {
    server: Server,
    cookie: HeaderValue,
    account: Option<Arc<account::AccountToken>>,
}

pub struct Admission {
    pub session: Session,
    pub membership: Membership,
    pub saved: bool,
}

#[derive(Clone)]
pub struct PendingAdmission {
    session: Session,
    saved: bool,
}

impl PendingAdmission {
    pub async fn finish(&self) -> Result<Admission, Failure> {
        let membership = self.session.membership().await?;
        Ok(Admission {
            session: self.session.clone(),
            membership,
            saved: self.saved,
        })
    }
}

impl Server {
    pub async fn connect(address: &str) -> Result<(Self, Installation), Failure> {
        let origin = parse_origin(address, cfg!(debug_assertions))?;
        let client = Client::builder()
            .redirect(Policy::none())
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| Failure::Network)?;
        let server = Self { origin, client };
        let state: Installation = server
            .request(Method::GET, "/api/v1/state", None, None)
            .await?;
        if !state.configured {
            return Err(Failure::Setup);
        }
        Ok((server, state))
    }

    pub async fn restore(&self) -> Result<Option<Admission>, Failure> {
        if let Some(account) = self.restore_account().await? {
            return Ok(Some(account));
        }
        let origin = self.origin.origin().ascii_serialization();
        let credential = tokio::task::spawn_blocking(move || {
            keyring::Entry::new(SERVICE, &origin)?.get_password()
        })
        .await
        .map_err(|_| Failure::CredentialStore)?;
        let secret = match credential {
            Ok(secret) => secret,
            Err(keyring::Error::NoEntry) => return Ok(None),
            Err(_) => return Err(Failure::CredentialStore),
        };
        let pending = PendingAdmission {
            session: self.session(&secret)?,
            saved: true,
        };
        pending.finish().await.map(Some)
    }

    pub async fn begin_admission(
        &self,
        nickname: String,
        invitation: String,
    ) -> Result<PendingAdmission, Failure> {
        let response = self
            .send(
                Method::POST,
                "/api/v1/guests",
                None,
                Some(json!({ "nickname": nickname, "invitation": invitation })),
            )
            .await?;
        let secret = response
            .headers()
            .get_all(SET_COOKIE)
            .iter()
            .filter_map(|header| header.to_str().ok()?.split(';').next()?.split_once('='))
            .find_map(|(name, value)| (name == self.cookie_name()).then(|| value.to_owned()))
            .ok_or(Failure::Data)?;
        let session = self.session(&secret)?;
        let origin = self.origin.origin().ascii_serialization();
        let saved = matches!(
            tokio::task::spawn_blocking(move || {
                keyring::Entry::new(SERVICE, &origin)?.set_password(&secret)
            })
            .await,
            Ok(Ok(()))
        );
        Ok(PendingAdmission { session, saved })
    }

    fn cookie_name(&self) -> &'static str {
        if self.origin.scheme() == "https" {
            SECURE_COOKIE
        } else {
            DEV_COOKIE
        }
    }

    fn session(&self, secret: &str) -> Result<Session, Failure> {
        if secret.is_empty()
            || secret.len() > 128
            || !secret
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(Failure::Data);
        }
        let mut cookie = HeaderValue::from_str(&format!("{}={secret}", self.cookie_name()))
            .map_err(|_| Failure::Data)?;
        cookie.set_sensitive(true);
        Ok(Session {
            server: self.clone(),
            cookie,
            account: None,
        })
    }

    pub fn origin(&self) -> String {
        self.origin.origin().ascii_serialization()
    }

    async fn request<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        cookie: Option<&HeaderValue>,
        body: Option<Value>,
    ) -> Result<T, Failure> {
        self.send(method, path, cookie, body)
            .await?
            .json()
            .await
            .map_err(|_| Failure::Data)
    }

    async fn send(
        &self,
        method: Method,
        path: &str,
        cookie: Option<&HeaderValue>,
        body: Option<Value>,
    ) -> Result<Response, Failure> {
        self.send_with(method, path, cookie.map(|value| (COOKIE, value)), body)
            .await
    }

    async fn send_with(
        &self,
        method: Method,
        path: &str,
        credential: Option<(HeaderName, &HeaderValue)>,
        body: Option<Value>,
    ) -> Result<Response, Failure> {
        let url = self.origin.join(path).map_err(|_| Failure::Data)?;
        let mut request = self
            .client
            .request(method, url)
            .header(ORIGIN, self.origin.origin().ascii_serialization());
        if let Some((name, value)) = credential {
            request = request.header(name, value);
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.map_err(|_| Failure::Network)?;
        match response.status() {
            status if status.is_success() => Ok(response),
            status if status.is_server_error() => Err(Failure::Network),
            StatusCode::BAD_REQUEST
            | StatusCode::UNAUTHORIZED
            | StatusCode::FORBIDDEN
            | StatusCode::CONFLICT => Err(Failure::Denied),
            StatusCode::TOO_MANY_REQUESTS => Err(Failure::RateLimited),
            _ => Err(Failure::Data),
        }
    }
}

impl Session {
    async fn send(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Response, Failure> {
        if let Some(account) = &self.account {
            let bearer = account.bearer(&self.server, &self.cookie).await?;
            return self
                .server
                .send_with(method, path, Some((AUTHORIZATION, &bearer)), body)
                .await;
        }
        self.server
            .send(method, path, Some(&self.cookie), body)
            .await
    }

    async fn request<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<T, Failure> {
        self.send(method, path, body)
            .await?
            .json()
            .await
            .map_err(|_| Failure::Data)
    }

    pub async fn membership(&self) -> Result<Membership, Failure> {
        self.request(Method::GET, "/api/v1/me", None).await
    }

    pub async fn timeline(&self, channel: &str, before: i64) -> Result<Timeline, Failure> {
        let id = uuid::Uuid::parse_str(channel).map_err(|_| Failure::Data)?;
        self.request(
            Method::GET,
            &format!("/api/v1/channels/{id}/timeline?before={before}"),
            None,
        )
        .await
    }

    pub async fn changes(&self, channel: &str, after: i64) -> Result<Vec<MessageChange>, Failure> {
        let id = uuid::Uuid::parse_str(channel).map_err(|_| Failure::Data)?;
        let result: MessageChanges = self
            .request(
                Method::GET,
                &format!("/api/v1/channels/{id}/messages/changes?after={after}"),
                None,
            )
            .await?;
        Ok(result.changes)
    }

    pub async fn update_message(
        &self,
        channel: &str,
        id: &str,
        edit: Option<(&str, i64)>,
    ) -> Result<(), Failure> {
        let channel = uuid::Uuid::parse_str(channel).map_err(|_| Failure::Data)?;
        let id = uuid::Uuid::parse_str(id).map_err(|_| Failure::Data)?;
        let (action, body) = edit.map_or_else(
            || ("delete", json!({})),
            |(body, revision)| ("edit", json!({"body": body, "revision": revision})),
        );
        self.send(
            Method::POST,
            &format!("/api/v1/channels/{channel}/messages/{id}/{action}"),
            Some(body),
        )
        .await?;
        Ok(())
    }

    pub async fn moderate(&self, participant: &str, action: &str) -> Result<(), Failure> {
        let id = uuid::Uuid::parse_str(participant).map_err(|_| Failure::Data)?;
        self.send(
            Method::POST,
            &format!("/api/v1/participants/{id}/moderate"),
            Some(json!({"action": action})),
        )
        .await?;
        Ok(())
    }

    pub async fn send_message(
        &self,
        channel: &str,
        body: &str,
        request_id: uuid::Uuid,
    ) -> Result<(), Failure> {
        let id = uuid::Uuid::parse_str(channel).map_err(|_| Failure::Data)?;
        self.send(
            Method::POST,
            &format!("/api/v1/channels/{id}/messages"),
            Some(json!({ "body": body, "requestId": request_id.to_string() })),
        )
        .await?;
        Ok(())
    }

    pub async fn grant(&self, channel_id: &str) -> Result<Grant, Failure> {
        self.resume_voice(channel_id, "").await
    }

    pub async fn resume_voice(
        &self,
        channel_id: &str,
        resume_identity: &str,
    ) -> Result<Grant, Failure> {
        self.request(
            Method::POST,
            "/api/v1/voice/grant",
            Some(json!({ "channelId": channel_id, "resumeIdentity": resume_identity })),
        )
        .await
    }

    pub async fn leave(&self, identity: &str) -> Result<(), Failure> {
        self.send(
            Method::POST,
            "/api/v1/voice/leave",
            Some(json!({ "identity": identity })),
        )
        .await?;
        Ok(())
    }

    pub fn validate_grant(&self, grant: &Grant, channel: &str) -> Result<(), Failure> {
        let url = Url::parse(&grant.url).map_err(|_| Failure::Data)?;
        if grant.channel_id != channel
            || url.path() != "/livekit"
            || url.query().is_some()
            || url.fragment().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.origin().ascii_serialization()
                != self
                    .server
                    .origin
                    .origin()
                    .ascii_serialization()
                    .replacen("http", "ws", 1)
        {
            return Err(Failure::Data);
        }
        Ok(())
    }
}

fn parse_origin(address: &str, allow_loopback_http: bool) -> Result<Url, Failure> {
    let address = address.trim();
    let input = if address.contains("://") {
        address.to_owned()
    } else {
        format!("https://{address}")
    };
    let url = Url::parse(&input).map_err(|_| Failure::Address)?;
    let allow_http = allow_loopback_http
        && url.scheme() == "http"
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if !(url.scheme() == "https" || allow_http)
        || url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(Failure::Address);
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_server_origins_are_accepted() {
        assert_eq!(
            parse_origin("yapper.example:8443", false).unwrap().as_str(),
            "https://yapper.example:8443/"
        );
        assert!(parse_origin("http://127.0.0.1:8090", true).is_ok());
        assert!(parse_origin("http://127.0.0.1:8090", false).is_err());
        assert!(parse_origin("http://yapper.example", true).is_err());
        assert!(parse_origin("https://user@yapper.example", false).is_err());
        assert!(parse_origin("https://yapper.example/path", false).is_err());
        assert!(parse_origin("https://yapper.example/?token=x", false).is_err());
    }
}
