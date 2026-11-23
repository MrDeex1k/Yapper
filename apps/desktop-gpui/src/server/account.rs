use super::{Admission, Failure, PendingAdmission, Server, Session};
use reqwest::{
    Method,
    header::{HeaderValue, SET_COOKIE},
};
use serde::Deserialize;
use serde_json::json;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

const SERVICE: &str = "Yapper GPUI account";
const TOKEN_REFRESH: Duration = Duration::from_secs(240);

#[derive(Default)]
pub(super) struct AccountToken(Mutex<Option<(Instant, HeaderValue)>>);

impl AccountToken {
    pub(super) async fn bearer(
        &self,
        server: &Server,
        cookie: &HeaderValue,
    ) -> Result<HeaderValue, Failure> {
        let mut state = self.0.lock().await;
        if let Some((issued, token)) = state.as_ref()
            && issued.elapsed() < TOKEN_REFRESH
        {
            return Ok(token.clone());
        }
        #[derive(Deserialize)]
        struct Token {
            token: String,
        }
        let token: Token = server
            .request(Method::GET, "/api/auth/token", Some(cookie), None)
            .await?;
        let mut header =
            HeaderValue::from_str(&format!("Bearer {}", token.token)).map_err(|_| Failure::Data)?;
        header.set_sensitive(true);
        *state = Some((Instant::now(), header.clone()));
        Ok(header)
    }
}

impl Server {
    fn account_cookie_name(&self) -> &'static str {
        if self.origin.scheme() == "https" {
            "__Secure-better-auth.session_token"
        } else {
            "better-auth.session_token"
        }
    }

    fn account_session(&self, secret: &str) -> Result<Session, Failure> {
        if secret.is_empty()
            || secret.len() > 4096
            || !secret.bytes().all(|value| {
                value.is_ascii_graphic() && !matches!(value, b';' | b',' | b'"' | b'\\')
            })
        {
            return Err(Failure::Data);
        }
        let mut cookie = HeaderValue::from_str(&format!("{}={secret}", self.account_cookie_name()))
            .map_err(|_| Failure::Data)?;
        cookie.set_sensitive(true);
        Ok(Session {
            server: self.clone(),
            cookie,
            account: Some(Arc::new(AccountToken::default())),
        })
    }

    pub async fn sign_in(&self, username: String, password: String) -> Result<Admission, Failure> {
        let response = self
            .send(
                Method::POST,
                "/api/auth/sign-in/username",
                None,
                Some(json!({ "username": username, "password": password })),
            )
            .await?;
        let secret = response
            .headers()
            .get_all(SET_COOKIE)
            .iter()
            .filter_map(|header| header.to_str().ok()?.split(';').next()?.split_once('='))
            .find_map(|(name, value)| {
                (name == self.account_cookie_name()).then(|| value.to_owned())
            })
            .ok_or(Failure::Data)?;
        let session = self.account_session(&secret)?;
        let membership = session.membership().await?;
        let origin = self.origin();
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

    pub(super) async fn restore_account(&self) -> Result<Option<Admission>, Failure> {
        let origin = self.origin();
        let stored = tokio::task::spawn_blocking(move || {
            keyring::Entry::new(SERVICE, &origin)?.get_password()
        })
        .await
        .map_err(|_| Failure::CredentialStore)?;
        let secret = match stored {
            Ok(secret) => secret,
            Err(keyring::Error::NoEntry) => return Ok(None),
            Err(_) => return Err(Failure::CredentialStore),
        };
        let pending = PendingAdmission {
            session: self.account_session(&secret)?,
            saved: true,
        };
        match pending.finish().await {
            Ok(account) => Ok(Some(account)),
            Err(Failure::Denied) => {
                self.forget_account().await?;
                Ok(None)
            }
            Err(error) => Err(error),
        }
    }

    async fn forget_account(&self) -> Result<(), Failure> {
        let origin = self.origin();
        match tokio::task::spawn_blocking(move || {
            keyring::Entry::new(SERVICE, &origin)?.delete_credential()
        })
        .await
        {
            Ok(Ok(()) | Err(keyring::Error::NoEntry)) => Ok(()),
            _ => Err(Failure::CredentialStore),
        }
    }
}

impl Session {
    pub fn is_account(&self) -> bool {
        self.account.is_some()
    }

    pub async fn sign_out(&self) -> Result<(), Failure> {
        let Some(account) = &self.account else {
            return Ok(());
        };
        self.server
            .send(
                Method::POST,
                "/api/auth/sign-out",
                Some(&self.cookie),
                Some(json!({})),
            )
            .await?;
        *account.0.lock().await = None;
        self.server.forget_account().await
    }
}
