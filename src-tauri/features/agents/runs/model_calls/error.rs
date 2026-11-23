use serde_json::Value;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ModelError {
    #[error("{code}: {detail}")]
    Setup { code: &'static str, detail: String },
    #[error("{message}")]
    Api {
        status: u16,
        message: String,
        retryable: bool,
        retry_after_ms: Option<u64>,
    },
    #[error("Cannot connect to the model provider: {0}")]
    Network(String),
    #[error("{0}")]
    Unsupported(String),
    #[error("{message}")]
    NoOutput { name: &'static str, message: String },
    #[error("{message}")]
    Retry {
        reason: RetryReason,
        message: String,
        errors: Vec<ModelError>,
    },
}

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

    pub fn is_retryable(&self) -> bool {
        match self {
            Self::Api { retryable, .. } => *retryable,
            Self::Network(_) => true,
            Self::Setup { .. }
            | Self::Unsupported(_)
            | Self::NoOutput { .. }
            | Self::Retry { .. } => false,
        }
    }
}

pub(crate) fn retryable_status(status: u16) -> bool {
    matches!(status, 408 | 409 | 429) || status >= 500
}

pub(crate) fn scrub(text: &str, secret: &str) -> String {
    let secret = secret.trim();
    if secret.len() < 8 {
        return text.to_owned();
    }
    text.replace(secret, "[redacted]")
}

pub(crate) fn scrub_value(value: &mut Value, secret: &str) {
    match value {
        Value::String(text) => *text = scrub(text, secret),
        Value::Array(items) => items.iter_mut().for_each(|item| scrub_value(item, secret)),
        Value::Object(fields) => fields
            .values_mut()
            .for_each(|field| scrub_value(field, secret)),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrubbing_removes_keys_but_not_short_values() {
        assert_eq!(
            scrub("bad key sk-12345678", "sk-12345678"),
            "bad key [redacted]"
        );
        assert_eq!(scrub("abc", "abc"), "abc");
    }

    #[test]
    fn scrubbing_reaches_every_string_in_a_value() {
        let mut error = serde_json::json!({ "message": "bad sk-12345678", "data": [{ "text": "sk-12345678!" }] });
        scrub_value(&mut error, "sk-12345678");
        assert_eq!(
            error,
            serde_json::json!({ "message": "bad [redacted]", "data": [{ "text": "[redacted]!" }] })
        );
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
