//! Follows every tool call across model turns. A confirmed call continues the response. A call that
//! had no effect pauses the rest of the response so the model plans again from its error. A write
//! repeated after the same rejection, or an outcome the user must resolve, stops the run.
use std::{
    collections::{HashMap, HashSet},
    future::Future,
    sync::{Arc, Mutex, MutexGuard, PoisonError},
};

use super::{
    browser_reinspection::{browser_reinspection_tool, requires_browser_reinspection},
    js_json::JsValue,
    js_regex::js_regex,
    model_tools::ModelCatalog,
    runtime_errors::{visible_error_message, RuntimeError},
    serial_tool_lifecycle::SerialToolLifecycle,
    task_completion::TASK_COMPLETION_TOOL,
    tool_outcomes::{classify_tool_outcome, tool_failure_signature, unconfirmed_tool_result_reason, OutcomeInput, ToolFailure, ToolOutcome},
    tool_transport::{string, CheckpointState, HarnessCheckpoint, ToolCheckpoints},
    web_search::tool::device_tool_activity,
};

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ToolCall {
    pub(crate) tool_call_id: String,
    pub(crate) tool_name: String,
    pub(crate) input: JsValue,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ToolEnd {
    pub(crate) tool_call: ToolCall,
    pub(crate) duration_ms: u64,
    pub(crate) success: bool,
    pub(crate) output: Option<JsValue>,
    pub(crate) error: Option<RuntimeError>,
}

/// Calls Misty rejected without any effect, filled in by whoever runs the calls.
pub(crate) type RejectedCalls = Arc<Mutex<HashSet<String>>>;

#[derive(Default)]
struct MonitorState {
    // Misty name of the observation the next turn must make before acting.
    required_inspection: String,
    handoff: String,
    failures: Vec<ToolFailure>,
    rejected_writes: HashMap<String, u32>,
    unopened_tabs: u32,
    unclosed_tabs: u32,
    unanswered: u32,
}

struct Inner {
    catalog: Arc<ModelCatalog>,
    order: SerialToolLifecycle,
    checkpoints: Arc<dyn ToolCheckpoints>,
    rejected: RejectedCalls,
    state: Mutex<MonitorState>,
}

#[derive(Clone)]
pub(crate) struct ToolMonitor(Arc<Inner>);

impl ToolMonitor {
    pub(crate) fn new(catalog: Arc<ModelCatalog>, order: SerialToolLifecycle, checkpoints: Arc<dyn ToolCheckpoints>, rejected: RejectedCalls) -> Self {
        Self(Arc::new(Inner { catalog, order, checkpoints, rejected, state: Mutex::new(MonitorState::default()) }))
    }

    pub(crate) fn required_inspection(&self) -> String {
        self.0.state().required_inspection.clone()
    }

    /// Set when the run ended to open a screen.
    pub(crate) fn handoff(&self) -> String {
        self.0.state().handoff.clone()
    }

    pub(crate) fn failures(&self) -> Vec<ToolFailure> {
        self.0.state().failures.clone()
    }

    /// Every tool, or the observation a stale or consumed screen needs and the finish.
    pub(crate) fn active_tools(&self, all: &[String]) -> Vec<String> {
        let required = self.required_inspection();
        // The look is offered even when the run's toolset hides it: filtering it out left only the finish.
        match self.0.catalog.model_name(&required) {
            Some(inspection) => std::iter::once(inspection.to_owned())
                .chain(all.iter().filter(|name| *name == TASK_COMPLETION_TOOL).cloned())
                .collect(),
            None => all.to_vec(),
        }
    }

    /// Takes the call's place in line when called (`SerialToolLifecycle::start`).
    pub(crate) fn on_start(&self, call: &ToolCall) -> impl Future<Output = Result<(), RuntimeError>> + Send + 'static {
        let inner = self.0.clone();
        let call = call.clone();
        let concurrent = self.0.catalog.concurrent(&call.tool_name);
        let id = call.tool_call_id.clone();
        self.0.order.start(&id, move || async move { inner.announce(&call).await }, concurrent)
    }

    pub(crate) async fn on_end(&self, event: ToolEnd) -> Result<(), RuntimeError> {
        let id = event.tool_call.tool_call_id.clone();
        self.0.order.finish(&id, self.0.ended(event)).await
    }
}

