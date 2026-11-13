// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

//! Codex windows, read through the person's own Codex CLI: `codex app-server` answers
//! `account/rateLimits/read` from its own sign-in, and sends `account/rateLimits/updated` during
//! runs. Misty never sees the sign-in.
//!
//! The protocol's snapshot (camelCase, v2):
//!
//! ```json
//! { "rateLimits": { "limitId": "codex", "limitName": null, "planType": "pro",
//!     "primary":   { "usedPercent": 8,  "windowDurationMins": 300,   "resetsAt": 1790014520 },
//!     "secondary": { "usedPercent": 71, "windowDurationMins": 10080, "resetsAt": 1790183600 },
//!     "credits": { "hasCredits": true, "unlimited": false, "balance": "12.50" } },
//!   "rateLimitsByLimitId": { "codex": { … } } }
//! ```
//!
//! The older `token_count` events of `codex exec` carry the same windows in snake_case
//! (`used_percent`, `window_minutes`, `resets_in_seconds`); both are read.

use std::future::Future;
use std::pin::Pin;
use std::process::Stdio;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use super::{
    clamp_percent, timestamp_ms, title_case, Credits, LimitWindow, KIND_OTHER, KIND_SESSION,
    KIND_WEEKLY, SESSION_WINDOW_SECONDS, WEEKLY_WINDOW_SECONDS,
};

/// The whole exchange (start, handshake, read) gives up after this long.
const READ_TIMEOUT: Duration = Duration::from_secs(20);
/// The main bucket's id; other buckets get their id in front of their windows'.
const MAIN_LIMIT_ID: &str = "codex";

pub(crate) type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum CodexFailure {
    NotInstalled,
    /// The CLI has no ChatGPT sign-in (none, or an API key, which has no plan limits).
    SignedOut,
    Offline,
    Error(String),
}

/// Where the `account/rateLimits/read` result comes from; tests answer without a CLI.
pub(crate) trait CodexSource: Send + Sync {
    fn read_rate_limits(&self) -> BoxFuture<'_, Result<Value, CodexFailure>>;
}

/// The person's own `codex app-server`, started for one read and stopped after it.
pub(crate) struct CodexAppServer;

impl CodexSource for CodexAppServer {
    fn read_rate_limits(&self) -> BoxFuture<'_, Result<Value, CodexFailure>> {
        Box::pin(read_through_app_server())
    }
}

fn command_for(program: &std::path::Path) -> tokio::process::Command {
    #[cfg(windows)]
    {
        let wrapper = program
            .extension()
            .and_then(|ending| ending.to_str())
            .is_some_and(|ending| {
                ending.eq_ignore_ascii_case("cmd") || ending.eq_ignore_ascii_case("bat")
            });
        if wrapper {
            let mut command = tokio::process::Command::new("cmd");
            command.arg("/c").arg(program);
            return command;
        }
    }
    tokio::process::Command::new(program)
}

async fn read_through_app_server() -> Result<Value, CodexFailure> {
    let program =
        crate::engine_config::support::find_program("codex").ok_or(CodexFailure::NotInstalled)?;
    let mut command = command_for(&program);
    command
        .arg("app-server")
        .envs(crate::engine_config::support::child_env())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    crate::engine_config::support::hide_console_tokio(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| CodexFailure::Error(format!("Codex could not be started: {error}")))?;
    let pid = child.id();
    let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
        return Err(CodexFailure::Error("Codex has no input or output.".into()));
    };
    let outcome = tokio::time::timeout(READ_TIMEOUT, converse(stdin, stdout)).await;
    if let Some(pid) = pid {
        crate::engine_config::support::kill_process_group(pid);
    }
    let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
    match outcome {
        Ok(result) => result,
        Err(_) => Err(CodexFailure::Error("Codex didn't answer in time.".into())),
    }
}

async fn converse(
    mut stdin: tokio::process::ChildStdin,
    stdout: tokio::process::ChildStdout,
) -> Result<Value, CodexFailure> {
    let mut lines = BufReader::new(stdout).lines();
    write(
        &mut stdin,
        line(json!({
            "id": 1,
            "method": "initialize",
            "params": {
                "clientInfo": { "name": "misty", "title": "Misty", "version": env!("CARGO_PKG_VERSION") },
                "capabilities": null
            }
        })),
    )
    .await?;
    answer(&mut lines, 1).await?;
    write(&mut stdin, line(json!({ "method": "initialized" }))).await?;
    write(
        &mut stdin,
        line(json!({ "id": 2, "method": "account/rateLimits/read" })),
    )
    .await?;
    answer(&mut lines, 2).await
}

