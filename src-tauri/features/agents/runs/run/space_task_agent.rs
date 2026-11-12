//! One durable agent run. The model sees every tool in the run's catalog under its real name; Misty's
//! gateway authorizes, journals and executes each call. The model reports the outcome with agent_finish.
//!
//! The loop's state lives in [`LoopState`], saved after each model turn, before its tools run, and after
//! each tool result. A run that resumes continues from its saved [`Stage`].
use std::sync::{atomic::Ordering, Arc};

use tokio::sync::Mutex as AsyncMutex;

use crate::control_plane_steps::{checkpoint, HarnessCompletion};
use crate::js_json::JsValue;
use crate::model_budget::model_turn_limit;
use crate::model_input::initial_messages;
use crate::model_tools::CatalogTool;
use crate::requirements_review::{ledger_note, requirements_ledger, worth_ledger};
use crate::runtime_errors::{classify_runtime_error, RuntimeError};
use crate::serial_tool_lifecycle::SerialToolLifecycle;
use crate::tool_outcomes::final_text;
use crate::tool_transport::{object, string, CheckpointState, HarnessCheckpoint};
use crate::toolsets::{tool_state, ToolState};
use crate::transcript::user_message;
use crate::model_calls::Message;

use super::{
    agent_run::{locked, RunShared},
    agent_step::{run_turn_tools, step_ended, TurnOutcome},
    model_call::ModelReply,
    model_stream::{resume_outage, stream_turn},
    run_start::{start_run, RunStart},
    run_tools::{assemble_tools, RunTools},
    state::{saved_ledger, LoopState, SavedToolState, SavedUsage, Stage},
    store::StoredRun,
};

pub(crate) struct RunResult {
    pub(crate) text: String,
    pub(crate) steps: usize,
    pub(crate) incomplete: bool,
}

pub(crate) struct RunLoop {
    pub(super) shared: Arc<RunShared>,
    pub(super) order: SerialToolLifecycle,
    pub(super) tools: RunTools,
    pub(super) state: LoopState,
    // The agent swallows errors thrown from its step hooks, so a failed checkpoint is held here and
    // rethrown once the call returns.
    pub(super) hook_failure: Option<RuntimeError>,
    stored: StoredRun,
    save_lock: AsyncMutex<()>,
}

/// What a turn decided.
pub(super) enum Flow {
    Next,
    Leave,
}

impl RunLoop {
    /// Writes the run's file. `Stage::Tools` carries the transcript itself.
    pub(super) async fn save(&self, stage: Stage) -> Result<(), RuntimeError> {
        let _order = self.save_lock.lock().await;
        let mut state = self.state.clone();
        if matches!(stage, Stage::Tools(_)) {
            state.messages = Vec::new();
        }
        state.stage = stage;
        state.ledger = saved_ledger(&locked(&self.shared.ledger));
        (state.documents_latest, state.documents_issued) = locked(&self.shared.documents).saved();
        state.rejected = locked(&self.shared.rejected).clone();
        state.monitor = self.tools.monitor.saved();
        (state.stopped_reason, state.paused_reason, state.declined) = self.order.saved();
        {
            let finish = locked(&self.shared.finish);
            state.verified = finish.verified;
            state.persisted = finish.persisted;
            state.persisted_at = finish.persisted_at.clone();
            state.reported_only = finish.reported_only;
        }
        let mut stored = self.stored.clone();
        stored.state = Some(state);
        let store = self.shared.deps.store.clone();
        let saved = tokio::task::spawn_blocking(move || store.save(&stored)).await;
        match saved {
            Ok(Ok(())) => Ok(()),
            _ => Err(RuntimeError::error("run_store_failed: the run could not be saved")),
        }
    }

    pub(super) fn push_note(&mut self, text: String) {
        self.state.messages.push(user_message(text));
        self.state.plain_tail += 1;
    }

    /// The transcript just got rewritten. What the stop path reads stays what it was, as the array the
    /// TypeScript kept a reference to did.
    pub(super) fn replace_messages(&mut self, next: Vec<Message>) {
        if self.state.transcript.is_none() {
            self.state.transcript = Some(std::mem::take(&mut self.state.messages));
        }
        self.state.messages = next;
    }

