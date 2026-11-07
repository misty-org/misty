//! What one durable agent run shares between its loop, its tools and its finish checks.
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicI64, Ordering},
        Arc, Mutex, MutexGuard, PoisonError,
    },
};

use futures_util::future::BoxFuture;
use serde_json::Value;

use crate::runtime::{
    compaction_model::{Checkpoint, RunReporter},
    control_plane::RuntimeIdentity,
    control_plane_steps::{checkpoint, complete, event_body, HarnessCompletion},
    document_ids::DocumentIds,
    js_json::JsValue,
    ledger::Ledger,
    runtime_errors::RuntimeError,
    local_tools::check_crate_tool,
    serial_tool_lifecycle::SerialToolLifecycle,
    tool_calls::{execute_tool, CallEnvironment, SavedWait, ToolCallDeps},
    tool_execution::{rejected_without_effect, settle_device_call},
    tool_monitor::RejectedCalls,
    tool_transport::{HarnessCheckpoint, ToolCheckpoints, ToolTransport},
    web_fetch::{
        fetch_step::{run_device_web_fetch, FetchContext},
        tool::WEB_FETCH_TOOL,
    },
    web_search::{
        search_step::{run_device_web_search, SearchContext},
        tool::WEB_SEARCH_TOOL,
    },
};

use super::{context::SpaceTaskContext, deps::RunDeps};

/// What the finish checks keep across turns (`AgentRun` in `agent-run.ts`).
#[derive(Clone, Debug, Default)]
pub(crate) struct FinishState {
    // A finish is verified once (finish_verification.rs); the next one stands.
    pub(crate) verified: bool,
    // Give-ups sent back after that turn, and what the run had found at the last one.
    pub(crate) persisted: usize,
    pub(crate) persisted_at: Option<HashSet<String>>,
    // Answers sent back for reporting the work instead of giving it.
    pub(crate) reported_only: u32,
}

pub(crate) struct RunShared {
    pub(crate) identity: RuntimeIdentity,
    pub(crate) context: SpaceTaskContext,
    pub(crate) deps: Arc<RunDeps>,
    // Calls Misty reported as rejected without effect; the model may correct them.
    pub(crate) rejected: RejectedCalls,
    // Each tab's latest documentId, so a garbled copy in an action is repaired.
    pub(crate) documents: Mutex<DocumentIds>,
    // The parts this run was asked for, with their evidence; a resume starts from the earlier run's rows.
    pub(crate) ledger: Mutex<Ledger>,
    pub(crate) finish: Mutex<FinishState>,
    pub(crate) model_turn: AtomicI64,
    pub(crate) limit: AtomicI64,
}

/// A lock's contents, whether or not a tool panicked holding it: the run is failing either way.
pub(crate) fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A call that records nothing about its waits: a restart asks again.
struct NoSavedWaits<'a>(&'a RunShared);

impl CallEnvironment for NoSavedWaits<'_> {
    fn waiting<'a>(&'a self, _: &'a str, _: Option<SavedWait>) -> BoxFuture<'a, Result<(), RuntimeError>> {
        Box::pin(async { Ok(()) })
    }

}

impl RunShared {
    pub(crate) fn model_turn(&self) -> i64 {
        self.model_turn.load(Ordering::SeqCst)
    }

    pub(crate) fn limit(&self) -> i64 {
        self.limit.load(Ordering::SeqCst)
    }

    pub(crate) fn tool_deps<'a>(&'a self, environment: &'a dyn CallEnvironment) -> ToolCallDeps<'a> {
        ToolCallDeps {
            identity: &self.identity,
            gateway: self.deps.gateway.as_ref(),
            local: self.deps.local_tools.as_deref(),
            turn: self.model_turn(),
            hooks: &self.deps.hooks,
            environment,
            logger: &self.deps.logger,
        }
    }

    /// A step for one catalog tool (`executeCapability`).
    pub(crate) async fn execute_capability(&self, environment: &dyn CallEnvironment, call_id: &str, name: &str, value: &JsValue, resumed: Option<SavedWait>) -> Result<JsValue, RuntimeError> {
        let result = self.dispatch(environment, call_id, name, value, resumed).await;
        if let Err(error) = &result {
            if rejected_without_effect(error) {
                locked(&self.rejected).insert(call_id.to_owned());
            }
        }
        result
    }

