//! Calls to the Misty server's run routes, signed with the run's own key. Ported from
//! `control-plane.ts`, `control-plane-error.ts` and `signature.ts`.
use std::{fmt, time::Duration};

use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::future::BoxFuture;
use sha2::{Digest, Sha256};

use super::{
    js_json::JsValue,
    runtime_errors::{ControlPlaneError, RuntimeError},
    text::{js_prefix, js_trim},
    tool_transport::string,
};

pub(crate) const TIMESTAMP_HEADER: &str = "x-misty-agent-timestamp";
pub(crate) const SIGNATURE_HEADER: &str = "x-misty-agent-signature";
pub(crate) const IDEMPOTENCY_HEADER: &str = "idempotency-key";

/// A run's own key (base64), which signs its calls. It never prints.
#[derive(Clone)]
pub(crate) struct RunKey(String);

impl RunKey {
    pub(crate) fn new(key: String) -> Self {
        Self(key)
    }

    pub(crate) fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for RunKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("RunKey([redacted])")
    }
}

#[derive(Clone, Debug)]
pub(crate) struct RuntimeIdentity {
    pub(crate) misty_run_id: String,
    pub(crate) runtime_run_id: String,
    pub(crate) control_plane_url: String,
    pub(crate) run_key: RunKey,
}

/// The local names that may use plain HTTP. Everything else needs HTTPS.
const PRIVATE_HOSTS: [&str; 4] = ["localhost", "127.0.0.1", "api", "misty-api"];

fn normalized_base_url(value: &str) -> Result<String, RuntimeError> {
    let parsed = url::Url::parse(value).map_err(|_| RuntimeError::named("TypeError", "Invalid URL"))?;
    if parsed.scheme() != "https" && !parsed.host_str().is_some_and(|host| PRIVATE_HOSTS.contains(&host)) {
        return Err(RuntimeError::error("MISTY_INTERNAL_API_BASE must use HTTPS except on the private local network"));
    }
    let text = parsed.to_string();
    Ok(text.strip_suffix('/').unwrap_or(&text).to_owned())
}

/// The callback the server signed, or the base the app configured. There's no built-in default.
pub(crate) fn control_plane_url(callback: Option<&str>, internal_base: Option<&str>) -> Result<String, RuntimeError> {
    let callback = callback.map(js_trim).filter(|callback| !callback.is_empty());
    let Some(base) = callback.or(internal_base) else {
        return Err(RuntimeError::error("MISTY_INTERNAL_API_BASE must use HTTPS except on the private local network"));
    };
    normalized_base_url(base)
}

/// `encodeURIComponent`.
pub(crate) fn encode_uri_component(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')') {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    const BLOCK: usize = 64;
    let mut block = [0u8; BLOCK];
    if key.len() > BLOCK {
        block[..32].copy_from_slice(&sha256(key));
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let pad = |value: u8| block.iter().map(|byte| byte ^ value).collect::<Vec<u8>>();
    let inner = sha256(&[pad(0x36).as_slice(), message].concat());
    sha256(&[pad(0x5c).as_slice(), inner.as_slice()].concat())
}

/// `signRequest` from `signature.ts`.
pub(crate) fn sign_request(secret: &[u8], method: &str, path: &str, timestamp: &str, body: &[u8]) -> String {
    let digest = hex::encode(sha256(body));
    let message = format!("{}\n{path}\n{timestamp}\n{digest}", method.to_uppercase());
    hex::encode(hmac_sha256(secret, message.as_bytes()))
}

/// What the run loop needs from the server. Tests stand in for it.
pub(crate) trait ControlPlane: Send + Sync {
    fn request<'a>(&'a self, identity: &'a RuntimeIdentity, action: &'static str, payload: JsValue, idempotency_key: String) -> BoxFuture<'a, Result<JsValue, RuntimeError>>;
}

pub(crate) struct HttpControlPlane {
    pub(crate) client: reqwest::Client,
}

/// `{ runtime_run_id, ...payload }`.
fn request_body(identity: &RuntimeIdentity, payload: JsValue) -> String {
    let mut body = JsValue::Object(vec![("runtime_run_id".to_owned(), string(identity.runtime_run_id.as_str()))]);
    if let JsValue::Object(fields) = payload {
        for (name, value) in fields {
            body = body.with_field(&name, value);
        }
    }
    body.stringify()
}

/// A non-success answer as `ControlPlaneError`. Non-JSON errors are still bounded before they enter
/// user-visible logs.
fn failure_of(status: u16, text: &str) -> ControlPlaneError {
    let mut code = "control_plane_error".to_owned();
    let mut detail = js_prefix(text, 500).to_owned();
    if let Some(payload) = JsValue::parse(text) {
        let field = |name: &str| payload.get(name).and_then(JsValue::as_str).map(js_trim).filter(|value| !value.is_empty());
        if let Some(found) = field("code") {
            code = found.to_owned();
        }
        if let Some(found) = field("message").or(field("code")) {
            detail = found.to_owned();
        }
    }
    let shown = if detail.is_empty() { format!("Misty control plane returned {status}") } else { detail };
    ControlPlaneError::new(status, format!("{code}: {shown}"), Some(&code))
}

