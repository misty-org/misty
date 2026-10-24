//! The browser benchmark's way into Misty's own browser (debug builds only).
//!
//! `server/apps/agent-runtime/evals/odysseys` runs a real model against real
//! pages. With this bridge each task runs in a Misty tab, in the system
//! webview (WKWebView on macOS, WebView2 on Windows), through the same agent
//! path production uses: a native task lease, a grant for the tab, and
//! `browser_agent_execute` with its page layer, site checks and input rules.
//! Tabs use the browser's normal profile, so live tasks see what the person
//! signed in to in Misty.
//!
//! Start the app with `MISTY_BROWSER_EVAL_BRIDGE_PORT` and
//! `MISTY_BROWSER_EVAL_BRIDGE_TOKEN` set. The bridge listens on 127.0.0.1
//! only, answers only requests carrying the token, and is not compiled into
//! release builds.
use super::*;
use crate::infra::agents::workspace::{self, AgentWorkspaceState};
use axum::{
    body::Bytes,
    extract::State as AxumState,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Router,
};
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::sync::Arc;

mod grants;
mod pages;
mod processes;

mod open;
use open::*;
mod requests;
use requests::*;

const AGENT: &str = "browser-eval";
const ACCOUNT: &str = "browser-eval";
/// Every page tool the benchmark offers the model.
const CAPABILITIES: &[&str] = &[
    "browser.snapshot",
    "browser.find",
    "browser.extract",
    "browser.wait_for",
    "browser.steps",
    "browser.fill_form",
    "browser.skill",
    "browser.navigate",
    "browser.inspect",
    "browser.visual",
    // Native input, such as drawing on a canvas.
    "browser.interact",
];

struct Tab {
    id: String,
    task: String,
    renew: tauri::async_runtime::JoinHandle<()>,
}

#[derive(Clone)]
struct Bridge {
    app: AppHandle,
    token: Arc<String>,
    tabs: Arc<tokio::sync::Mutex<HashMap<String, Tab>>>,
}

#[derive(Deserialize)]
struct OpenTab {
    url: String,
    #[serde(default)]
    visible: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Execute {
    scope_id: String,
    operation: String,
    #[serde(default)]
    input: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Evaluate {
    scope_id: String,
    expression: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Scoped {
    scope_id: String,
}

/// Starts the bridge when the environment asks for it; a no-op otherwise.
pub(crate) fn start_if_requested(app: &AppHandle) {
    let (Ok(port), Ok(token)) = (
        std::env::var("MISTY_BROWSER_EVAL_BRIDGE_PORT"),
        std::env::var("MISTY_BROWSER_EVAL_BRIDGE_TOKEN"),
    ) else {
        return;
    };
    let Ok(port) = port.parse::<u16>() else {
        eprintln!("BROWSER EVAL BRIDGE: MISTY_BROWSER_EVAL_BRIDGE_PORT must be a port number");
        return;
    };
    if token.len() < 24 {
        eprintln!("BROWSER EVAL BRIDGE: the token must be at least 24 characters");
        return;
    }
    let bridge = Bridge {
        app: app.clone(),
        token: Arc::new(token),
        tabs: Arc::default(),
    };
    tauri::async_runtime::spawn(async move {
        let router = Router::new()
            .route("/tab", post(open_tab))
            .route("/execute", post(execute))
            .route("/evaluate", post(evaluate))
            .route("/close", post(close))
            .route("/pages", post(pages::pages))
            .route("/processes", post(processes::processes))
            .route("/capture", post(pages::capture))
            .route("/run-grants", post(grants::run_grants))
            .with_state(bridge);
        match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
            Ok(listener) => {
                println!("BROWSER EVAL BRIDGE: listening on 127.0.0.1:{port}");
                let _ = axum::serve(listener, router).await;
            }
            Err(error) => eprintln!("BROWSER EVAL BRIDGE: {error}"),
        }
    });
}

fn authorized(bridge: &Bridge, headers: &HeaderMap) -> bool {
    let supplied = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or("");
    token_matches(&bridge.token, supplied)
}

/// Compares in time that depends only on the expected token's length.
fn token_matches(expected: &str, supplied: &str) -> bool {
    let (expected, supplied) = (expected.as_bytes(), supplied.as_bytes());
    let mut difference = u8::from(supplied.len() != expected.len());
    for (index, byte) in expected.iter().enumerate() {
        difference |= byte ^ supplied.get(index).copied().unwrap_or(0);
    }
    difference == 0
}

fn reply(result: Result<Value, String>) -> Response {
    let body = match result {
        Ok(value) => json!({ "ok": true, "result": value }),
        Err(error) => json!({ "ok": false, "error": error }),
    };
    (
        [(header::CONTENT_TYPE, "application/json")],
        body.to_string(),
    )
        .into_response()
}

/// The request body, once the caller has shown the token.
#[allow(clippy::result_large_err)] // The error is the reply itself.
fn request<T: DeserializeOwned>(
    bridge: &Bridge,
    headers: &HeaderMap,
    body: &Bytes,
) -> Result<T, Response> {
    if !authorized(bridge, headers) {
        return Err(denied());
    }
    serde_json::from_slice(body)
        .map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()).into_response())
}

fn denied() -> Response {
    (StatusCode::UNAUTHORIZED, "unauthorized").into_response()
}

fn main_view(app: &AppHandle) -> Result<Webview, String> {
    crate::infra::space_windows::primary_webview(app)
        .ok_or_else(|| "No Space window is open.".to_owned())
}

fn lease(task: &str, renew: bool) -> Value {
    json!({"accountId": ACCOUNT, "agentId": AGENT, "spaceId": "", "taskId": task, "renew": renew})
}

#[cfg(test)]
mod tests;