    async fn dispatch(&self, environment: &dyn CallEnvironment, call_id: &str, name: &str, value: &JsValue, resumed: Option<SavedWait>) -> Result<JsValue, RuntimeError> {
        let deps = &self.deps;
        if name == WEB_SEARCH_TOOL || name == WEB_FETCH_TOOL {
            if let Some(host) = deps.local_tools.as_deref() {
                if let Some(refused) = check_crate_tool(host, &self.identity.misty_run_id, call_id, self.model_turn(), name, value).await {
                    return settle_device_call(refused).await;
                }
            }
        }
        if name == WEB_SEARCH_TOOL && self.context.device_search.is_some() {
            let saved = deps.device.search();
            let context = SearchContext { client: &deps.http, saved: saved.as_ref(), cache: &deps.search_cache, endpoints: &deps.search_endpoints, now_ms: (deps.clock)().max(0) as u64 };
            return run_device_web_search(&context, value).await;
        }
        if name == WEB_FETCH_TOOL {
            return run_device_web_fetch(FetchContext { reader: deps.page_reader.as_ref(), logger: &deps.logger }, value).await;
        }
        let input = locked(&self.documents).repair(name, value).into_owned();
        let output = execute_tool(&self.tool_deps(environment), call_id, name, &input, resumed).await?;
        let text = match &output {
            JsValue::String(text) => text.clone(),
            other => other.stringify(),
        };
        locked(&self.documents).note(&input, &text);
        Ok(output)
    }

    pub(crate) async fn finish_run(&self, completion: &HarnessCompletion) -> Result<(), RuntimeError> {
        let context = &self.context;
        let title = Some(context.title_prompt.as_str()).filter(|prompt| !prompt.is_empty());
        complete(self.deps.control.as_ref(), self.deps.device.as_ref(), &self.identity, completion, title, context.summary_request.as_ref()).await
    }
}

impl ToolCheckpoints for RunShared {
    fn checkpoint(&self, event: HarnessCheckpoint) -> BoxFuture<'_, Result<(), RuntimeError>> {
        Box::pin(async move { checkpoint(self.deps.control.as_ref(), &self.identity, &event).await })
    }
}

impl ToolTransport for RunShared {
    fn run<'a>(&'a self, call_id: &'a str, name: &'a str, input: &'a JsValue) -> BoxFuture<'a, Result<Option<JsValue>, RuntimeError>> {
        Box::pin(async move {
            let output = self.execute_capability(&NoSavedWaits(self), call_id, name, input, None).await?;
            Ok(Some(output))
        })
    }
}

fn json_of(value: &Value) -> JsValue {
    JsValue::parse(&value.to_string()).unwrap_or(JsValue::Null)
}

impl RunReporter for RunShared {
    // A model step's own progress, inside its own step.
    fn report(&self, event: Checkpoint) -> BoxFuture<'_, Result<(), String>> {
        Box::pin(async move {
            let state = crate::runtime::tool_transport::CheckpointState::from_report(event.state);
            let body = HarnessCheckpoint {
                node_id: event.node_id,
                state,
                phase: event.phase,
                progress: u32::from(event.progress),
                input: None,
                output: Some(json_of(&event.output)),
                error_message: None,
            };
            let key_state = body.state.as_str();
            let key = format!("{}:event:{}:{key_state}", self.identity.misty_run_id, body.node_id);
            let body = event_body(&body.to_json());
            let mut tries = 0;
            loop {
                tries += 1;
                match self.deps.control.request(&self.identity, "events", body.clone(), key.clone()).await {
                    Ok(_) => return Ok(()),
                    Err(error) if tries > super::step::DEFAULT_STEP_RETRIES => return Err(error.to_string()),
                    Err(_) => tokio::time::sleep(std::time::Duration::from_secs(1)).await,
                }
            }
        })
    }
}

/// Declines a call the serial order already gave up on.
pub(crate) fn guard(order: &SerialToolLifecycle, call_id: &str) -> Result<(), RuntimeError> {
    match order.declined(call_id) {
        Some(declined) => Err(RuntimeError::error(declined)),
        None => Ok(()),
    }
}

/// `getErrorMessage`: what the model reads when a tool throws.
pub(crate) fn error_message(error: &RuntimeError) -> String {
    let text = error.to_string();
    match error.name() {
        "" => text,
        name if text.is_empty() => name.to_owned(),
        name => format!("{name}: {text}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_errors_read_as_javascript_writes_them() {
        assert_eq!(error_message(&RuntimeError::error("tool_not_attempted: x")), "Error: tool_not_attempted: x");
        assert_eq!(error_message(&RuntimeError::text("plain")), "plain");
        assert_eq!(error_message(&RuntimeError::ToolRejected { code: "invalid".into(), message: "no".into() }), "ToolRejectedError: invalid: no");
        assert_eq!(error_message(&RuntimeError::named("FatalError", "agent_model_turn_limit")), "FatalError: agent_model_turn_limit");
    }
}