impl Inner {
    fn state(&self) -> MutexGuard<'_, MonitorState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    async fn announce(&self, call: &ToolCall) -> Result<(), RuntimeError> {
        // Misty announces a read-only call itself when the call arrives, so a
        // read costs one checkpoint, on finish (agent_runtime_tool_start.go). A
        // tool this runtime runs itself never arrives there, so it announces here.
        if self.catalog.read_only(&call.tool_name) && !self.catalog.local(&call.tool_name) {
            return Ok(());
        }
        let name = self.catalog.misty_name(&call.tool_name);
        let input = match &call.input {
            JsValue::Object(_) | JsValue::Array(_) => call.input.clone(),
            _ => JsValue::Object(Vec::new()),
        };
        self.checkpoints
            .checkpoint(HarnessCheckpoint {
                node_id: format!("tool:{}", call.tool_call_id),
                state: CheckpointState::Running,
                phase: format!("using_{}", name.replace('.', "_")),
                progress: 40,
                input: Some(input),
                output: None,
                error_message: None,
            })
            .await
    }

    async fn ended(&self, event: ToolEnd) -> Result<(), RuntimeError> {
        let call = &event.tool_call;
        if self.order.declined(&call.tool_call_id).is_some() {
            return Ok(());
        }
        let name = self.catalog.misty_name(&call.tool_name).to_owned();
        let output = event.output.as_ref();
        let observation = browser_reinspection_tool(&name);
        // A stale reference was rejected before dispatch: observe, then replan.
        let stale = event.success && self.catalog.model_name(observation).is_some() && requires_browser_reinspection(&name, output);
        let rejected = self.rejected.lock().unwrap_or_else(PoisonError::into_inner).contains(&call.tool_call_id);
        let outcome = classify_tool_outcome(&OutcomeInput {
            success: event.success,
            output,
            error: event.error.as_ref(),
            read_only: self.catalog.read_only(&call.tool_name),
            rejected,
        });
        let confirmed = matches!(outcome, ToolOutcome::Confirmed | ToolOutcome::Handoff { .. });
        let visible = if confirmed { String::new() } else { self.visible_reason(&event) };
        if stale {
            self.require_inspection(observation);
        } else {
            self.settle(&name, call, &outcome, &visible);
        }
        let mut fields = vec![
            ("tool".to_owned(), string(name.as_str())),
            ("duration_ms".to_owned(), JsValue::Number(event.duration_ms as f64)),
            ("success".to_owned(), JsValue::Bool(confirmed)),
        ];
        // The timeline's query and links for a call Misty never saw.
        if confirmed && self.catalog.local(&call.tool_name) {
            if let JsValue::Object(activity) = device_tool_activity(&call.input, output) {
                fields.extend(activity);
            }
        }
        self.checkpoints
            .checkpoint(HarnessCheckpoint {
                node_id: format!("tool:{}", call.tool_call_id),
                state: if confirmed { CheckpointState::Completed } else { CheckpointState::Failed },
                phase: if confirmed { "working" } else { "tool_failed" }.to_owned(),
                progress: if confirmed { 60 } else { 40 },
                input: None,
                output: Some(JsValue::Object(fields)),
                error_message: (!confirmed).then_some(visible),
            })
            .await
    }

    fn visible_reason(&self, event: &ToolEnd) -> String {
        if event.success {
            let reason = unconfirmed_tool_result_reason(event.output.as_ref());
            if !reason.is_empty() {
                return reason;
            }
        }
        event.error.as_ref().map_or_else(|| visible_error_message(&RuntimeError::text("")), visible_error_message)
    }

    fn require_inspection(&self, name: &str) {
        {
            let mut state = self.state();
            if state.required_inspection.is_empty() {
                state.required_inspection = name.to_owned();
            }
        }
        self.order.pause("A fresh observation is required before another action.");
    }

    fn settle(&self, name: &str, call: &ToolCall, outcome: &ToolOutcome, visible: &str) {
        // One look satisfies it, whatever it found: a look that fails (a blank or broken page) is
        // what the next plan needs to know, and requiring it again left a run with only that tool.
        {
            let mut state = self.state();
            if name == state.required_inspection {
                state.required_inspection.clear();
            }
        }
        let stop = matches!(outcome, ToolOutcome::Stop { .. });
        match outcome {
            ToolOutcome::Confirmed => return,
            ToolOutcome::Handoff { reason } => {
                // Nothing failed: the conversation continues once the screen is attached.
                {
                    let mut state = self.state();
                    if state.handoff.is_empty() {
                        state.handoff = reason.clone();
                    }
                }
                self.order.stop(reason);
                return;
            }
            _ => {}
        }
        // An ordinary page action whose effect couldn't be confirmed (a toggle, a menu) is
        // looked at again rather than ending the run. A consequential one still stops:
        // it may have sent, paid or deleted, and must never be planned a second time.
        if stop && uncertain_page_action(name, &call.input) {
            // A program looks again with a program: runs that have browser_run do not see the step tools.
            let look = if name == "browser.run" {
                "browser.run"
            } else if self.catalog.model_name("browser.snapshot").is_some() {
                "browser.snapshot"
            } else {
                "browser.inspect"
            };
            self.require_inspection(look);
            return;
        }
        // Opening a tab of the agent's own changes nothing for anyone, so one that couldn't be
        // confirmed (the device was slow to answer) is planned around instead of ending the run.
        if stop && name == "screen.open" && own_tab(&call.input) && count_up(&mut self.state().unopened_tabs) <= 2 {
            self.order.pause(&format!("Opening that tab did not finish ({visible}). Navigate a tab you already have, open it again, or read the page with web_fetch."));
            return;
        }
        // Closing a tab of the agent's own is just as harmless: one that failed (a login refresh at that
        // moment failed four closes in one response and turned a finished run into "didn't finish")
        // leaves the tab open, which costs nothing, so the run carries on.
        if stop && name == "screen.close" && count_up(&mut self.state().unclosed_tabs) <= 8 {
            self.order.pause(&format!("Closing that tab did not finish ({visible}). It stays open; carry on with the task, and close it later only if it still matters."));
            return;
        }
        // Asking the person for help (a bot check, a sign-in) changes no page either: when nobody
        // can answer, the run takes another route instead of ending with nothing.
        if stop && name == "browser.request_user_action" && count_up(&mut self.state().unanswered) <= 2 {
            self.order.pause(&format!("Nobody could take over that page ({visible}). Reach what you need another way: the same page from a search result, another site that has it, or web_fetch; report it as blocked only if nothing else has it."));
            return;
        }
        if matches!(outcome, ToolOutcome::Retry { .. }) {
            let signature = tool_failure_signature(name, &call.input);
            let repeats = {
                let mut state = self.state();
                let repeats = if self.catalog.read_only(&call.tool_name) { 0 } else { state.rejected_writes.get(&signature).copied().unwrap_or(0) + 1 };
                state.rejected_writes.insert(signature, repeats);
                repeats
            };
            if repeats < 2 {
                self.order.pause(&format!("An earlier call in this response failed: {visible}"));
                return;
            }
        }
        self.state().failures.push(ToolFailure { tool_name: name.to_owned(), error: visible.to_owned() });
        self.order.stop(visible);
    }
}

