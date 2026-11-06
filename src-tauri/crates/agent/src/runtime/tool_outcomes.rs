//! What a tool call's result means for the run: continue, plan again, hand off, or stop.
use super::{
    js_json::JsValue,
    runtime_errors::{error_text, RuntimeError},
    text::{js_len, js_prefix, js_trim},
};

pub(crate) const EXECUTION_INSTRUCTIONS: &str = "Execution contract:
- Treat a concrete imperative request as work to perform now, not as a request for instructions or a proposal.
- Privately break multi-part requests into the necessary steps and continue until every requested action and deliverable is complete or a real blocker prevents progress.
- When creating or updating an artifact with generated content, compose the complete final content before the write. Check every explicit constraint—including title, format, count, length, and requested sections—and send the full result in the tool call. Never create a placeholder, outline, partial draft, or empty shell when the user requested finished content.
- Make every response count: when the next steps do not depend on each other (searching or reading several items, opening the next few pages, extracting from several tabs), call all of those tools in the one response. A request with many items fits the run only this way; one call per response runs out of turns halfway.
- A tool error means that call had no effect. Read it, correct the arguments or choose another tool, and continue. Calls reported as tool_not_attempted never ran; call them again if they are still needed.
- Do not ask the user to restate, plan, create subtasks, or say “finish” when the request already contains enough detail. Ask one focused clarification only when a missing choice would materially change the result.
- If any requested part cannot be completed, say exactly what remains incomplete and why.";

/// The model-turn limit a run has unless it says otherwise.
pub(crate) const DEFAULT_TURN_LIMIT: usize = 20;

fn status_text(result: &JsValue) -> Option<String> {
    result.get("status").map(JsValue::to_js_string)
}

fn is_object_like(output: &JsValue) -> bool {
    matches!(output, JsValue::Object(_) | JsValue::Array(_))
}

/// Why a returned result is not a confirmed effect, or "" when it is. `None` is no result at all.
pub(crate) fn unconfirmed_tool_result_reason(output: Option<&JsValue>) -> String {
    let Some(result) = output else {
        return "The requested action returned no confirmed result.".to_owned();
    };
    if !is_object_like(result) {
        return String::new();
    }
    let status = result.get("status");
    let is_status = |name: &str| status.and_then(JsValue::as_str) == Some(name);
    if is_status("failure") {
        let message = result.get("tool_error").and_then(|error| error.get("message")).and_then(JsValue::as_str);
        if let Some(message) = message.filter(|message| !js_trim(message).is_empty()) {
            return js_prefix(message, 500).to_owned();
        }
    }
    if is_status("uncertain") {
        return "The action may have happened, but its outcome could not be verified.".to_owned();
    }
    if matches!(status_text(result).as_deref(), Some("failure" | "device_required" | "user_intervention_required")) {
        return "The requested action has not completed.".to_owned();
    }
    if result.get("denied") == Some(&JsValue::Bool(true)) {
        return "The requested action was not approved.".to_owned();
    }
    if result.get("unavailable") == Some(&JsValue::Bool(true)) {
        return "The device required for this action was unavailable.".to_owned();
    }
    String::new()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ToolOutcome {
    Confirmed,
    /// The run hands off to the user: a screen Misty opens, or an app card they answer. The desktop
    /// continues the conversation once it is done.
    Handoff { reason: String },
    /// The call had no effect; the model sees why and plans again.
    Retry { reason: String },
    /// The run stops: the outcome needs the user, or the run lost its authority.
    Stop { reason: String },
}

impl ToolOutcome {
    pub(crate) fn kind(&self) -> &'static str {
        match self {
            Self::Confirmed => "confirmed",
            Self::Handoff { .. } => "handoff",
            Self::Retry { .. } => "retry",
            Self::Stop { .. } => "stop",
        }
    }
}

// device_offline: the computer the run works on stopped answering; the person asks again once Misty is open there.
const RUN_ENDING_CODES: [&str; 5] = ["authorization_or_state_changed", "agent_execution_time_limit", "agent_model_turn_limit", "permission_denied", "device_offline"];

fn handoff_default(status: &str) -> Option<&'static str> {
    match status {
        "screen_requested" => Some("Misty is opening a screen and will continue this conversation with it attached."),
        "waiting_for_user" => Some("Connect the app with the card above. Misty continues once it's connected."),
        "awaiting_approval" => Some("An action is waiting for your approval above. Misty continues after you decide."),
        // The agent asked structured questions; the conversation continues with the answers.
        "awaiting_answer" => Some("Answer the question above and Misty continues."),
        // Plan mode ends its turn with a plan for the user to run, edit or refine.
        "plan_proposed" => Some("Review the plan above. Run it, edit it, or keep planning."),
        _ => None,
    }
}

/// The user-facing message for a handoff result, or "" when the output is not one.
pub(crate) fn handoff_message(output: Option<&JsValue>) -> String {
    let Some(result) = output.filter(|output| is_object_like(output)) else {
        return String::new();
    };
    let Some(fallback) = status_text(result).as_deref().and_then(handoff_default) else {
        return String::new();
    };
    let screen = result.get("status").and_then(JsValue::as_str) == Some("screen_requested");
    let text = result.get(if screen { "message" } else { "user_message" }).and_then(JsValue::as_str);
    match text.filter(|text| !js_trim(text).is_empty()) {
        Some(text) => js_prefix(text, 300).to_owned(),
        None => fallback.to_owned(),
    }
}

