//! The authoritative outcome of one tool call, through whatever waits it needs.
use futures_util::future::BoxFuture;

use super::{
    js_json::JsValue,
    runtime_errors::RuntimeError,
    tool_transport::{object, string},
};

/// Transport compatibility envelope. Absence of a result is not confirmation. The fields stay
/// loosely typed because a malformed envelope has to be told apart from an absent one.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct ToolExecutionResponse {
    pub(crate) result: Option<JsValue>,
    pub(crate) device_wait: Option<JsValue>,
    pub(crate) intervention_wait: Option<JsValue>,
    pub(crate) tool_error: Option<JsValue>,
}

impl ToolExecutionResponse {
    pub(crate) fn result(value: JsValue) -> Self {
        Self { result: Some(value), ..Self::default() }
    }

    pub(crate) fn tool_error(code: &str, message: &str) -> Self {
        Self { tool_error: Some(object([("code", string(code)), ("message", string(message))])), ..Self::default() }
    }

    /// Reads the envelope the server sent, refusing anything but an object.
    pub(crate) fn from_json(value: &JsValue) -> Result<Self, RuntimeError> {
        if !value.is_object() {
            return Err(RuntimeError::error("invalid_tool_outcome"));
        }
        let field = |name: &str| value.get(name).cloned();
        Ok(Self {
            result: field("result"),
            device_wait: field("device_wait"),
            intervention_wait: field("intervention_wait"),
            tool_error: field("tool_error"),
        })
    }
}

// Transport anomalies where the call may have run despite the failure.
const UNVERIFIED_FAILURE_CODES: [&str; 2] = ["invalid_tool_outcome", "missing_tool_result"];

/// Misty reported this call as failed without effect: it rejected the call before execution or
/// recorded a definite failure. Unknown write outcomes arrive as an `uncertain` result instead,
/// never as this error.
pub(crate) fn rejected_without_effect(error: &RuntimeError) -> bool {
    matches!(error, RuntimeError::ToolRejected { code, .. } if !UNVERIFIED_FAILURE_CODES.contains(&code.as_str()))
}

/// Engine-independent outcomes for the authoritative transport response.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum HarnessToolOutcome {
    Success(JsValue),
    Failure { code: String, message: String },
    DeviceRequired,
    InterventionWait { id: String },
    UserInterventionRequired(JsValue),
    Uncertain(JsValue),
}

fn truthy(value: Option<&JsValue>) -> bool {
    match value {
        None | Some(JsValue::Null) => false,
        Some(JsValue::Bool(value)) => *value,
        Some(JsValue::Number(value)) => *value != 0.0 && !value.is_nan(),
        Some(JsValue::String(text)) => !text.is_empty(),
        Some(JsValue::Array(_) | JsValue::Object(_)) => true,
    }
}

const WAIT_ACTIONS: [&str; 5] = ["sign_in", "account_confirmation", "challenge", "open_target", "review"];

pub(crate) fn normalize_tool_outcome(response: &ToolExecutionResponse) -> Result<HarnessToolOutcome, RuntimeError> {
    let error = truthy(response.tool_error.as_ref());
    let wait = truthy(response.intervention_wait.as_ref());
    let alternatives = usize::from(response.result.is_some())
        + usize::from(response.device_wait == Some(JsValue::Bool(true)))
        + usize::from(error)
        + usize::from(wait);
    if alternatives == 0 {
        return Err(RuntimeError::error("missing_tool_result: execution was not confirmed"));
    }
    if alternatives != 1 {
        return Err(RuntimeError::error("invalid_tool_outcome: contradictory execution outcomes"));
    }
    if error {
        let failure = response.tool_error.as_ref();
        let text = |name: &str| failure.and_then(|failure| failure.get(name)).and_then(JsValue::as_str);
        return match (text("code").filter(|code| !code.is_empty()), text("message")) {
            (Some(code), Some(message)) => Ok(HarnessToolOutcome::Failure { code: code.to_owned(), message: message.to_owned() }),
            _ => Err(RuntimeError::error("invalid_tool_outcome: malformed failure")),
        };
    }
    if wait {
        let wait = response.intervention_wait.as_ref();
        let text = |name: &str| wait.and_then(|wait| wait.get(name)).and_then(JsValue::as_str);
        let action = text("action").is_some_and(|action| WAIT_ACTIONS.contains(&action));
        return match (text("id").filter(|id| !id.is_empty()), text("reason"), action) {
            (Some(id), Some(_), true) => Ok(HarnessToolOutcome::InterventionWait { id: id.to_owned() }),
            _ => Err(RuntimeError::error("invalid_tool_outcome: malformed intervention wait")),
        };
    }
    if truthy(response.device_wait.as_ref()) {
        return Ok(HarnessToolOutcome::DeviceRequired);
    }
    let result = response.result.clone().unwrap_or(JsValue::Null);
    Ok(match result.get("status").and_then(JsValue::as_str) {
        Some("uncertain") => HarnessToolOutcome::Uncertain(result),
        Some("user_intervention_required") => HarnessToolOutcome::UserInterventionRequired(result),
        _ => HarnessToolOutcome::Success(result),
    })
}