fn line(message: Value) -> Vec<u8> {
    let mut text = message.to_string();
    text.push('\n');
    text.into_bytes()
}

async fn write(stdin: &mut tokio::process::ChildStdin, bytes: Vec<u8>) -> Result<(), CodexFailure> {
    let stopped = |_| CodexFailure::Error("Codex stopped before answering.".into());
    stdin.write_all(&bytes).await.map_err(stopped)?;
    stdin.flush().await.map_err(stopped)
}

/// The result of request `id`, skipping notifications on the way.
async fn answer(
    lines: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    id: u64,
) -> Result<Value, CodexFailure> {
    loop {
        let line = lines
            .next_line()
            .await
            .map_err(|_| CodexFailure::Error("Codex stopped before answering.".into()))?
            .ok_or_else(|| CodexFailure::Error("Codex stopped before answering.".into()))?;
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if message.get("method").is_some() || message.get("id").and_then(Value::as_u64) != Some(id)
        {
            continue;
        }
        if let Some(error) = message.get("error") {
            return Err(classify_error(error));
        }
        return Ok(message.get("result").cloned().unwrap_or(Value::Null));
    }
}

/// A JSON-RPC error as a failure. Only a short, secret-free reason is kept.
pub(crate) fn classify_error(error: &Value) -> CodexFailure {
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let lower = message.to_ascii_lowercase();
    let signed_out = [
        "auth",
        "login",
        "logged in",
        "sign in",
        "api key",
        "chatgpt account",
    ];
    if signed_out.iter().any(|needle| lower.contains(needle)) {
        return CodexFailure::SignedOut;
    }
    let offline = [
        "network",
        "connect",
        "timed out",
        "timeout",
        "dns",
        "offline",
    ];
    if offline.iter().any(|needle| lower.contains(needle)) {
        return CodexFailure::Offline;
    }
    let short: String = message.chars().take(120).collect();
    CodexFailure::Error(if short.is_empty() {
        "Codex couldn't read the limits.".into()
    } else {
        short
    })
}

pub(crate) struct CodexLimits {
    pub plan: Option<String>,
    pub windows: Vec<LimitWindow>,
    pub credits: Option<Credits>,
}

/// An `account/rateLimits/read` result. `None` when it is not an object with a snapshot.
pub(crate) fn parse_read(result: &Value, now_ms: i64) -> Option<CodexLimits> {
    let main = result.get("rateLimits").filter(|v| v.is_object())?;
    let mut limits = parse_snapshot(main, None, now_ms);
    let main_id = field(main, &["limitId", "limit_id"])
        .and_then(Value::as_str)
        .unwrap_or(MAIN_LIMIT_ID);
    if let Some(buckets) = result.get("rateLimitsByLimitId").and_then(Value::as_object) {
        let mut ids: Vec<&String> = buckets.keys().collect();
        ids.sort();
        for id in ids {
            if id == main_id || id == MAIN_LIMIT_ID {
                continue;
            }
            let bucket = &buckets[id];
            if !bucket.is_object() {
                continue;
            }
            let other = parse_snapshot(bucket, Some(id), now_ms);
            limits.windows.extend(other.windows);
        }
    }
    Some(limits)
}

/// An `account/rateLimits/updated` params object, a bare snapshot, or a `token_count` event's
/// `rate_limits`. `None` when nothing in it is a window or a plan.
pub(crate) fn parse_update(params: &Value, now_ms: i64) -> Option<CodexLimits> {
    let snapshot = params
        .get("rateLimits")
        .or_else(|| params.get("rate_limits"))
        .unwrap_or(params);
    if !snapshot.is_object() {
        return None;
    }
    let bucket = field(snapshot, &["limitId", "limit_id"])
        .and_then(Value::as_str)
        .filter(|id| *id != MAIN_LIMIT_ID);
    let limits = parse_snapshot(snapshot, bucket, now_ms);
    if limits.windows.is_empty() && limits.plan.is_none() && limits.credits.is_none() {
        return None;
    }
    Some(limits)
}

