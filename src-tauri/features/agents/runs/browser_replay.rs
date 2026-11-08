//! Replays a workflow's saved browser actions before any model call. Each saved step names its control by locator; the device finds it on the
//! current page. Calls run through the same gateway as the model's: authorized, journaled and
//! approval-gated. The first step the page no longer matches hands the task to the agent.
use super::{
    js_json::{text_or_empty, JsValue},
    runtime_errors::RuntimeError,
    text::{js_len, js_prefix},
    tool_outcomes::{classify_tool_outcome, handoff_message, OutcomeInput, ToolOutcome},
    tool_transport::{object, string, CheckpointState, HarnessCheckpoint, ToolTransport},
};

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ReplayCall {
    pub(crate) tool: String,
    pub(crate) args: JsValue,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct BrowserReplay {
    pub(crate) scope_id: String,
    pub(crate) start_url: Option<String>,
    pub(crate) calls: Vec<ReplayCall>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ReplayOutcome {
    Completed { text: String, actions: usize },
    /// The page no longer matched; the agent continues from here.
    Diverged { note: String, actions: usize },
    /// The person must act (an approval card); the run hands off.
    Handoff { text: String },
    /// An action's outcome is unknown; the run must stop, never retry.
    Stopped { text: String },
}

const REPLAY_TOOLS: [&str; 4] = ["browser.navigate", "browser.steps", "browser.skill", "browser.wait_for"];
const MAX_CALLS: usize = 100;

/// The context's replay, when it is well formed. Saved arguments are always an object, so an array
/// the TypeScript's looser check would let through counts as malformed here.
pub(crate) fn valid_replay(value: &JsValue) -> Option<BrowserReplay> {
    let scope_id = value.get("scope_id")?.as_str().filter(|scope| js_len(scope) >= 8)?;
    let calls = value.get("calls")?.as_array()?;
    if calls.is_empty() || calls.len() > MAX_CALLS {
        return None;
    }
    let calls = calls
        .iter()
        .map(|call| {
            let tool = call.get("tool")?.as_str().filter(|tool| REPLAY_TOOLS.contains(tool))?;
            let args = call.get("args").filter(|args| args.is_object())?;
            Some(ReplayCall { tool: tool.to_owned(), args: args.clone() })
        })
        .collect::<Option<Vec<_>>>()?;
    Some(BrowserReplay {
        scope_id: scope_id.to_owned(),
        start_url: value.get("start_url").and_then(JsValue::as_str).filter(|url| !url.is_empty()).map(str::to_owned),
        calls,
    })
}

/// `value ?? ...`: a null reads as nothing there.
fn present(value: Option<&JsValue>) -> Option<&JsValue> {
    value.filter(|value| !matches!(value, JsValue::Null))
}

/// Why a call's result means its step did not happen as recorded, or "".
fn mismatch(tool: &str, args: &JsValue, output: Option<&JsValue>) -> String {
    let empty = JsValue::Object(Vec::new());
    let result = output.filter(|output| !matches!(output, JsValue::Null)).unwrap_or(&empty);
    if result.get("status").and_then(JsValue::as_str) == Some("failure") {
        let message = result.get("tool_error").and_then(|error| error.get("message"));
        return present(message)
            .or(present(result.get("reason")))
            .map_or_else(|| "The step was refused.".to_owned(), JsValue::to_js_string);
    }
    match tool {
        "browser.steps" => {
            let wanted = args.get("steps").and_then(JsValue::as_array).map_or(0, <[JsValue]>::len);
            if result.get("completed") == Some(&JsValue::Number(wanted as f64)) {
                return String::new();
            }
            let failed = result
                .get("steps")
                .and_then(JsValue::as_array)
                .and_then(|steps| steps.iter().find(|step| step.get("ok") != Some(&JsValue::Bool(true))));
            present(failed.and_then(|step| step.get("error")))
                .or(present(result.get("stopped")))
                .map_or_else(|| "Not every step ran.".to_owned(), JsValue::to_js_string)
        }
        "browser.skill" => {
            if result.get("ok") == Some(&JsValue::Bool(true)) {
                String::new()
            } else {
                "The skill did not finish.".to_owned()
            }
        }
        "browser.wait_for" => {
            if result.get("met") == Some(&JsValue::Bool(true)) {
                return String::new();
            }
            let wanted = present(args.get("text")).or(present(args.get("textGone"))).or(present(args.get("urlIncludes")));
            format!("“{}” did not show up.", text_or_empty(wanted))
        }
        _ => String::new(),
    }
}

fn replay_output(tool: &str, success: bool) -> JsValue {
    object([("tool", string(tool)), ("success", JsValue::Bool(success)), ("replay", JsValue::Bool(true))])
}

fn progress(id: &str, state: CheckpointState, phase: String, progress: u32) -> HarnessCheckpoint {
    HarnessCheckpoint { node_id: format!("tool:{id}"), state, phase, progress, input: None, output: None, error_message: None }
}

/// One call with its checkpoints. Only the first checkpoint's failure ends the replay outright: one
/// after the call counts as the call having failed.
async fn call(deps: &dyn ToolTransport, id: &str, name: &str, input: &JsValue) -> Result<Result<Option<JsValue>, RuntimeError>, RuntimeError> {
    let started = HarnessCheckpoint {
        input: Some(input.clone()),
        ..progress(id, CheckpointState::Running, format!("using_{}", name.replace('.', "_")), 30)
    };
    deps.checkpoint(started).await?;
    let result = match deps.run(id, name, input).await {
        Ok(output) => {
            let finished = HarnessCheckpoint {
                output: Some(replay_output(name, true)),
                ..progress(id, CheckpointState::Completed, "working".to_owned(), 50)
            };
            deps.checkpoint(finished).await.map(|()| output)
        }
        Err(error) => Err(error),
    };
    if result.is_err() {
        let failed = HarnessCheckpoint {
            output: Some(replay_output(name, false)),
            ..progress(id, CheckpointState::Failed, "tool_failed".to_owned(), 40)
        };
        let _ = deps.checkpoint(failed).await;
    }
    Ok(result)
}

pub(crate) async fn run_browser_replay(
    replay: &BrowserReplay,
    deps: &dyn ToolTransport,
    available: impl Fn(&str) -> bool,
) -> Result<ReplayOutcome, RuntimeError> {
    let scope_id = string(&replay.scope_id);
    let mut calls = replay.calls.clone();
    if let Some(url) = &replay.start_url {
        if calls.first().map(|call| call.tool.as_str()) != Some("browser.navigate") {
            calls.insert(0, ReplayCall { tool: "browser.navigate".to_owned(), args: object([("url", string(url))]) });
        }
    }
    if !calls.iter().all(|call| available(&call.tool)) || !available("browser.snapshot") {
        return Ok(ReplayOutcome::Diverged { note: String::new(), actions: 0 });
    }
    let total = calls.len();
    let mut actions = 0;
    for (index, recorded) in calls.iter().enumerate() {
        let id = format!("replay-{}", index + 1);
        let mut input = recorded.args.with_field("scopeId", scope_id.clone());
        if recorded.tool == "browser.steps" || recorded.tool == "browser.skill" {
            // Steps act on the page as it is now: read it first for its documentId.
            let look = object([("scopeId", scope_id.clone()), ("maxChars", JsValue::Number(2000.0))]);
            let snapshot = call(deps, &format!("{id}-snapshot"), "browser.snapshot", &look).await?;
            let document = snapshot.ok().flatten().and_then(|output| output.get("documentId").filter(|id| id.as_str().is_some()).cloned());
            let Some(document) = document else {
                return Ok(diverged(index, total, actions, "The page could not be read."));
            };
            input = input.with_field("documentId", document).with_field("includeSnapshot", JsValue::Bool(false));
        }
        let result = call(deps, &id, &recorded.tool, &input).await?;
        let output = result.as_ref().ok().and_then(Option::as_ref);
        let outcome = classify_tool_outcome(&OutcomeInput {
            success: result.is_ok(),
            output,
            error: result.as_ref().err(),
            read_only: recorded.tool == "browser.wait_for",
            rejected: false,
        });
        let reason = match outcome {
            ToolOutcome::Handoff { reason } => {
                let message = handoff_message(output);
                return Ok(ReplayOutcome::Handoff { text: if message.is_empty() { reason } else { message } });
            }
            ToolOutcome::Stop { reason } => return Ok(ReplayOutcome::Stopped { text: reason }),
            ToolOutcome::Retry { reason } => reason,
            ToolOutcome::Confirmed => mismatch(&recorded.tool, &input, output),
        };
        if !reason.is_empty() {
            return Ok(diverged(index, total, actions, &reason));
        }
        actions += 1;
    }
    Ok(ReplayOutcome::Completed {
        text: format!("Ran this workflow's saved browser steps ({actions} actions); every one matched the page as recorded."),
        actions,
    })
}

fn diverged(index: usize, total: usize, actions: usize, reason: &str) -> ReplayOutcome {
    ReplayOutcome::Diverged {
        actions,
        note: format!(
            "[Saved replay] Misty replayed {index} of {total} saved browser actions of this workflow, then stopped at action {}: {} The browser is in that state now. Take a snapshot and continue the task from here; do not redo actions that already ran.",
            index + 1,
            js_prefix(reason, 500),
        ),
    }
}

#[cfg(test)]
#[path = "browser_replay_tests.rs"]
mod tests;