fn count_up(counter: &mut u32) -> u32 {
    *counter += 1;
    *counter
}

/// screen_open for a tab of the agent's own, not the person's tab or desktop.
fn own_tab(input: &JsValue) -> bool {
    match input.get("target") {
        None | Some(JsValue::Null) => true,
        Some(target) => matches!(target.as_str(), Some("" | "new_tab" | "window")),
    }
}

/// What a page or screen goal may only do with the person's approval: the API's consequentialGoal
/// (browser_agent_tool_steps.go), which clears the flag on a goal that names none of it.
static CONSEQUENTIAL_GOAL: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    js_regex(
        r"\b(buy|purchas|pay (for|the|now|with|it)|payment|checkout|check out|order|book(ing)?|reserve|send|e-?mail|message|post|publish|tweet|share|invite|delete|remove|cancel|unsubscribe|subscribe|sign ?up|register|apply for|transfer|donate|submit (an? )?(application|order|payment|form))",
        true,
    )
});

/// A browser page action, not marked consequential, whose outcome was uncertain. A goal flagged
/// consequential that names nothing consequential counts as ordinary, as the API runs it.
fn uncertain_page_action(name: &str, input: &JsValue) -> bool {
    if !name.starts_with("browser.") || name.starts_with("browser.workspace.") {
        return false;
    }
    let flagged = |value: &JsValue| value.get("allowConsequential") == Some(&JsValue::Bool(true));
    let needless = input.get("goal").and_then(JsValue::as_str).is_some_and(|goal| !CONSEQUENTIAL_GOAL.is_match(goal));
    if flagged(input) && !needless {
        return false;
    }
    !input.get("steps").and_then(JsValue::as_array).unwrap_or_default().iter().any(flagged)
}

#[cfg(test)]
#[path = "tool_monitor_tests.rs"]
mod tests;
