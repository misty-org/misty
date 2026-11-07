//! Runtime failures: which retry, which stop a run, and what the person is told.
use std::{fmt, sync::LazyLock};

use regex::Regex;

use super::{
    js_regex::js_regex,
    tool_errors::classify_tool_transport_error,
    text::{js_prefix, js_trim},
};

/// `ControlPlaneError` from `control-plane-error.ts`.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ControlPlaneError {
    pub(crate) status: u16,
    pub(crate) message: String,
    pub(crate) code: String,
    pub(crate) transient: bool,
}

impl ControlPlaneError {
    pub(crate) fn new(status: u16, message: impl Into<String>, code: Option<&str>) -> Self {
        let code = code.unwrap_or("control_plane_error").to_owned();
        let transient = code != "usage_limit_reached" && (status == 408 || status == 429 || status >= 500);
        Self { status, message: message.into(), code, transient }
    }
}

/// What a TypeScript `catch` saw: a known error class, or anything else by its diagnostic fields.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum RuntimeError {
    ControlPlane(ControlPlaneError),
    /// `ToolRejectedError` from `tool-execution.ts`: Misty reported the call failed without effect.
    ToolRejected { code: String, message: String },
    Other {
        name: String,
        message: String,
        status: Option<u16>,
        cause: Option<Box<RuntimeError>>,
    },
}

impl RuntimeError {
    /// `new Error(message)`.
    pub(crate) fn error(message: impl Into<String>) -> Self {
        Self::named("Error", message)
    }

    /// An error thrown as a bare string.
    pub(crate) fn text(message: impl Into<String>) -> Self {
        Self::named("", message)
    }

    pub(crate) fn named(name: impl Into<String>, message: impl Into<String>) -> Self {
        Self::Other { name: name.into(), message: message.into(), status: None, cause: None }
    }

    pub(crate) fn with_status(self, next: u16) -> Self {
        match self {
            Self::Other { name, message, cause, .. } => Self::Other { name, message, status: Some(next), cause },
            other => other,
        }
    }

    pub(crate) fn with_cause(self, next: RuntimeError) -> Self {
        match self {
            Self::Other { name, message, status, .. } => Self::Other { name, message, status, cause: Some(Box::new(next)) },
            other => other,
        }
    }

    pub(crate) fn name(&self) -> &str {
        match self {
            Self::ControlPlane(_) => "ControlPlaneError",
            Self::ToolRejected { .. } => "ToolRejectedError",
            Self::Other { name, .. } => name,
        }
    }

    pub(crate) fn status(&self) -> Option<u16> {
        match self {
            Self::ControlPlane(error) => Some(error.status),
            Self::ToolRejected { .. } => None,
            Self::Other { status, .. } => *status,
        }
    }

    fn cause(&self) -> Option<&RuntimeError> {
        match self {
            Self::Other { cause, .. } => cause.as_deref(),
            _ => None,
        }
    }
}

impl From<ControlPlaneError> for RuntimeError {
    fn from(error: ControlPlaneError) -> Self {
        Self::ControlPlane(error)
    }
}

impl fmt::Display for RuntimeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ControlPlane(error) => formatter.write_str(&error.message),
            Self::ToolRejected { code, message } => write!(formatter, "{code}: {message}"),
            Self::Other { message, .. } => formatter.write_str(message),
        }
    }
}

impl std::error::Error for RuntimeError {}

/// What the run's step does with a failure. Workflow's `FatalError` and `RetryableError` become two
/// answers, and an error nobody recognizes goes back up unchanged.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum StepFailure {
    Fatal(String),
    Retryable { message: String, retry_after_ms: u64 },
    Unrecognized(RuntimeError),
}

/// Refusals the run stops on with the reason the person can act on.
const REFUSALS: [&str; 4] = ["usage_limit_reached", "model_key_needed", "model_unsupported", "model_base_url_invalid"];

