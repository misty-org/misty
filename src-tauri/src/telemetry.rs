use std::{
    error::Error,
    fmt,
    sync::atomic::{AtomicBool, Ordering},
};

use posthog_rs::{
    CaptureExceptionOptions, ClientOptionsBuilder, ErrorTrackingOptionsBuilder, Event,
};
use serde_json::Value;

static ERROR_REPORTING_ENABLED: AtomicBool = AtomicBool::new(false);

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
        if !ERROR_REPORTING_ENABLED.load(Ordering::Relaxed) {
            return;
        }
        let safe = SanitizedError(redact_text(&error.to_string()));
        let options = CaptureExceptionOptions::new()
            .property("operation", operation.as_str())
            .unwrap_or_default()
            .property("runtime_layer", "rust")
            .unwrap_or_default()
            .property("app_version", env!("CARGO_PKG_VERSION"))
            .unwrap_or_default()
            .property("release_channel", release_channel())
            .unwrap_or_default();
        tauri::async_runtime::spawn(async move {
            let _ = posthog_rs::capture_exception_with(&safe, options).await;
        });
    }

    fn flush(&self) {
        tauri::async_runtime::block_on(posthog_rs::flush());
    }
}

#[derive(Debug)]
struct SanitizedError(String);
impl fmt::Display for SanitizedError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}
impl Error for SanitizedError {}

pub fn initialize() {
    if cfg!(debug_assertions) || cfg!(test) {
        posthog_rs::disable_global();
        return;
    }
    let token = option_env!("POSTHOG_PROJECT_TOKEN").unwrap_or("").trim();
    let host = option_env!("POSTHOG_HOST").unwrap_or("").trim();
    if token.is_empty() || host.is_empty() {
        posthog_rs::disable_global();
        return;
    }

    let error_tracking = match ErrorTrackingOptionsBuilder::default()
        .capture_stacktrace(true)
        .capture_panics(true)
        .build()
    {
        Ok(options) => options,
        Err(_) => return,
    };
    let mut builder = ClientOptionsBuilder::default();
    builder
        .api_key(token.to_owned())
        .host(host.to_owned())
        .is_server(false)
        .disable_geoip(true)
        .request_timeout_seconds(2)
        .shutdown_timeout_ms(2_000)
        .error_tracking(error_tracking);
    builder.before_send(|event| {
        if !ERROR_REPORTING_ENABLED.load(Ordering::Relaxed) {
            return None;
        }
        Some(sanitize_event(event))
    });
    if let Ok(options) = builder.build() {
        let _ = tauri::async_runtime::block_on(posthog_rs::init_global(options));
    }
}

#[tauri::command]
pub fn telemetry_set_error_reporting_enabled(enabled: bool) {
    ERROR_REPORTING_ENABLED.store(enabled, Ordering::Relaxed);
}

pub fn shutdown() {
    tauri::async_runtime::block_on(posthog_rs::shutdown());
}

fn sanitize_event(mut event: Event) -> Event {
    let properties = event.properties().clone();
    for (key, value) in properties {
        event.remove_prop(&key);
        let sanitized = if sensitive_key(&key) {
            Value::String("[REDACTED_USER_DATA]".to_owned())
        } else {
            redact_value(value)
        };
        let _ = event.insert_prop(key, sanitized);
    }
    let _ = event.insert_prop("runtime_layer", "rust");
    let _ = event.insert_prop("environment", "production");
    let _ = event.insert_prop("app_version", env!("CARGO_PKG_VERSION"));
    let _ = event.insert_prop("release_channel", release_channel());
    event
}

fn redact_value(value: Value) -> Value {
    match value {
        Value::String(value) => Value::String(redact_text(&value)),
        Value::Array(values) => Value::Array(values.into_iter().map(redact_value).collect()),
        Value::Object(values) => Value::Object(
            values
                .into_iter()
                .map(|(key, value)| {
                    let value = if sensitive_key(&key) {
                        Value::String("[REDACTED_USER_DATA]".to_owned())
                    } else {
                        redact_value(value)
                    };
                    (key, value)
                })
                .collect(),
        ),
        other => other,
    }
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

fn sensitive_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    [
        "authorization",
        "cookie",
        "password",
        "secret",
        "token",
        "email",
        "username",
        "display_name",
        "path",
        "filename",
        "folder",
        "query",
        "clipboard",
        "content",
        "body",
        "url",
        "request",
        "response",
    ]
    .iter()
    .any(|candidate| key.contains(candidate))
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
        assert!(posthog_rs::global_is_disabled());
    }
}
