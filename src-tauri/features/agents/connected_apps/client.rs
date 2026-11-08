//! Composio's REST v3.1 API, called from this computer with the person's key. The key stays in this
//! file's client: it goes out only as a header to Composio, redirects are refused so it never follows
//! one, and nothing here logs it.
use std::{
    collections::HashMap,
    future::Future,
    sync::{Mutex, PoisonError},
    time::{Duration, Instant},
};

use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use super::api::ToolInfo;

const CLOUD_BASE: &str = "https://backend.composio.dev/api/v3.1/";
const MAX_RESPONSE_BYTES: usize = 4 << 20;
const REQUEST_LIMIT: Duration = Duration::from_secs(45);
const MAX_ERROR_CHARS: usize = 400;
const MAX_REQUEST_ID_CHARS: usize = 80;

#[derive(Clone, Debug, PartialEq)]
pub enum Error {
    /// No key saved on this computer.
    Unavailable,
    /// No response, so the request's effect is unknown.
    Transport,
    /// An answer Composio gave. `message` is safe to show the model.
    Api { status: u16, message: String },
}

impl Error {
    /// Composio answered without running the request. Timeouts and server errors aren't rejections:
    /// the request may have run.
    pub fn rejected(&self) -> bool {
        matches!(self, Self::Api { status, .. } if (400..500).contains(status) && *status != 408)
    }

    pub fn not_found(&self) -> bool {
        matches!(self, Self::Api { status: 404, .. })
    }

    pub fn bad_gateway(message: &str) -> Self {
        Self::Api {
            status: 502,
            message: message.to_owned(),
        }
    }
}

/// Cuts at `limit` characters, the way the server's tool text is cut.
pub fn truncate(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_owned();
    }
    let kept: String = value.chars().take(limit.saturating_sub(1)).collect();
    format!("{}…", kept.trim())
}

fn api_error(status: u16, raw: &[u8]) -> Error {
    let body: Value = serde_json::from_slice(raw).unwrap_or(Value::Null);
    let part = |name: &str| body["error"][name].as_str().unwrap_or_default().to_owned();
    let mut message = format!("{} {}", part("message"), part("suggested_fix"));
    message = message.trim().to_owned();
    if message.is_empty() {
        message = format!("Composio returned HTTP {status}.");
    }
    let mut message = truncate(&message, MAX_ERROR_CHARS);
    let request = part("request_id");
    if !request.is_empty() {
        message = format!(
            "{message} (request {})",
            truncate(&request, MAX_REQUEST_ID_CHARS)
        );
    }
    Error::Api { status, message }
}

/// One person's Composio project on this computer: its key, the pseudonymous user whose connections
/// these are, and what's worth keeping between calls.
pub struct Client {
    base: String,
    key: String,
    user: String,
    http: reqwest::Client,
    session: Mutex<Option<String>>,
    pub(super) tools: Mutex<HashMap<String, (ToolInfo, Instant)>>,
    pub(super) identities: Mutex<HashMap<String, String>>,
}

impl Client {
    pub fn new(key: String, user: String) -> Self {
        Self::at(CLOUD_BASE, key, user)
    }

    pub(super) fn at(base: &str, key: String, user: String) -> Self {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let http = reqwest::Client::builder()
            .timeout(REQUEST_LIMIT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap_or_default();
        Self {
            base: base.to_owned(),
            key,
            user,
            http,
            session: Mutex::new(None),
            tools: Mutex::default(),
            identities: Mutex::default(),
        }
    }

    pub fn user(&self) -> &str {
        &self.user
    }

    pub fn holds_key(&self, key: &str) -> bool {
        self.key == key
    }

    async fn send(
        &self,
        method: reqwest::Method,
        path: &str,
        query: &[(&str, &str)],
        body: Option<&Value>,
    ) -> Result<Vec<u8>, Error> {
        let mut target = url::Url::parse(&format!("{}{path}", self.base))
            .map_err(|_| Error::bad_gateway("That connected apps address isn't valid."))?;
        if !query.is_empty() {
            target.query_pairs_mut().extend_pairs(query);
        }
        let mut request = self
            .http
            .request(method, target)
            .header("x-api-key", &self.key)
            .header("accept", "application/json");
        if let Some(body) = body {
            request = request.json(body);
        }
        let mut response = request.send().await.map_err(|_| Error::Transport)?;
        let status = response.status();
        let mut raw = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| Error::Transport)? {
            raw.extend_from_slice(&chunk);
            if raw.len() > MAX_RESPONSE_BYTES {
                return Err(if status.is_success() {
                    Error::bad_gateway(
                        "The app returned more data than Misty accepts. Narrow the request.",
                    )
                } else {
                    Error::Api {
                        status: status.as_u16(),
                        message: format!("Composio returned HTTP {status}."),
                    }
                });
            }
        }
        if !status.is_success() {
            return Err(api_error(status.as_u16(), &raw));
        }
        Ok(raw)
    }

    pub(super) async fn get<T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, &str)],
    ) -> Result<T, Error> {
        read(&self.send(reqwest::Method::GET, path, query, None).await?)
    }

    pub(super) async fn post<T: DeserializeOwned>(
        &self,
        path: &str,
        body: &Value,
    ) -> Result<T, Error> {
        read(
            &self
                .send(reqwest::Method::POST, path, &[], Some(body))
                .await?,
        )
    }

    pub(super) async fn delete(&self, path: &str) -> Result<(), Error> {
        self.send(reqwest::Method::DELETE, path, &[], None)
            .await
            .map(|_| ())
    }

    /// Opens a session that reaches every toolkit. Misty shows its own Connect card, runs no remote
    /// sandbox, and never spends the person's Composio balance on Instant tools. A person can have
    /// several accounts for an app, and Misty names the one on every call.
    async fn create_session(&self) -> Result<String, Error> {
        #[derive(serde::Deserialize)]
        struct Created {
            session_id: String,
        }
        let created: Created = self
            .post(
                "tool_router/session",
                &json!({
                    "user_id": self.user,
                    "manage_connections": { "enable": false },
                    "workbench": { "enable": false },
                    "instant": false,
                    "multi_account": { "enable": true },
                }),
            )
            .await?;
        if !super::api::valid_session(&created.session_id) {
            return Err(Error::bad_gateway("Composio returned an invalid session."));
        }
        Ok(created.session_id)
    }

    async fn session(&self, renew: bool) -> Result<String, Error> {
        if !renew {
            let saved = self
                .session
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .clone();
            if let Some(session) = saved {
                return Ok(session);
            }
        }
        let session = self.create_session().await?;
        *self.session.lock().unwrap_or_else(PoisonError::into_inner) = Some(session.clone());
        Ok(session)
    }

    /// Runs one session call. A 404 means nothing ran, so it's safe to repeat once on a fresh session.
    pub async fn with_session<T, Call, Running>(&self, call: Call) -> Result<T, Error>
    where
        Call: Fn(String) -> Running,
        Running: Future<Output = Result<T, Error>>,
    {
        let session = self.session(false).await?;
        match call(session).await {
            Err(error) if error.not_found() => call(self.session(true).await?).await,
            other => other,
        }
    }
}

fn read<T: DeserializeOwned>(raw: &[u8]) -> Result<T, Error> {
    // A success with no body, as a delete can answer, reads like an empty object.
    let raw = if raw.is_empty() {
        b"{}".as_slice()
    } else {
        raw
    };
    serde_json::from_slice(raw)
        .map_err(|_| Error::bad_gateway("Composio returned an unreadable response."))
}