/// Step failures retry only for transient control-plane or transport errors.
pub(crate) fn rethrow_step_error(error: RuntimeError) -> StepFailure {
    if let RuntimeError::ControlPlane(failure) = &error {
        if failure.code == "agent_model_turn_limit" || failure.code == "agent_execution_time_limit" {
            return StepFailure::Fatal(failure.code.clone());
        }
        // Refusals keep their code, so the run fails with the reason the person
        // can act on rather than a generic authorization error.
        if REFUSALS.contains(&failure.code.as_str()) {
            return StepFailure::Fatal(failure.code.clone());
        }
        if failure.transient {
            return StepFailure::Retryable {
                message: "Misty's control plane is temporarily unavailable.".to_owned(),
                retry_after_ms: if failure.status == 429 { 5_000 } else { 1_000 },
            };
        }
        return StepFailure::Fatal("authorization_or_state_changed: Misty's authorization or run state changed.".to_owned());
    }
    let failure = classify_tool_transport_error(&error);
    if failure.transient {
        return StepFailure::Retryable { message: failure.message.to_owned(), retry_after_ms: failure.retry_after_ms };
    }
    if failure.recognized {
        return StepFailure::Fatal(failure.message.to_owned());
    }
    StepFailure::Unrecognized(error)
}

static SPACES: LazyLock<Regex> = LazyLock::new(|| js_regex(r"\s+", false));
static CODE_PREFIX: LazyLock<Regex> = LazyLock::new(|| js_regex(r"^[a-z0-9_]+:\s*", true));
static APP_ACTION_LIMIT: LazyLock<Regex> = LazyLock::new(|| js_regex(r"\bapp_action_limit_reached:[^\n]*", true));

/// A validation response the model can correct, without workflow internals.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct RecoverableToolError {
    pub(crate) code: String,
    pub(crate) message: String,
}

pub(crate) fn recoverable_tool_error(error: &RuntimeError) -> Option<RecoverableToolError> {
    let RuntimeError::ControlPlane(failure) = error else {
        return None;
    };
    if failure.code == "agent_model_turn_limit" || failure.code == "agent_execution_time_limit" {
        return None;
    }
    if ![400, 409, 422].contains(&failure.status) {
        return None;
    }
    let stripped = CODE_PREFIX.replace(&failure.message, "");
    Some(RecoverableToolError {
        code: if failure.code.is_empty() { "invalid_tool_input".to_owned() } else { failure.code.clone() },
        message: js_prefix(js_trim(&stripped), 500).to_owned(),
    })
}

/// A model provider failing on its side (a 5xx, or a rate limit) after the call's own retries.
/// The run waits it out between turns instead of failing: on October 21 a free endpoint's one
/// "Internal Server Error" ended a run 33 seconds in.
pub(crate) fn provider_outage(error: &RuntimeError) -> bool {
    let normalized = runtime_error_description(error, 0).to_lowercase();
    const WAITED_OUT: [&str; 6] = ["internal server error", "bad gateway", "service unavailable", "gateway timeout", "too many requests", "rate limit"];
    normalized.contains("gatewayinternalservererror")
        || normalized.contains("service temporarily unavailable")
        // A stream that went quiet through every retry: the endpoint hung.
        || normalized.contains("model_stream_stalled")
        || ((normalized.contains("dostreamstep") || normalized.contains("ai_apicallerror"))
            && WAITED_OUT.iter().any(|phrase| normalized.contains(phrase)))
}

/// A failure's stable code and the words the person sees.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ClassifiedError {
    pub(crate) code: &'static str,
    pub(crate) message: &'static str,
}

const fn classified(code: &'static str, message: &'static str) -> ClassifiedError {
    ClassifiedError { code, message }
}

