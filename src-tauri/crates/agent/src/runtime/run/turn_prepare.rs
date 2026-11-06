//! Everything before a turn's model call: steering, the context's size, the notes the turn carries and
//! the tools it may use, its budget, and the server counting the turn.
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};

use crate::{
    runtime::{
        context::{
            compaction_step::summarize_older_steps,
            condenser::{condense, Condenser, Measured, OldToolResults, PeriodicSummary, StaleSnapshots, SummarizedSteps, WorkingSet, SUMMARY_EVERY_TURNS},
            context_compaction::{context_window, message_bytes},
            working_set::context_parts,
        },
        control_plane_steps::{checkpoint, fetch_execution_budget, take_steering},
        js_json::JsValue,
        model_budget::ExecutionBudget,
        runtime_errors::RuntimeError,
        tool_transport::{object, string, CheckpointState, HarnessCheckpoint},
        toolsets::tool_state,
    },
    sdk::Message,
};

use super::{
    space_task_agent::RunLoop,
    state::{SavedToolState, Stage},
    turn_pacing::wait_out_takeover,
};

impl RunLoop {
    /// Keeps the next call inside the model's window (`condenser.rs`).
    async fn condense_transcript(&mut self) {
        let window = context_window(self.shared.context.context_window_tokens);
        let compactions = AtomicU64::new(self.state.compactions);
        let summary_turn = AtomicI64::new(self.state.summary_turn);
        let turn = self.state.model_turn;
        let shared = self.shared.clone();
        let summarize = |older: Vec<Message>| -> futures_util::future::BoxFuture<'_, Result<String, String>> {
            let sequence = compactions.fetch_add(1, Ordering::SeqCst) + 1;
            let shared = shared.clone();
            Box::pin(async move {
                let context = &shared.context;
                summarize_older_steps(shared.as_ref(), shared.deps.access.as_ref(), &context.model_id, &older, window, sequence).await.map_err(|error| error.to_string())
            })
        };
        let periodic = PeriodicSummary {
            summarize: Box::new(summarize),
            due: Box::new(|| turn - summary_turn.load(Ordering::SeqCst) >= i64::from(SUMMARY_EVERY_TURNS)),
            done: Box::new(|| summary_turn.store(turn, Ordering::SeqCst)),
        };
        let summarized = SummarizedSteps { summarize: Box::new(summarize) };
        let condensers: [&dyn Condenser; 5] = [&StaleSnapshots, &periodic, &WorkingSet, &OldToolResults, &summarized];
        let measured = Measured { input_tokens: self.state.last_input_tokens as f64, sent_bytes: self.state.last_sent_bytes, window: window as f64 };
        let next = condense(&self.state.messages, measured, &condensers).await;
        if let std::borrow::Cow::Owned(next) = next {
            let tail = self.state.plain_tail;
            self.replace_messages(next);
            self.state.plain_tail = tail.min(self.state.messages.len());
        }
        drop(periodic);
        drop(summarized);
        self.state.compactions = compactions.load(Ordering::SeqCst);
        self.state.summary_turn = summary_turn.load(Ordering::SeqCst);
    }

    /// Everything before a turn's model call. `resumed` says how far a restarted run had got.
    pub(super) async fn prepare_turn(&mut self, resumed: Stage) -> Result<ExecutionBudget, RuntimeError> {
        let turn = self.state.model_turn;
        match resumed {
            Stage::Takeover { next_poll, sent, pause_started_ms, poll_at_ms } => {
                wait_out_takeover(self, Some((next_poll, sent, pause_started_ms, poll_at_ms))).await?;
            }
            Stage::SteeringTaken => {}
            _ => {
                let control = self.shared.deps.control.clone();
                let steering = take_steering(control.as_ref(), &self.shared.identity, &format!("{turn}:before"), false).await?;
                let had_messages = !steering.messages.is_empty();
                for message in steering.messages {
                    self.push_note(message);
                }
                if steering.paused {
                    wait_out_takeover(self, None).await?;
                } else if had_messages {
                    // The server hands steering over once.
                    self.save(Stage::SteeringTaken).await?;
                }
            }
        }
        self.condense_transcript().await;
        // Where a long run's context goes (docs/agents/harness.md, "Context"): the largest parts, every 5 turns.
        if turn % 5 == 4 {
            let parts = context_parts(&self.state.messages);
            let number = |value: usize| JsValue::Number(value as f64);
            let by_kind = parts.by_kind.iter().map(|(kind, size)| (kind.clone(), number(*size))).collect();
            let largest = parts.largest.iter().map(|(kind, size)| JsValue::Array(vec![string(kind.as_str()), number(*size)])).collect();
            let line = object([
                ("run", string(self.shared.identity.misty_run_id.as_str())),
                ("turn", JsValue::Number(turn as f64)),
                ("totalChars", number(parts.total_chars)),
                ("byKind", JsValue::Object(by_kind)),
                ("largest", JsValue::Array(largest)),
            ]);
            self.shared.deps.logger.line("context_parts", &line);
        }
        let initial = self.tools.initial;
        let observed = tool_state(&self.state.messages, initial);
        let mut toolset = self.state.toolset.state();
        if observed.seen || !toolset.seen {
            toolset = observed;
        }
        self.state.toolset = SavedToolState::of(&toolset);
        let visible = self.visible(&toolset);
        self.state.visible_tools = self.pace_turn(visible);
        self.state.last_tool_key = self.log_tool_change();
        let budget = fetch_execution_budget(self.shared.deps.control.as_ref(), &self.shared.identity, turn + 1).await?;
        self.state.last_sent_bytes = message_bytes(&self.state.messages);
        // The server counts the turn (the run's turn limit) before the model call and outside the
        // agent's hooks, so a refusal stops the call instead of being swallowed.
        if turn == 0 {
            self.log_context_breakdown();
        }
        let event = HarnessCheckpoint {
            node_id: format!("model:{}", turn + 1),
            state: CheckpointState::Running,
            phase: "thinking".to_owned(),
            progress: (10 + turn * 6).min(85) as u32,
            input: None,
            output: None,
            error_message: None,
        };
        checkpoint(self.shared.deps.control.as_ref(), &self.shared.identity, &event).await?;
        Ok(budget)
    }
}