/// The run lost its authority or budget, or its tool sequence already stopped.
pub(crate) fn ends_run(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.starts_with("tool_sequence_stopped") || RUN_ENDING_CODES.iter().any(|code| lower.contains(code))
}

pub(crate) struct OutcomeInput<'a> {
    pub(crate) success: bool,
    pub(crate) output: Option<&'a JsValue>,
    pub(crate) error: Option<&'a RuntimeError>,
    pub(crate) read_only: bool,
    pub(crate) rejected: bool,
}

/// Uncertain, denied, unavailable and waiting results are durable decisions for the user. Errors
/// Misty reports for a call it rejected, and any failed read, return to the model. A write whose
/// outcome is unknown stops the run so it is never repeated under a new call ID.
pub(crate) fn classify_tool_outcome(input: &OutcomeInput<'_>) -> ToolOutcome {
    if input.success {
        let handoff = handoff_message(input.output);
        if !handoff.is_empty() {
            return ToolOutcome::Handoff { reason: handoff };
        }
        let reason = unconfirmed_tool_result_reason(input.output);
        if reason.is_empty() {
            return ToolOutcome::Confirmed;
        }
        let failed = input.output.and_then(|output| output.get("status")).and_then(JsValue::as_str) == Some("failure");
        return if failed { ToolOutcome::Retry { reason } } else { ToolOutcome::Stop { reason } };
    }
    let message = input.error.map(error_text).unwrap_or_default();
    if !ends_run(&message) && (input.rejected || input.read_only) {
        return ToolOutcome::Retry { reason: message };
    }
    ToolOutcome::Stop { reason: message }
}

/// Keys sorted at every level. The TypeScript sorted with `localeCompare`, and this sorts by code
/// point: the text only has to be the same for the same input within one run.
fn stable_tool_value(value: &JsValue) -> JsValue {
    match value {
        JsValue::Array(items) => JsValue::Array(items.iter().map(stable_tool_value).collect()),
        JsValue::Object(fields) => {
            let mut sorted: Vec<_> = fields.iter().map(|(key, item)| (key.clone(), stable_tool_value(item))).collect();
            sorted.sort_by(|left, right| left.0.cmp(&right.0));
            JsValue::Object(sorted)
        }
        other => other.clone(),
    }
}

pub(crate) fn tool_failure_signature(tool_name: &str, input: &JsValue) -> String {
    format!("{tool_name}:{}", stable_tool_value(input).stringify())
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
pub(crate) struct ToolFailure {
    pub(crate) tool_name: String,
    pub(crate) error: String,
}

pub(crate) fn incomplete_tool_result_text(failures: &[ToolFailure]) -> String {
    let details = failures
        .iter()
        .take(3)
        .map(|failure| {
            let name = failure.tool_name.replace(['.', '_'], " ");
            let error = js_prefix(js_trim(&failure.error), 300);
            format!("{name}: {}", if error.is_empty() { "The action could not be completed." } else { error })
        })
        .collect::<Vec<_>>()
        .join("; ");
    format!("I couldn't fully complete that request. {}", if details.is_empty() { "A required action failed." } else { &details })
}

pub(crate) fn stopped_at_model_turn_limit(step_count: usize, finish_reason: &str, limit: usize) -> bool {
    step_count >= limit && finish_reason != "stop"
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct UnfinishedResult {
    pub(crate) code: &'static str,
    pub(crate) message: &'static str,
}

pub(crate) fn unfinished_model_result(aborted: bool, step_count: usize, finish_reason: &str, limit: usize) -> Option<UnfinishedResult> {
    // An aborted stream can resolve with the last completed step's finish reason. A normal return
    // (or earlier text) is not completion evidence.
    if aborted {
        return Some(UnfinishedResult { code: "agent_runtime_interrupted", message: "This run stopped before finishing. Review its completed work before starting another request." });
    }
    if stopped_at_model_turn_limit(step_count, finish_reason, limit) {
        return Some(UnfinishedResult { code: "agent_model_turn_limit", message: "This run reached its model-turn limit before finishing. Review its completed work before starting another request." });
    }
    if finish_reason == "stop" && step_count > 0 {
        return None;
    }
    if finish_reason == "length" {
        return Some(UnfinishedResult { code: "agent_response_incomplete", message: "The model reached its response limit before finishing. Review the partial result before continuing." });
    }
    Some(UnfinishedResult { code: "agent_response_incomplete", message: "The model did not finish this request. Review its completed work before starting another request." })
}

/// Whether a run that ended on an unrecognized finish reason still has its answer worth keeping: the
/// model wrote a whole answer and stopped (the provider named the stop oddly) and nothing failed.
/// The run still ends incomplete, since nobody confirmed it was done, but the answer is kept above
/// the reason instead of being replaced by "The model did not finish this request."
pub(crate) fn keeps_answer_after_odd_stop(unfinished_code: Option<&str>, finish_reason: &str, answer: &str, failures: usize) -> bool {
    unfinished_code == Some("agent_response_incomplete") && finish_reason != "length" && failures == 0 && js_len(js_trim(answer)) >= 40
}

/// The last step's text that has any.
pub(crate) fn final_text<S: AsRef<str>>(steps: &[Option<S>]) -> String {
    steps
        .iter()
        .rev()
        .filter_map(|step| step.as_ref())
        .map(|text| js_trim(text.as_ref()))
        .find(|text| !text.is_empty())
        .unwrap_or_default()
        .to_owned()
}

#[cfg(test)]
#[path = "tool_outcomes_tests.rs"]
mod tests;