/// What `fetch` throws, in the terms the error checks read.
pub(crate) fn network_error(error: &reqwest::Error) -> RuntimeError {
    if error.is_timeout() {
        RuntimeError::named("TimeoutError", "The operation was aborted due to timeout")
    } else {
        RuntimeError::named("TypeError", "fetch failed")
    }
}

impl ControlPlane for HttpControlPlane {
    fn request<'a>(&'a self, identity: &'a RuntimeIdentity, action: &'static str, payload: JsValue, idempotency_key: String) -> BoxFuture<'a, Result<JsValue, RuntimeError>> {
        Box::pin(async move {
            let path = format!("/internal/agent-runtime/runs/{}/{action}", encode_uri_component(&identity.misty_run_id));
            let body = request_body(identity, payload);
            let secret = STANDARD.decode(identity.run_key.expose()).map_err(|_| RuntimeError::error("invalid_run_key"))?;
            let timestamp = (super::clock::now_ms() / 1000).to_string();
            let signature = sign_request(&secret, "POST", &path, &timestamp, body.as_bytes());
            let response = self
                .client
                .post(format!("{}{path}", identity.control_plane_url))
                .header("content-type", "application/json")
                .header(TIMESTAMP_HEADER, timestamp)
                .header(SIGNATURE_HEADER, signature)
                .header(IDEMPOTENCY_HEADER, idempotency_key)
                .body(body)
                .timeout(Duration::from_secs(30))
                .send()
                .await
                .map_err(|error| network_error(&error))?;
            let status = response.status();
            let text = response.text().await.map_err(|error| network_error(&error))?;
            if !status.is_success() {
                return Err(failure_of(status.as_u16(), &text).into());
            }
            if text.is_empty() {
                return Ok(JsValue::Object(Vec::new()));
            }
            JsValue::parse(&text).ok_or_else(|| RuntimeError::named("SyntaxError", "Unexpected token in JSON from Misty's control plane"))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_private_development_compose_api_hostname() {
        assert_eq!(control_plane_url(None, Some("http://misty-api:8080")).unwrap(), "http://misty-api:8080");
    }

    #[test]
    fn still_requires_https_for_public_hostnames() {
        let error = control_plane_url(None, Some("http://dev-api.mistysys.com")).unwrap_err();
        assert!(error.to_string().contains("MISTY_INTERNAL_API_BASE must use HTTPS"));
    }

    #[test]
    fn uses_the_callback_origin_from_a_signed_go_run_request() {
        assert_eq!(control_plane_url(Some("https://api.example.com/"), Some("https://fallback.example.com")).unwrap(), "https://api.example.com");
    }

    #[test]
    fn rejects_an_insecure_public_callback_origin() {
        let error = control_plane_url(Some("http://api.example.com"), None).unwrap_err();
        assert!(error.to_string().contains("MISTY_INTERNAL_API_BASE must use HTTPS"));
    }

    #[test]
    fn signs_as_the_server_verifies() {
        // RFC 4231 test case 2 for the MAC, then the signed text agent_runtime_config.go rebuilds.
        assert_eq!(hex::encode(hmac_sha256(b"Jefe", b"what do ya want for nothing?")), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
        let long = [0xaa_u8; 131];
        assert_eq!(hex::encode(hmac_sha256(&long, b"Test Using Larger Than Block-Size Key - Hash Key First")), "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54");
    }

    #[test]
    fn failures_keep_their_code_and_a_bounded_detail() {
        let plain = failure_of(502, &"x".repeat(600));
        assert_eq!(plain.code, "control_plane_error");
        assert_eq!(plain.message.len(), "control_plane_error: ".len() + 500);
        assert!(plain.transient);
        let coded = failure_of(409, r#"{"code":"agent_model_turn_limit","message":"Limit."}"#);
        assert_eq!(coded.message, "agent_model_turn_limit: Limit.");
        assert_eq!(failure_of(500, "").message, "control_plane_error: Misty control plane returned 500");
        assert!(!failure_of(429, r#"{"code":"usage_limit_reached"}"#).transient);
    }

    #[test]
    fn the_key_never_prints() {
        let identity = RuntimeIdentity { misty_run_id: "r".into(), runtime_run_id: "w".into(), control_plane_url: "u".into(), run_key: RunKey::new("secret-key".into()) };
        assert!(!format!("{identity:?}").contains("secret-key"));
    }
}