    pub(super) fn visible(&self, state: &ToolState) -> Vec<String> {
        self.tools.toolsets().visible(&self.tools.tool_names, state)
    }

    /// The model call and its tools, from wherever a restart left them.
    async fn stream_and_run(&mut self, resumed: Stage) -> Result<TurnOutcome, RuntimeError> {
        let reply = match resumed {
            Stage::Tools(turn) => {
                // What the stop path reads, if the run ends before the turn does.
                self.state.messages.clone_from(&turn.messages);
                ModelReply::Turn(turn)
            }
            Stage::Outage { outage, wait_started_ms, wake_at_ms, budget } => {
                let messages = self.state.messages.clone();
                resume_outage(self, &messages, &budget, outage, wait_started_ms, wake_at_ms).await?
            }
            other => {
                let budget = self.prepare_turn(other).await?;
                let messages = self.state.messages.clone();
                stream_turn(self, &messages, &budget, 0).await?
            }
        };
        let turn = match reply {
            ModelReply::Turn(turn) => turn,
            ModelReply::Aborted(messages) => {
                return Ok(TurnOutcome { messages, steps: Vec::new(), tool_results: Vec::new(), finish_reason: "other".to_owned(), usage: SavedUsage::of_turn(0, 0), aborted: true });
            }
        };
        self.save(Stage::Tools(turn.clone())).await?;
        let outcome = run_turn_tools(self, *turn).await?;
        if let Some(step) = outcome.steps.first() {
            let (reason, text) = (step.finish_reason.clone(), step.text.clone());
            if let Some(error) = step_ended(self, &reason, &text).await {
                self.hook_failure.get_or_insert(error);
            }
        }
        Ok(outcome)
    }

    pub(super) async fn rebuild_tools(&mut self) -> Result<(), RuntimeError> {
        let deps = self.shared.deps.clone();
        let remote = deps.gateway.discover(&self.shared.identity).await?;
        self.state.catalog = remote.iter().map(Into::into).collect();
        self.tools = assemble_tools(&self.shared, &self.order, remote);
        Ok(())
    }

    /// The turns, from where the run is now.
    async fn run_turns(&mut self) -> Result<(), RuntimeError> {
        let mut resumed = std::mem::take(&mut self.state.stage);
        while self.state.model_turn < self.state.limit {
            self.shared.model_turn.store(self.state.model_turn, Ordering::SeqCst);
            let current = self.stream_and_run(std::mem::take(&mut resumed)).await?;
            match self.after_turn(current).await? {
                Flow::Leave => return Ok(()),
                Flow::Next => {
                    self.state.model_turn += 1;
                    self.save(Stage::BeforeTurn).await?;
                }
            }
        }
        if self.state.steps.is_empty() && self.state.usage.is_none() {
            return Err(RuntimeError::error("empty_agent_response"));
        }
        Ok(())
    }

    /// What's done on a fresh run's first pass, before its first turn. `Some` ends the run here.
    async fn before_first_turn(&mut self) -> Result<Option<RunResult>, RuntimeError> {
        let mut messages = initial_messages(&self.shared.context.task_input());
        self.state.plain_tail = messages.len();
        // A long request's requirements, listed once before work starts (requirements_review.rs).
        let context = &self.shared.context;
        if worth_ledger(&context.prompt) {
            let listed = requirements_ledger(self.shared.as_ref(), self.shared.deps.access.as_ref(), &context.model_id, &context.prompt).await;
            if !listed.is_empty() {
                messages.push(user_message(ledger_note(&listed)));
                self.state.plain_tail += 1;
            }
        }
        // agent.tool survives a summary that drops the calls that chose it.
        self.state.toolset = SavedToolState::of(&tool_state(&messages, self.tools.initial));
        self.state.messages = messages;
        self.save(Stage::BeforeTurn).await?;
        Ok(None)
    }

