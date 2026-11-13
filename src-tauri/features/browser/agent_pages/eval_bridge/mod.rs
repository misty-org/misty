//! A debug-only bridge into a running Misty for the live acceptance specs
//! (`src/tests/acceptance/mistyClient.ts`). It runs scripts in a person's app
//! window (`/window-eval`) and follows or cancels a run (`/run-follow`,
//! `/run-cancel`), so the specs drive the app through its real paths.
//!
//! Start the app with `MISTY_BROWSER_EVAL_BRIDGE_PORT` and
//! `MISTY_BROWSER_EVAL_BRIDGE_TOKEN` set. The bridge listens on 127.0.0.1
//! only, answers only requests carrying the token, and is not compiled into
//! release builds.
use crate::browser::*;
use axum::{
    body::Bytes,
    extract::State as AxumState,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Router,
};
use serde::de::DeserializeOwned;
use std::sync::Arc;

mod grants;
mod window_eval;

#[derive(Clone)]
struct Bridge {
    app: AppHandle,
    token: Arc<String>,
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
    };
    tauri::async_runtime::spawn(async move {
        let router = Router::new()
            .route("/window-eval", post(window_eval::window_eval))
            .route("/run-follow", post(grants::run_follow))
            .route("/run-cancel", post(grants::run_cancel))
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

#[cfg(test)]
mod tests;
