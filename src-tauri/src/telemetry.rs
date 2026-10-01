use serde_json::json;
use std::{
    collections::HashMap,
    error::Error,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, OnceLock,
    },
    time::{Duration, Instant},
};

const BATCH_WINDOW: Duration = Duration::from_secs(5);
const BATCH_LIMIT: usize = 20;
const DUPLICATE_SUPPRESSION: Duration = Duration::from_secs(600);

static ERROR_REPORTING_ENABLED: AtomicBool = AtomicBool::new(false);
static REPORTER: OnceLock<mpsc::SyncSender<Message>> = OnceLock::new();
enum Message {
    Error {
        value: String,
        operation: &'static str,
        handled: bool,
    },
    Flush(mpsc::SyncSender<()>),
    Stop(mpsc::SyncSender<()>),
}
#[derive(Clone, Copy, Debug)]
pub enum SafeOperation {
    ApplicationStartup,
    BackgroundTask,
    Unknown,
}
impl SafeOperation {
    fn as_str(self) -> &'static str {
        match self {
            Self::ApplicationStartup => "application_startup",
            Self::BackgroundTask => "background_task",
            Self::Unknown => "unknown",
        }
    }
}
pub trait TelemetryReporter {
    fn capture_error(&self, error: &(dyn Error + 'static), operation: SafeOperation);
    fn flush(&self);
}
pub struct PostHogTelemetryReporter;
impl TelemetryReporter for PostHogTelemetryReporter {
    fn capture_error(&self, error: &(dyn Error + 'static), operation: SafeOperation) {
        report(&error.to_string(), operation, true);
    }
    fn flush(&self) {
        drain(false);
    }
}
fn report(value: &str, operation: SafeOperation, handled: bool) {
    if !ERROR_REPORTING_ENABLED.load(Ordering::Relaxed) {
        return;
    }
    if let Some(sender) = REPORTER.get() {
        let value = redact_text(value).chars().take(2048).collect();
        let _ = sender.try_send(Message::Error {
            value,
            operation: operation.as_str(),
            handled,
        });
    }
}
/// Error reporting needs one bounded HTTP queue, not a second client runtime
/// with feature flags, symbolication and object-file parsers in the desktop host.
pub fn initialize() {
    if cfg!(debug_assertions) || cfg!(test) || REPORTER.get().is_some() {
        return;
    }
    let token = option_env!("POSTHOG_PROJECT_TOKEN").unwrap_or("").trim();
    let host = option_env!("POSTHOG_HOST").unwrap_or("").trim();
    if token.is_empty() || host.is_empty() {
        return;
    }
    let Ok(endpoint) = url::Url::parse(host).and_then(|url| url.join("/batch/")) else {
        return;
    };
    let (sender, receiver) = mpsc::sync_channel(8);
    if REPORTER.set(sender).is_err() {
        return;
    }
    let token = token.to_owned();
    let _ = std::thread::Builder::new().name("misty-error-reporter".into()).spawn(move || {
        let Ok(client) = reqwest::blocking::Client::builder().timeout(Duration::from_secs(2)).build() else { return; };
        // A random process identity cannot associate reports with an account.
        let distinct_id = uuid::Uuid::new_v4().to_string();
        // Errors are coalesced into one batch per window, and the same error
        // from the same operation is reported once per suppression period, so
        // a failing loop cannot turn into one request per occurrence.
        let mut pending: Vec<serde_json::Value> = Vec::new();
        let mut window_started: Option<Instant> = None;
        let mut recent: HashMap<(String, &'static str), Instant> = HashMap::new();
        let send = |events: &mut Vec<serde_json::Value>| {
            if events.is_empty() { return; }
            let payload = json!({ "api_key":token, "batch":std::mem::take(events) });
            let _ = client.post(endpoint.clone()).json(&payload).send();
        };
        loop {
            let message = match window_started {
                Some(started) => {
                    let remaining = BATCH_WINDOW.saturating_sub(started.elapsed());
                    match receiver.recv_timeout(remaining) {
                        Ok(message) => message,
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            send(&mut pending);
                            window_started = None;
                            continue;
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                }
                None => match receiver.recv() { Ok(message) => message, Err(_) => break },
            };
            match message {
                Message::Error { value, operation, handled } => {
                    if !ERROR_REPORTING_ENABLED.load(Ordering::Relaxed) { continue; }
                    let now = Instant::now();
                    recent.retain(|_, at| now.duration_since(*at) < DUPLICATE_SUPPRESSION);
                    let key = (value.clone(), operation);
                    if recent.contains_key(&key) || recent.len() >= 256 { continue; }
                    recent.insert(key, now);
                    pending.push(json!({
                        "event":"$exception", "timestamp":chrono::Utc::now().to_rfc3339(),
                        "properties":{ "distinct_id":distinct_id, "$process_person_profile":false,
                            "$geoip_disable":true, "runtime_layer":"rust", "environment":"production",
                            "app_version":env!("CARGO_PKG_VERSION"), "release_channel":release_channel(),
                            "operation":operation, "$exception_list":[{"type":"MistyError", "value":value,
                                "mechanism":{"type":"generic", "handled":handled}}] }
                    }));
                    // A panic may end the process before the window closes.
                    if pending.len() >= BATCH_LIMIT || !handled {
                        send(&mut pending);
                        window_started = None;
                    } else if window_started.is_none() {
                        window_started = Some(now);
                    }
                }
                Message::Flush(done) => { send(&mut pending); window_started = None; let _ = done.send(()); }
                Message::Stop(done) => { send(&mut pending); let _ = done.send(()); break; }
            }
        }
        send(&mut pending);
    });
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let value = info
            .payload()
            .downcast_ref::<String>()
            .map(String::as_str)
            .or_else(|| info.payload().downcast_ref::<&str>().copied())
            .unwrap_or("Native task panicked.");
        report(value, SafeOperation::Unknown, false);
        previous(info);
    }));
}
#[tauri::command]
pub fn telemetry_set_error_reporting_enabled(enabled: bool) {
    ERROR_REPORTING_ENABLED.store(enabled, Ordering::Relaxed);
}
fn drain(stop: bool) {
    if let Some(sender) = REPORTER.get() {
        let (done, receiver) = mpsc::sync_channel(1);
        let message = if stop {
            Message::Stop(done)
        } else {
            Message::Flush(done)
        };
        if sender.try_send(message).is_ok() {
            let _ = receiver.recv_timeout(Duration::from_secs(2));
        }
    }
}
pub fn shutdown() {
    drain(true);
}

pub fn redact_text(value: &str) -> String {
    value
        .split_whitespace()
        .map(|token| {
            let lower = token.to_ascii_lowercase();
            if token.contains("/Users/")
                || token.contains("/home/")
                || token.contains("\\Users\\")
                || token.starts_with("/var/")
                || token.starts_with("/tmp/")
            {
                "[REDACTED_PATH]".to_owned()
            } else if token.contains('@') {
                "[REDACTED_USER_DATA]".to_owned()
            } else if lower.starts_with("http://") || lower.starts_with("https://") {
                "[REDACTED_REQUEST]".to_owned()
            } else if token.len() >= 20
                && token
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || "-_=".contains(character))
            {
                "[REDACTED_TOKEN]".to_owned()
            } else {
                token.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn release_channel() -> &'static str {
    option_env!("MISTY_RELEASE_CHANNEL").unwrap_or("production")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_paths_tokens_emails_and_urls() {
        let redacted = redact_text("failed /Users/alice/private.txt abcdefghijklmnopqrstuvwxyz alice@example.com https://example.com?q=secret");
        assert!(!redacted.contains("alice"));
        assert!(!redacted.contains("private.txt"));
        assert!(!redacted.contains("abcdefghijklmnopqrstuvwxyz"));
        assert!(!redacted.contains("example.com"));
    }

    #[test]
    fn tests_never_enable_remote_posthog() {
        initialize();
        assert!(REPORTER.get().is_none());
    }
}