fn parse_snapshot(snapshot: &Value, bucket: Option<&str>, now_ms: i64) -> CodexLimits {
    let plan = field(snapshot, &["planType", "plan_type"])
        .and_then(Value::as_str)
        .and_then(plan_label);
    let name = field(snapshot, &["limitName", "limit_name"])
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(str::to_string)
        .or_else(|| bucket.map(str::to_string));
    let mut windows: Vec<LimitWindow> = Vec::new();
    for slot in ["primary", "secondary"] {
        let Some(value) = snapshot.get(slot).filter(|v| v.is_object()) else {
            continue;
        };
        let Some(mut window) = window(slot, value, now_ms) else {
            continue;
        };
        if let Some(bucket) = bucket {
            window.id = format!("{bucket}:{}", window.id);
            window.label = name.clone();
        }
        // Mirrors TokenTracker (MIT): first window of a class wins.
        if windows.iter().any(|w| w.id == window.id) {
            continue;
        }
        windows.push(window);
    }
    windows.sort_by_key(|w| kind_rank(&w.kind));
    let credits = snapshot
        .get("credits")
        .filter(|c| c.is_object())
        .map(|c| Credits {
            has_credits: field(c, &["hasCredits", "has_credits"])
                .and_then(Value::as_bool)
                .unwrap_or(false),
            unlimited: c.get("unlimited").and_then(Value::as_bool).unwrap_or(false),
            balance: c
                .get("balance")
                .and_then(|b| match b {
                    Value::String(text) => Some(text.trim().to_string()),
                    Value::Number(n) => Some(n.to_string()),
                    _ => None,
                })
                .filter(|b| !b.is_empty()),
        });
    CodexLimits {
        plan,
        windows,
        credits,
    }
}

fn field<'a>(value: &'a Value, names: &[&str]) -> Option<&'a Value> {
    names
        .iter()
        .find_map(|name| value.get(*name))
        .filter(|v| !v.is_null())
}

/// `plus` → "Plus", `free` → "Free" (free plans only carry a weekly window, so the label is
/// kept rather than hidden).
pub(crate) fn plan_label(plan_type: &str) -> Option<String> {
    title_case(plan_type)
}

// Mirrors TokenTracker (MIT): classify by the window's length (5 h session, weekly), never by
// slot: free plans get their only (weekly) window in `primary`. Unknown lengths are kept as
// `other` instead of being guessed.
fn window(slot: &str, value: &Value, now_ms: i64) -> Option<LimitWindow> {
    let used_percent = clamp_percent(field(value, &["usedPercent", "used_percent"])?)?;
    let seconds = field(value, &["windowDurationMins", "window_minutes"])
        .and_then(Value::as_f64)
        .map(|minutes| minutes * 60.0)
        .or_else(|| field(value, &["limit_window_seconds"]).and_then(Value::as_f64))
        .filter(|s| s.is_finite() && *s > 0.0)
        .map(|s| s as i64);
    let (id, kind) = match seconds {
        Some(SESSION_WINDOW_SECONDS) => ("session".to_string(), KIND_SESSION),
        Some(WEEKLY_WINDOW_SECONDS) => ("weekly".to_string(), KIND_WEEKLY),
        Some(other) => (format!("other:{other}"), KIND_OTHER),
        None => (format!("other:{slot}"), KIND_OTHER),
    };
    Some(LimitWindow {
        id,
        kind: kind.to_string(),
        label: None,
        used_percent,
        window_seconds: seconds,
        resets_at: reset_ms(value, now_ms),
        status: None,
    })
}

/// `resetsAt` is epoch seconds; fall back to a count of seconds from now.
fn reset_ms(value: &Value, now_ms: i64) -> Option<i64> {
    if let Some(at) = field(value, &["resetsAt", "resets_at", "reset_at"]).and_then(timestamp_ms) {
        return Some(at);
    }
    let after = field(value, &["resets_in_seconds", "reset_after_seconds"])
        .and_then(Value::as_f64)
        .filter(|s| s.is_finite() && *s >= 0.0)?;
    // Cap absurd values (a year) and never overflow the clock.
    Some(now_ms.saturating_add((after.min(31_536_000.0) * 1000.0) as i64))
}

