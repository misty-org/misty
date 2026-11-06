//! Why a model call failed. A message here never carries a key: everything that holds one goes
//! through [`scrub`] first, so errors are safe for logs, run history and the person.
use serde_json::Value;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ModelError {
    /// The model can't run as asked, so retrying won't help.
    #[error("{code}: {detail}")]
    Setup { code: &'static str, detail: String },
    /// The provider answered with a failure.
    #[error("{message}")]
    Api {
        status: u16,
        message: String,
        retryable: bool,
        /// How long the provider asked callers to wait, from `retry-after`.
        retry_after_ms: Option<u64>,
    },
    /// The request never got an answer.
    #[error("Cannot connect to the model provider: {0}")]
    Network(String),
    /// Something the model call needs isn't supported by this provider.
    #[error("{0}")]
    Unsupported(String),
    /// The call worked but gave nothing usable, such as an answer that isn't the JSON asked for.
    /// `name` is the SDK's error name.
    #[error("{message}")]
    NoOutput { name: &'static str, message: String },
    /// Every try failed. `errors` holds each failure, the last one last.
    #[error("{message}")]
    Retry {
        reason: RetryReason,
        message: String,
        errors: Vec<ModelError>,
    },
}

/// Why trying again stopped.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RetryReason {
    MaxRetriesExceeded,
    ErrorNotRetryable,
}

impl ModelError {
    pub(crate) fn key_needed() -> Self {
        Self::Setup {
            code: "model_key_needed",
            detail: "Add a model key in Settings → Models.".into(),
        }
    }

    pub(crate) fn unsupported_model(detail: &str) -> Self {
        Self::Setup {
            code: "model_unsupported",
            detail: detail.into(),
        }
    }

    pub(crate) fn bad_base_url(detail: &str) -> Self {
        Self::Setup {
            code: "model_base_url_invalid",
            detail: detail.into(),
        }
    }

    /// Whether trying the same call again could work.
    pub fn is_retryable(&self) -> bool {
        match self {
            Self::Api { retryable, .. } => *retryable,
            Self::Network(_) => true,
            Self::Setup { .. } | Self::Unsupported(_) | Self::NoOutput { .. } | Self::Retry { .. } => false,
        }
    }
}

/// Whether a provider's status means a retry could work: timeouts, conflicts, rate limits and
/// server errors.
pub(crate) fn retryable_status(status: u16) -> bool {
    matches!(status, 408 | 409 | 429) || status >= 500
}

/// Removes a key from text a provider or the network layer may have echoed it in. Short values
/// are left alone, because they could match ordinary words.
pub(crate) fn scrub(text: &str, secret: &str) -> String {
    let secret = secret.trim();
    if secret.len() < 8 {
        return text.to_owned();
    }
    text.replace(secret, "[redacted]")
}

/// Removes a key from every string in an error a provider sent, as `scrub` does for text.
pub(crate) fn scrub_value(value: &mut Value, secret: &str) {
    match value {
        Value::String(text) => *text = scrub(text, secret),
        Value::Array(items) => items.iter_mut().for_each(|item| scrub_value(item, secret)),
        Value::Object(fields) => fields.values_mut().for_each(|field| scrub_value(field, secret)),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrubbing_removes_keys_but_not_short_values() {
        assert_eq!(scrub("bad key sk-12345678", "sk-12345678"), "bad key [redacted]");
        assert_eq!(scrub("abc", "abc"), "abc");
    }

    #[test]
    fn scrubbing_reaches_every_string_in_a_value() {
        let mut error = serde_json::json!({ "message": "bad sk-12345678", "data": [{ "text": "sk-12345678!" }] });
        scrub_value(&mut error, "sk-12345678");
        assert_eq!(error, serde_json::json!({ "message": "bad [redacted]", "data": [{ "text": "[redacted]!" }] }));
    }

    #[test]
    fn only_temporary_statuses_retry() {
        for status in [408, 409, 429, 500, 503] {
            assert!(retryable_status(status), "{status}");
        }
        for status in [400, 401, 403, 404] {
            assert!(!retryable_status(status), "{status}");
        }
    }
}