    async fn drive(&mut self, fresh: bool) -> Result<RunResult, RuntimeError> {
        let driven = async {
            if fresh {
                if let Some(result) = self.before_first_turn().await? {
                    return Ok(Some(result));
                }
            }
            self.run_turns().await.map(|()| None)
        }
        .await;
        match driven {
            Ok(Some(result)) => Ok(result),
            Ok(None) => self.end_run().await,
            Err(error) => self.failed(error).await,
        }
    }

    async fn failed(&mut self, error: RuntimeError) -> Result<RunResult, RuntimeError> {
        if !self.order.stopped_reason().is_empty() {
            return self.finish_stopped().await;
        }
        let failure = classify_runtime_error(&error);
        if failure.code == "usage_limit_reached" {
            // Held back by a rate limit mid-task is a pause, not a failure: keep what was done.
            let texts: Vec<Option<String>> = self.state.steps.iter().map(|step| Some(step.text.clone())).collect();
            let so_far = final_text(&texts);
            let text = [so_far.as_str(), failure.message].iter().filter(|part| !part.is_empty()).copied().collect::<Vec<_>>().join("\n\n");
            return self.finish(HarnessCompletion::ended("incomplete", text, failure.code, failure.message)).await;
        }
        self.finish(HarnessCompletion::ended("failed", "", failure.code, failure.message)).await?;
        Err(RuntimeError::named("FatalError", failure.message))
    }
}

/// The run from start to end, fresh or resumed. A value is a run that ended normally, an error one
/// the Workflow library would call failed.
pub(crate) async fn run_space_task_agent(deps: Arc<super::deps::RunDeps>, mut stored: StoredRun) -> Result<RunResult, RuntimeError> {
    let shared = match start_run(deps.clone(), &mut stored).await? {
        RunStart::Done(result) => return Ok(result),
        RunStart::Agent(shared) => shared,
    };
    let saved = stored.state.take();
    let fresh = saved.is_none();
    let remote: Vec<CatalogTool> = match &saved {
        Some(state) => state.catalog.iter().cloned().map(Into::into).collect(),
        None => deps.gateway.discover(&shared.identity).await?,
    };
    let order = match &saved {
        Some(state) => SerialToolLifecycle::restored(state.stopped_reason.clone(), state.paused_reason.clone(), state.declined.clone()),
        None => SerialToolLifecycle::new(),
    };
    let tools = assemble_tools(&shared, &order, remote.clone());
    if let Some(state) = &saved {
        tools.monitor.restore(state.monitor.clone());
    }
    let context = &shared.context;
    if fresh {
        let missing = context.allowed_tools.iter().filter(|name| !tools.advertised.contains(*name)).map(|name| string(name.as_str())).collect();
        let omitted = tools.catalog.omitted.iter().map(|name| string(name.as_str())).collect();
        let event = HarnessCheckpoint {
            node_id: "mcp:catalog".to_owned(),
            state: CheckpointState::Completed,
            phase: "tools_ready".to_owned(),
            progress: 8,
            input: None,
            output: Some(object([
                ("advertised_tool_count", JsValue::Number(tools.advertised.len() as f64)),
                ("missing_allowed_tools", JsValue::Array(missing)),
                ("omitted_tools", JsValue::Array(omitted)),
            ])),
            error_message: None,
        };
        checkpoint(deps.control.as_ref(), &shared.identity, &event).await?;
    }
    let limit = match &saved {
        Some(state) => state.limit,
        None => model_turn_limit(context.model_turn_limit.as_ref()).map_err(|error| RuntimeError::error(error.to_string()))?,
    };
    shared.limit.store(limit, Ordering::SeqCst);
    let state = saved.unwrap_or_else(|| LoopState {
        catalog: remote.iter().map(Into::into).collect(),
        limit,
        transcript: Some(Vec::new()),
        pacing: super::state::SavedPacing { started_at_ms: (deps.clock)(), paused_ms: 0, estimate: None, research_scale: 1 },
        ..LoopState::default()
    });
    let mut run = RunLoop { shared, order, tools, state, hook_failure: None, stored, save_lock: AsyncMutex::new(()) };
    run.drive(fresh).await
}
