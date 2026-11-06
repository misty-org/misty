//! How a device call fails: the status and body each `/v1/device/*` route answered with.
use std::fmt;

use serde_json::{json, Value};

use crate::sdk::ModelError;

/// What the renderer sees of a failed call: enough to tell a missing key from a provider failure.
#[derive(Clone, Debug, PartialEq)]
pub struct DeviceCallFailure {
    pub status: u16,
    pub body: Value,
}

/// Why a call failed, before it becomes a [`DeviceCallFailure`].
#[derive(Debug)]
pub enum CallError {
    /// `ModelCallError`: the call itself was refused, with its status and code.
    Call { status: u16, code: &'static str, message: String },
    Model(ModelError),
    /// A limit like `AbortSignal.timeout` ran out.
    TimedOut,
    /// What a `TypeError` was in the TypeScript: reported as a provider failure, with no status.
    Unreadable(&'static str),
}

impl CallError {
    pub(crate) fn call(status: u16, code: &'static str, message: &str) -> Self {
        Self::Call { status, code, message: message.to_owned() }
    }

    pub(crate) fn invalid() -> Self {
        Self::call(400, "invalid_model_call", "Invalid model call")
    }
}

impl From<ModelError> for CallError {
    fn from(error: ModelError) -> Self {
        Self::Model(error)
    }
}

impl fmt::Display for CallError {
    fn fmt(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Self::Call { code, message, .. } => write!(formatter, "{code}: {message}"),
            Self::Model(error) => write!(formatter, "{error}"),
            Self::TimedOut => formatter.write_str("The operation timed out."),
            Self::Unreadable(what) => formatter.write_str(what),
        }
    }
}

/// `modelCallFailure`. Provider failures keep only a status: response bodies may echo credentials.
pub fn model_call_failure(error: &CallError) -> DeviceCallFailure {
    let (upstream, setup) = match error {
        CallError::Call { status, code, message } => {
            return DeviceCallFailure { status: *status, body: json!({ "code": code, "message": message }) };
        }
        CallError::Model(ModelError::Setup { code, detail }) => (0, Some((*code, detail.as_str()))),
        // A failure inside a stream reads as status 200, which isn't a provider status.
        CallError::Model(ModelError::Api { status, .. }) if (400..600).contains(status) => (*status, None),
        _ => (0, None),
    };
    if let Some((code, detail)) = setup {
        let status = if code == "model_key_needed" { 409 } else { 400 };
        return DeviceCallFailure { status, body: json!({ "code": code, "message": detail }) };
    }
    DeviceCallFailure {
        status: 502,
        body: json!({
            "code": "model_call_failed",
            "message": "The model provider could not complete the request.",
            "upstream_status": upstream,
        }),
    }
}

/// What the route did with a finished call: failures from 500 up go to the log, never with a key,
/// because every `ModelError` is scrubbed where it's made.
pub(super) fn answered(path: &str, result: Result<Value, CallError>) -> Result<Value, DeviceCallFailure> {
    result.map_err(|error| {
        let failure = model_call_failure(&error);
        if failure.status >= 500 {
            eprintln!("[misty-agent-runtime] device call /v1/device/{path} failed {error}");
        }
        failure
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_failures_keep_only_a_status() {
        let failure = model_call_failure(&CallError::Model(ModelError::Api {
            status: 401,
            message: "secret echoed by provider".into(),
            retryable: false,
            retry_after_ms: None,
        }));
        assert_eq!(
            failure,
            DeviceCallFailure {
                status: 502,
                body: json!({ "code": "model_call_failed", "message": "The model provider could not complete the request.", "upstream_status": 401 }),
            }
        );
    }

    #[test]
    fn a_status_that_is_not_a_failure_reads_as_none() {
        let failure = model_call_failure(&CallError::Model(ModelError::Api {
            status: 200,
            message: "in the stream".into(),
            retryable: false,
            retry_after_ms: None,
        }));
        assert_eq!(failure.body["upstream_status"], 0);
        assert_eq!(model_call_failure(&CallError::TimedOut).status, 502);
    }

    #[test]
    fn setup_failures_say_what_to_do() {
        let needed = ModelError::Setup { code: "model_key_needed", detail: "Add a model key in Settings → Models.".into() };
        assert_eq!(
            model_call_failure(&CallError::Model(needed)),
            DeviceCallFailure { status: 409, body: json!({ "code": "model_key_needed", "message": "Add a model key in Settings → Models." }) }
        );
        let other = ModelError::Setup { code: "model_unsupported", detail: "No.".into() };
        assert_eq!(model_call_failure(&CallError::Model(other)).status, 400);
    }

    #[test]
    fn refused_calls_keep_their_status_and_code() {
        assert_eq!(
            model_call_failure(&CallError::call(422, "no_speech", "No speech was detected.")),
            DeviceCallFailure { status: 422, body: json!({ "code": "no_speech", "message": "No speech was detected." }) }
        );
    }
}
