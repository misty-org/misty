//! The browser benchmark's way into Misty's own browser (debug builds only).
//!
//! `server/apps/agent-runtime/evals/browser` runs a real model against real
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
use crate::infra::agent_workspace::{self, AgentWorkspaceState};
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

#[path = "browser_eval_bridge_dock.rs"]
mod dock;
#[path = "browser_eval_bridge_grants.rs"]
mod grants;
#[path = "browser_eval_bridge_pages.rs"]
mod pages;
#[path = "browser_eval_bridge_processes.rs"]
mod processes;

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
    // Native input (drawing on a canvas) for the dock check.
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
            .route("/dock", post(dock::dock))
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

async fn open_tab(
    AxumState(bridge): AxumState<Bridge>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    match request::<OpenTab>(&bridge, &headers, &body) {
        Ok(body) => reply(open(&bridge, body).await),
        Err(response) => response,
    }
}

async fn open(bridge: &Bridge, body: OpenTab) -> Result<Value, String> {
    let app = &bridge.app;
    let url = external_url(&body.url)?;
    let id = format!("eval-{}", uuid::Uuid::new_v4());
    let scope = format!("eval-scope-{}", uuid::Uuid::new_v4());
    let task = uuid::Uuid::new_v4().to_string();
    agent_workspace::agent_workspace_acquire(
        main_view(app)?,
        app.state::<AgentWorkspaceState>(),
        serde_json::from_value(lease(&task, false)).map_err(|e| e.to_string())?,
    )?;
    let created = async {
        browser_webview_create(
            main_view(app)?,
            app.clone(),
            app.state::<BrowserSessionState>(),
            serde_json::from_value(json!({
                "id": id, "scopeId": scope, "url": url.as_str(),
                "x": 0, "y": 64, "width": 1280, "height": 860,
            }))
            .map_err(|e| e.to_string())?,
        )
        .await?;
        agent_workspace::agent_workspace_bind_scope(
            main_view(app)?,
            app.clone(),
            app.state::<AgentWorkspaceState>(),
            task.clone(),
            scope.clone(),
            None,
        )?;
        browser_agent_grant_register(
            app.clone(),
            app.state::<BrowserSessionState>(),
            serde_json::from_value(json!({
                "id": id, "scopeId": scope, "grantId": grant(&scope), "agentId": AGENT,
                "capabilities": CAPABILITIES,
                "expiresAt": (Utc::now() + chrono::Duration::hours(2)).to_rfc3339(),
            }))
            .map_err(|e| e.to_string())?,
        )?;
        // Some sites (Google Docs and Sheets) wait until the page is on screen,
        // so a visible tab also brings Misty's window forward.
        if body.visible {
            let window = main_view(app)?.window();
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
        // Agents' own tabs are parked out of sight, still rendering, as in production.
        if !body.visible {
            browser_webview_hide(
                main_view(app)?,
                app.clone(),
                serde_json::from_value(json!({ "id": id, "keepLive": true }))
                    .map_err(|e| e.to_string())?,
            )?;
        }
        Ok::<(), String>(())
    }
    .await;
    if let Err(error) = created {
        let _ = close_browser_webview(
            app.clone(),
            app.state::<BrowserSessionState>(),
            serde_json::from_value(json!({ "id": id })).map_err(|e| e.to_string())?,
        );
        if let Ok(view) = main_view(app) {
            let _ = agent_workspace::agent_workspace_release(
                view,
                app.state::<AgentWorkspaceState>(),
                task.clone(),
            );
        }
        return Err(error);
    }
    // The native lease lasts 30 seconds; keep it while the tab is open.
    let renew_app = app.clone();
    let renew_task = task.clone();
    let renew = tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(10)).await;
            let Ok(view) = main_view(&renew_app) else {
                return;
            };
            let Ok(request) = serde_json::from_value(lease(&renew_task, true)) else {
                return;
            };
            if agent_workspace::agent_workspace_acquire(
                view,
                renew_app.state::<AgentWorkspaceState>(),
                request,
            )
            .is_err()
            {
                return;
            }
        }
    });
    bridge
        .tabs
        .lock()
        .await
        .insert(scope.clone(), Tab { id, task, renew });
    Ok(json!({ "scopeId": scope }))
}