/// The call being continued. Each wait says whether it was met.
pub(crate) trait ToolContinuation: Send {
    fn request(&mut self, attempt: u32) -> BoxFuture<'_, Result<ToolExecutionResponse, RuntimeError>>;
    fn device(&mut self, attempt: u32) -> BoxFuture<'_, Result<bool, RuntimeError>>;
    /// `None` when nothing here can wait for a person.
    fn intervention(&mut self, _attempt: u32) -> Option<BoxFuture<'_, Result<bool, RuntimeError>>> {
        None
    }
}

/// The run store owns durable waits; this loop never invents a new effect identity.
pub(crate) async fn continue_tool_execution(continuation: &mut dyn ToolContinuation) -> Result<JsValue, RuntimeError> {
    for attempt in 0..64 {
        let response = continuation.request(attempt).await?;
        match normalize_tool_outcome(&response)? {
            HarnessToolOutcome::Failure { code, message } => return Err(RuntimeError::ToolRejected { code, message }),
            HarnessToolOutcome::InterventionWait { id } => {
                let Some(wait) = continuation.intervention(attempt) else {
                    return Err(RuntimeError::error("intervention_adapter_unavailable"));
                };
                if !wait.await? {
                    return Ok(object([
                        ("denied", JsValue::Bool(true)),
                        ("reason", string("user_action_declined_or_expired")),
                        ("waitId", string(id)),
                    ]));
                }
            }
            HarnessToolOutcome::DeviceRequired => {
                if !continuation.device(attempt).await? {
                    return Ok(object([("unavailable", JsValue::Bool(true)), ("reason", string("device_unavailable"))]));
                }
            }
            // The outer agent stops on unresolved intervention and uncertainty. Neither
            // may turn into a new planning attempt for the same consequential action.
            HarnessToolOutcome::UserInterventionRequired(result)
            | HarnessToolOutcome::Uncertain(result)
            | HarnessToolOutcome::Success(result) => return Ok(result),
        }
    }
    Err(RuntimeError::error("tool_wait_limit: too many resumptions without completion"))
}

/// Runs a tool this device answers at once, with the same outcomes as a call through Misty's
/// gateway: a failure is rejected without effect, so the model may correct it or carry on.
pub(crate) async fn settle_device_call(response: ToolExecutionResponse) -> Result<JsValue, RuntimeError> {
    struct Settled(ToolExecutionResponse);
    impl ToolContinuation for Settled {
        fn request(&mut self, _attempt: u32) -> BoxFuture<'_, Result<ToolExecutionResponse, RuntimeError>> {
            let response = self.0.clone();
            Box::pin(async move { Ok(response) })
        }
        fn device(&mut self, _attempt: u32) -> BoxFuture<'_, Result<bool, RuntimeError>> {
            Box::pin(async { Ok(false) })
        }
    }
    continue_tool_execution(&mut Settled(response)).await
}

#[cfg(test)]
#[path = "tool_execution_tests.rs"]
mod tests;