pub(crate) fn kind_rank(kind: &str) -> u8 {
    match kind {
        KIND_SESSION => 0,
        KIND_WEEKLY => 1,
        _ => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_790_000_000_000;

    #[test]
    fn classifies_session_and_weekly_by_length_not_slot() {
        let result = json!({
            "rateLimits": {
                "limitId": "codex", "limitName": null, "planType": "pro",
                "primary": { "usedPercent": 71, "windowDurationMins": 10080, "resetsAt": 1_790_183_600 },
                "secondary": { "usedPercent": 8.5, "windowDurationMins": 300, "resetsAt": 1_790_014_520 },
                "credits": { "hasCredits": true, "unlimited": false, "balance": "12.50" }
            },
            "rateLimitsByLimitId": null,
            "rateLimitResetCredits": null
        });
        let limits = parse_read(&result, NOW).expect("parses");
        assert_eq!(limits.plan.as_deref(), Some("Pro"));
        let session = &limits.windows[0];
        assert_eq!(
            (session.id.as_str(), session.kind.as_str()),
            ("session", "session")
        );
        assert_eq!(session.used_percent, 8.5);
        assert_eq!(session.window_seconds, Some(18_000));
        assert_eq!(session.resets_at, Some(1_790_014_520_000));
        let weekly = &limits.windows[1];
        assert_eq!(
            (weekly.id.as_str(), weekly.kind.as_str()),
            ("weekly", "weekly")
        );
        assert_eq!(weekly.used_percent, 71.0);
        assert_eq!(
            limits.credits,
            Some(Credits {
                has_credits: true,
                unlimited: false,
                balance: Some("12.50".into())
            })
        );
    }

    #[test]
    fn weekly_only_in_primary_is_weekly_and_other_buckets_are_labelled() {
        let result = json!({
            "rateLimits": {
                "planType": "free",
                "primary": { "usedPercent": 46, "windowDurationMins": 10080, "resetsAt": null },
                "secondary": null
            },
            "rateLimitsByLimitId": {
                "codex": { "primary": { "usedPercent": 46, "windowDurationMins": 10080 } },
                "codex_spark": { "limitName": "Spark",
                                 "primary": { "usedPercent": 3, "windowDurationMins": 300 } }
            }
        });
        let limits = parse_read(&result, NOW).expect("parses");
        let ids: Vec<&str> = limits.windows.iter().map(|w| w.id.as_str()).collect();
        assert_eq!(ids, ["weekly", "codex_spark:session"]);
        assert_eq!(limits.windows[1].label.as_deref(), Some("Spark"));
        assert_eq!(limits.windows[0].resets_at, None);
        assert_eq!(limits.plan.as_deref(), Some("Free"));
    }

    #[test]
    fn unknown_lengths_and_missing_snapshot() {
        let result = json!({ "rateLimits": {
            "primary": { "usedPercent": 5, "windowDurationMins": 1440 },
            "secondary": { "usedPercent": 6 }
        }});
        let limits = parse_read(&result, NOW).expect("parses");
        let ids: Vec<&str> = limits.windows.iter().map(|w| w.id.as_str()).collect();
        assert_eq!(ids, ["other:86400", "other:secondary"]);
        assert!(parse_read(&json!(null), NOW).is_none());
        assert!(parse_read(&json!({ "rateLimits": null }), NOW).is_none());
    }

    #[test]
    fn reads_updates_in_both_spellings() {
        let notification = json!({ "rateLimits": {
            "limitId": "codex", "planType": null,
            "primary": { "usedPercent": 12, "windowDurationMins": 300, "resetsAt": 1_790_000_100 },
            "secondary": null
        }});
        let update = parse_update(&notification, NOW).expect("parses");
        assert_eq!(update.windows[0].id, "session");
        assert_eq!(update.plan, None);
        let token_count = json!({ "rate_limits": {
            "primary": { "used_percent": 40.0, "window_minutes": 10080, "resets_in_seconds": 60 }
        }});
        let legacy = parse_update(&token_count, NOW).expect("parses");
        assert_eq!(legacy.windows[0].id, "weekly");
        assert_eq!(legacy.windows[0].resets_at, Some(NOW + 60_000));
        assert!(parse_update(&json!({ "rate_limits": { "primary": null } }), NOW).is_none());
    }

    #[test]
    fn errors_map_to_a_status_without_detail() {
        assert_eq!(
            classify_error(
                &json!({ "code": -32600, "message": "ChatGPT authentication required to read rate limits" })
            ),
            CodexFailure::SignedOut
        );
        assert_eq!(
            classify_error(&json!({ "message": "error sending request: connection refused" })),
            CodexFailure::Offline
        );
        assert_eq!(
            classify_error(&json!({ "message": "" })),
            CodexFailure::Error("Codex couldn't read the limits.".into())
        );
    }
}
