//! Talking to an app's own MCP server over Streamable HTTP: `initialize`, then `tools/list` or
//! `tools/call`, with the person's token. One short session per request keeps nothing open between
//! calls.
use std::time::Duration;

use reqwest::{header, Client, StatusCode};
use serde_json::{json, Value};

pub const PROTOCOL_VERSION: &str = "2025-06-18";
const SESSION_HEADER: &str = "mcp-session-id";
const CALL_LIMIT: Duration = Duration::from_secs(120);
/// An answer bigger than this is cut off; the model sees far less anyway.
const BODY_LIMIT: usize = 4 << 20;
const MAX_TOOL_PAGES: usize = 10;

#[derive(Debug)]
pub enum CallError {
    /// The token was refused: refresh it or sign in again.
    Unauthorized,
    Failed(String),
}

/// The JSON-RPC answer whose id is `id`, from a JSON body or an event stream.
pub fn answer_in(body: &str, content_type: &str, id: i64) -> Option<Value> {
    if !content_type.starts_with("text/event-stream") {
        return serde_json::from_str(body).ok();
    }
    let mut data = String::new();
    let mut found = None;
    for line in body.lines().chain(std::iter::once("")) {
        if let Some(rest) = line.strip_prefix("data:") {
            data.push_str(rest.trim_start());
            continue;
        }
        if line.is_empty() && !data.is_empty() {
            if let Ok(message) = serde_json::from_str::<Value>(&data) {
                if message["id"].as_i64() == Some(id) {
                    found = Some(message);
                    break;
                }
            }
            data.clear();
        }
    }
    found
}

struct Session<'a> {
    http: &'a Client,
    url: &'a str,
    token: &'a str,
    id: Option<String>,
    next: i64,
}

impl Session<'_> {
    fn request(&self, body: &Value) -> reqwest::RequestBuilder {
        let mut request = self
            .http
            .post(self.url)
            .bearer_auth(self.token)
            .header(header::ACCEPT, "application/json, text/event-stream")
            .header("mcp-protocol-version", PROTOCOL_VERSION)
            .timeout(CALL_LIMIT)
            .json(body);
        if let Some(id) = &self.id {
            request = request.header(SESSION_HEADER, id);
        }
        request
    }

    async fn call(&mut self, method: &str, params: Value) -> Result<Value, CallError> {
        self.next += 1;
        let id = self.next;
        let body = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        let response = self
            .request(&body)
            .send()
            .await
            .map_err(|_| CallError::Failed("The app didn't answer. Try again.".to_owned()))?;
        if response.status() == StatusCode::UNAUTHORIZED {
            return Err(CallError::Unauthorized);
        }
        if let Some(session) = response
            .headers()
            .get(SESSION_HEADER)
            .and_then(|value| value.to_str().ok())
        {
            self.id = Some(session.to_owned());
        }
        let status = response.status();
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_owned();
        let bytes = response
            .bytes()
            .await
            .map_err(|_| CallError::Failed("The app's answer was cut off.".to_owned()))?;
        let text = String::from_utf8_lossy(&bytes[..bytes.len().min(BODY_LIMIT)]);
        if !status.is_success() {
            return Err(CallError::Failed(format!(
                "The app answered {}.",
                status.as_u16()
            )));
        }
        let message = answer_in(&text, &content_type, id)
            .ok_or_else(|| CallError::Failed("The app's answer couldn't be read.".to_owned()))?;
        if let Some(error) = message.get("error") {
            let text = error["message"]
                .as_str()
                .unwrap_or("The app refused the request.");
            return Err(CallError::Failed(super::super::client::truncate(text, 600)));
        }
        Ok(message["result"].clone())
    }

    async fn notify(&self, method: &str) {
        let body = json!({ "jsonrpc": "2.0", "method": method });
        let _ = self.request(&body).send().await;
    }
}

impl<'a> Session<'a> {
    async fn open(
        http: &'a Client,
        url: &'a str,
        token: &'a str,
    ) -> Result<Session<'a>, CallError> {
        let mut session = Session {
            http,
            url,
            token,
            id: None,
            next: 0,
        };
        let initialize = super::oauth::initialize_body();
        session
            .call("initialize", initialize["params"].clone())
            .await?;
        session.notify("notifications/initialized").await;
        Ok(session)
    }
}

/// Every tool the server offers, as it describes them.
pub async fn tools(http: &Client, url: &str, token: &str) -> Result<Vec<Value>, CallError> {
    let mut session = Session::open(http, url, token).await?;
    let mut tools = Vec::new();
    let mut cursor: Option<String> = None;
    for _ in 0..MAX_TOOL_PAGES {
        let params = match &cursor {
            Some(cursor) => json!({ "cursor": cursor }),
            None => json!({}),
        };
        let page = session.call("tools/list", params).await?;
        tools.extend(page["tools"].as_array().cloned().unwrap_or_default());
        cursor = page["nextCursor"].as_str().map(str::to_owned);
        if cursor.is_none() {
            break;
        }
    }
    Ok(tools)
}

/// Runs one tool and returns the server's result as it gave it.
pub async fn call(
    http: &Client,
    url: &str,
    token: &str,
    tool: &str,
    arguments: &Value,
) -> Result<Value, CallError> {
    let mut session = Session::open(http, url, token).await?;
    session
        .call(
            "tools/call",
            json!({ "name": tool, "arguments": arguments }),
        )
        .await
}