pub(crate) fn classify_runtime_error(error: &RuntimeError) -> ClassifiedError {
    // Step failures may wrap the provider error in a cause. Inspect diagnostic fields, never raw
    // responses.
    let normalized = runtime_error_description(error, 0).to_lowercase();
    let has = |phrase: &str| normalized.contains(phrase);
    if has("agent_model_turn_limit") {
        return classified("agent_model_turn_limit", "This run reached its model-turn limit. Review its completed work before starting another request.");
    }
    if has("agent_execution_time_limit") {
        return classified("agent_execution_time_limit", "This run used its execution-time allowance. Review its completed work before starting another request.");
    }
    if has("model_key_needed") {
        return classified("model_key_needed", "Add a model key in Settings → Models.");
    }
    if has("model_unsupported") {
        return classified("model_unsupported", "The chosen model can't do this. Pick another in Settings → Models.");
    }
    if has("model_base_url_invalid") {
        return classified("model_base_url_invalid", "The model's base URL can't be used. Check it in Settings → Models.");
    }
    if has("timeout") || has("timed out") || has("aborted") {
        return classified("agent_runtime_timeout", "Misty timed out before completing this request.");
    }
    if has("usage_limit_reached") && has("too many agent tasks") {
        return classified("usage_limit_reached", "Too many agent tasks are running at once. Wait for one to finish, then try again.");
    }
    if has("usage_limit_reached") && has("starting agent tasks faster") {
        return classified("usage_limit_reached", "You're starting agent tasks faster than they can run. Wait a minute, then try again.");
    }
    if has("usage_limit_reached") {
        return classified("usage_limit_reached", "Misty paused here because a rate limit was reached. Try again in a moment.");
    }
    let revoked = matches!(error, RuntimeError::ControlPlane(failure) if !failure.transient);
    if revoked || has("authorization_or_state_changed") {
        return classified("authorization_or_state_changed", "Misty's authorization or run state changed.");
    }
    if has("positive credit balance is required") || has("insufficient_quota") {
        return classified(
            "model_provider_credit_exhausted",
            "The model provider says this key has no credit left. Add credit with the provider or use another key in Settings → Models.",
        );
    }
    if has("api key has been invalidated") || has("invalid api key") || has("incorrect api key") || has("invalid_api_key") {
        return classified("model_provider_key_invalid", "The model provider rejected the API key. Check the key in Settings → Models.");
    }
    // A provider's own 5xx after the step's retries (a free endpoint's "Internal Server Error").
    if provider_outage(error) {
        return classified("model_gateway_unavailable", "The model provider is temporarily unavailable. Please try again shortly.");
    }
    // The person sees a generic failure; the reason belongs in the runtime's log, or the failure
    // can never be found (a whole Odysseys run ended this way with nothing logged).
    let description = runtime_error_description(error, 0);
    let flat = SPACES.replace_all(&description, " ");
    super::logger::process_log(&format!("unclassified_failure {}", js_prefix(&flat, 1_500)));
    classified("agent_runtime_failed", "Misty could not complete this request.")
}

fn runtime_error_description(error: &RuntimeError, depth: usize) -> String {
    if depth >= 6 {
        return String::new();
    }
    let cause = error.cause().map_or_else(String::new, |cause| runtime_error_description(cause, depth + 1));
    format!("{} {} {cause}", error.name(), error)
}

/// `errorText`: an error's message. Every error here is an `Error` or a string in the TypeScript's
/// terms, so the `JSON.stringify` of a plain object has no counterpart.
pub(crate) fn error_text(error: &RuntimeError) -> String {
    error.to_string()
}

/// Public timeline text for a failed call; raw diagnostics stay private.
pub(crate) fn visible_error_message(error: &RuntimeError) -> String {
    let text = error_text(error);
    // A plan's monthly app-action limit keeps its code, so the app can tell the person.
    if let Some(limit) = APP_ACTION_LIMIT.find(&text) {
        return js_prefix(limit.as_str(), 500).to_owned();
    }
    let message = text.to_lowercase();
    let has = |phrase: &str| message.contains(phrase);
    let visible = if has("browser_webview_unavailable") {
        "The local browser view is unavailable. Reopen the browser view and retry the task."
    } else if has("desktop_accessibility_required") {
        "Allow the running Misty app in System Settings → Privacy & Security → Accessibility, then retry."
    } else if has("desktop_screen_recording_required") {
        "Allow the running Misty app in System Settings → Privacy & Security → Screen Recording, then retry."
    } else if has("invalid_tool_input") {
        "The tool arguments were invalid."
    } else if has("permission_denied") || has("authorization_or_state_changed") {
        "This run is no longer authorized to use that tool."
    } else if has("tool_unavailable") || has("unknown tool") {
        "That tool is not available for this run."
    } else if has("conflict") {
        "The item changed while Misty was working. Please retry."
    } else if has("rate_limited") || has("too many requests") {
        "Misty's tool service is busy. Please try again shortly."
    } else if has("timeout") || has("temporarily unavailable") {
        "Misty's tool service is temporarily unavailable."
    } else {
        "The tool could not complete this action."
    };
    visible.to_owned()
}

#[cfg(test)]
#[path = "runtime_errors_tests.rs"]
mod tests;
