use reqwest::header::{COOKIE, HeaderValue, ORIGIN, SET_COOKIE};
use reqwest::{Client, Method, Response, StatusCode, Url, redirect::Policy};
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::time::Duration;

const SERVICE: &str = "Yapper GPUI";
const SECURE_COOKIE: &str = "__Host-yapper_guest";
const DEV_COOKIE: &str = "yapper_guest";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failure {
    Address,
    Network,
    Setup,
    Denied,
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

#[derive(Deserialize)]
pub struct Participant {
    pub nickname: String,
}

#[derive(Deserialize)]
pub struct Membership {
    pub participant: Participant,
    pub channels: Vec<Channel>,
}

#[derive(Deserialize)]
pub struct Channel {
    pub id: String,
    pub name: String,
    pub kind: String,
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
}

pub struct Admission {
    pub session: Session,
    pub membership: Membership,
    pub saved: bool,
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
        let origin = self.origin.origin().ascii_serialization();
        let Ok(Ok(secret)) = tokio::task::spawn_blocking(move || {
            keyring::Entry::new(SERVICE, &origin)?.get_password()
        })
        .await
        else {
            return Ok(None);
        };

        let session = self.session(&secret)?;
        match session.membership().await {
            Ok(membership) => Ok(Some(Admission {
                session,
                membership,
                saved: true,
            })),
            Err(Failure::Denied) => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub async fn join(&self, nickname: String, invitation: String) -> Result<Admission, Failure> {
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
        let membership = session.membership().await?;
        let origin = self.origin.origin().ascii_serialization();
        let saved = matches!(
            tokio::task::spawn_blocking(move || {
                keyring::Entry::new(SERVICE, &origin)?.set_password(&secret)
            })
            .await,
            Ok(Ok(()))
        );
        Ok(Admission {
            session,
            membership,
            saved,
        })
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
        })
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
        let url = self.origin.join(path).map_err(|_| Failure::Data)?;
        let mut request = self
            .client
            .request(method, url)
            .header(ORIGIN, self.origin.origin().ascii_serialization());
        if let Some(cookie) = cookie {
            request = request.header(COOKIE, cookie);
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.map_err(|_| Failure::Network)?;
        match response.status() {
            status if status.is_success() => Ok(response),
            StatusCode::BAD_REQUEST
            | StatusCode::UNAUTHORIZED
            | StatusCode::FORBIDDEN
            | StatusCode::CONFLICT
            | StatusCode::TOO_MANY_REQUESTS => Err(Failure::Denied),
            _ => Err(Failure::Data),
        }
    }
}

impl Session {
    async fn membership(&self) -> Result<Membership, Failure> {
        self.server
            .request(Method::GET, "/api/v1/me", Some(&self.cookie), None)
            .await
    }

    pub async fn grant(&self, channel_id: &str) -> Result<Grant, Failure> {
        self.server
            .request(
                Method::POST,
                "/api/v1/voice/grant",
                Some(&self.cookie),
                Some(json!({ "channelId": channel_id })),
            )
            .await
    }

    pub async fn leave(&self, identity: &str) -> Result<(), Failure> {
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
