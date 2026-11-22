use async_trait::async_trait;
use livekit_net::{
    Header, HttpClient, HttpMethod, HttpResponse, TransportError, WsClient, WsConnectResult,
};
use std::sync::Arc;
use url::Url;

pub fn install() {
    if let (Some(ws), Some(http)) = (livekit_net::ws_client(), livekit_net::http_client()) {
        let transport = Arc::new(GateTransport { ws, http });
        livekit_net::set_ws_client(transport.clone());
        livekit_net::set_http_client(transport);
    }
}

struct GateTransport {
    ws: Arc<dyn WsClient>,
    http: Arc<dyn HttpClient>,
}

#[async_trait]
impl WsClient for GateTransport {
    async fn connect(
        &self,
        url: String,
        headers: Vec<Header>,
        timeout_ms: u64,
    ) -> Result<WsConnectResult, TransportError> {
        let (url, headers) = gate_request(&url, headers)?;
        self.ws.connect(url, headers, timeout_ms).await
    }
}

#[async_trait]
impl HttpClient for GateTransport {
    async fn request(
        &self,
        method: HttpMethod,
        url: String,
        headers: Vec<Header>,
        body: Option<Vec<u8>>,
    ) -> Result<HttpResponse, TransportError> {
        let (url, headers) = gate_request(&url, headers)?;
        self.http.request(method, url, headers, body).await
    }
}

// The SDK uses a bearer header. The existing Go signaling gate accepts the
// same media grant in the access_token query and requires the application Origin.
fn gate_request(
    raw_url: &str,
    mut headers: Vec<Header>,
) -> Result<(String, Vec<Header>), TransportError> {
    let invalid = || TransportError::Other("Invalid Yapper signaling request".into());
    let mut url = Url::parse(raw_url).map_err(|_| invalid())?;
    if !matches!(url.scheme(), "https" | "http" | "wss" | "ws")
        || !matches!(
            url.path(),
            "/livekit/rtc"
                | "/livekit/rtc/validate"
                | "/livekit/rtc/v1"
                | "/livekit/rtc/v1/validate"
        )
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.query_pairs().any(|(key, _)| key == "access_token")
    {
        return Err(invalid());
    }
    let authorization = headers
        .iter()
        .position(|header| header.name.eq_ignore_ascii_case("authorization"))
        .ok_or_else(invalid)?;
    let authorization = headers.remove(authorization);
    let token = authorization
        .value
        .strip_prefix("Bearer ")
        .filter(|token| !token.is_empty() && token.len() <= 8192)
        .ok_or_else(invalid)?;
    let origin = url
        .origin()
        .ascii_serialization()
        .replacen("wss://", "https://", 1)
        .replacen("ws://", "http://", 1);
    headers.retain(|header| {
        !header.name.eq_ignore_ascii_case("origin")
            && !header.name.eq_ignore_ascii_case("authorization")
    });
    headers.push(Header {
        name: "Origin".into(),
        value: origin,
    });
    url.query_pairs_mut().append_pair("access_token", token);
    Ok((url.into(), headers))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bearer() -> Vec<Header> {
        vec![Header {
            name: "Authorization".into(),
            value: "Bearer demo.token".into(),
        }]
    }

    #[test]
    fn adds_origin_and_grant_to_sdk_upgrade_and_validation() {
        let (url, headers) = gate_request(
            "wss://yapper.example:8443/livekit/rtc?protocol=15",
            bearer(),
        )
        .unwrap();
        assert_eq!(
            url,
            "wss://yapper.example:8443/livekit/rtc?protocol=15&access_token=demo.token"
        );
        assert_eq!(headers.len(), 1);
        assert_eq!(headers[0].name, "Origin");
        assert_eq!(headers[0].value, "https://yapper.example:8443");

        let (_, headers) =
            gate_request("http://localhost:8090/livekit/rtc/v1/validate", bearer()).unwrap();
        assert_eq!(headers[0].value, "http://localhost:8090");
    }

    #[test]
    fn refuses_unexpected_routes_and_ambiguous_tokens() {
        assert!(gate_request("wss://yapper.example/rtc", bearer()).is_err());
        assert!(
            gate_request(
                "wss://yapper.example/livekit/rtc?access_token=other",
                bearer()
            )
            .is_err()
        );
        assert!(gate_request("wss://yapper.example/livekit/rtc", vec![]).is_err());
    }
}