fn grant(scope: &str) -> String {
    format!("eval-grant-{scope}")
}

async fn execute(
    AxumState(bridge): AxumState<Bridge>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let body = match request::<Execute>(&bridge, &headers, &body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let task = match bridge.tabs.lock().await.get(&body.scope_id) {
        Some(tab) => tab.task.clone(),
        None => return reply(Err("The benchmark tab is not open.".into())),
    };
    if !CAPABILITIES.contains(&body.operation.as_str()) {
        return reply(Err(format!("{} is not a benchmark tool.", body.operation)));
    }
    let mut input = if body.input.is_object() {
        body.input
    } else {
        json!({})
    };
    input["__mistyTaskId"] = json!(task);
    let call = serde_json::from_value(json!({
        "scopeId": body.scope_id, "grantId": grant(&body.scope_id), "agentId": AGENT,
        "operation": body.operation, "input": input,
    }));
    reply(match call {
        Ok(call) => {
            browser_agent_execute(
                bridge.app.clone(),
                bridge.app.state::<BrowserSessionState>(),
                call,
            )
            .await
        }
        Err(error) => Err(error.to_string()),
    })
}

/// Reads the page's own state for the benchmark's checks: an expression in
/// the page, never shown to the model.
async fn evaluate(
    AxumState(bridge): AxumState<Bridge>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let body = match request::<Evaluate>(&bridge, &headers, &body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let id = match bridge.tabs.lock().await.get(&body.scope_id) {
        Some(tab) => tab.id.clone(),
        None => return reply(Err("The benchmark tab is not open.".into())),
    };
    let view = match webview_label(&id)
        .ok()
        .and_then(|label| bridge.app.get_webview(&label))
    {
        Some(view) => view,
        None => return reply(Err("The benchmark tab is not running.".into())),
    };
    let script = format!(
        "(() => {{ try {{ return ({}); }} catch {{ return null; }} }})()",
        body.expression
    );
    // A page that navigates mid-evaluation never answers it; ask again.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while tokio::time::Instant::now() < deadline {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let sender = Mutex::new(Some(sender));
        if let Err(error) = view.eval_with_callback(script.clone(), move |value| {
            if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) {
                let _ = sender.send(value);
            }
        }) {
            return reply(Err(error.to_string()));
        }
        if let Ok(Ok(raw)) = tokio::time::timeout(Duration::from_secs(2), receiver).await {
            return reply(serde_json::from_str(&raw).map_err(|error| error.to_string()));
        }
    }
    reply(Err("The page did not answer.".into()))
}

async fn close(AxumState(bridge): AxumState<Bridge>, headers: HeaderMap, body: Bytes) -> Response {
    let body = match request::<Scoped>(&bridge, &headers, &body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let Some(tab) = bridge.tabs.lock().await.remove(&body.scope_id) else {
        return reply(Ok(json!({})));
    };
    tab.renew.abort();
    let app = &bridge.app;
    let closed = serde_json::from_value(json!({ "id": tab.id }))
        .map_err(|e| e.to_string())
        .and_then(|close| {
            close_browser_webview(app.clone(), app.state::<BrowserSessionState>(), close)
        });
    if let Ok(view) = main_view(app) {
        let _ = agent_workspace::agent_workspace_release(
            view,
            app.state::<AgentWorkspaceState>(),
            tab.task,
        );
    }
    reply(closed.map(|_| json!({})))
}

#[cfg(test)]
mod tests {
    use super::token_matches;

    #[test]
    fn only_the_exact_token_opens_the_bridge() {
        let token = "a-random-token-of-24-chars";
        assert!(token_matches(token, token));
        for wrong in [
            "",
            "a-random-token-of-24-char",
            "a-random-token-of-24-charsX",
            "A-random-token-of-24-chars",
        ] {
            assert!(!token_matches(token, wrong), "{wrong:?} was accepted");
        }
    }
}
