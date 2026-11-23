use crate::browser_reinspection::browser_reinspection_instruction;
use crate::control_plane_steps::take_steering;
use crate::js_json::JsValue;
use crate::model_budget::accumulate_model_usage;
use crate::runtime_errors::RuntimeError;
use crate::screen_session::screen_joined;
use crate::task_completion::{
    final_task_completion, is_progress_note, Outcome, TaskCompletion, FINISH_MISSING_NOTE,
    PROGRESS_NOTE_NUDGE,
};
use crate::text::js_prefix;
use crate::tool_outcomes::final_text;
use crate::toolsets::tool_state;

use super::{
    agent_step::{completion_parts, result_parts, turn_results, TurnEnvironment, TurnOutcome},
    finish_review::verify_finish,
    page_state::push_opened_pages,
    space_task_agent::{Flow, RunLoop},
    state::{ReceivedTurn, SavedResult, SavedToolState, SavedUsage, StepRecord},
};

impl RunLoop {
    pub(super) async fn after_turn(&mut self, current: TurnOutcome) -> Result<Flow, RuntimeError> {
        if let Some(error) = self.hook_failure.take() {
            return Err(error);
        }
        self.state.last_input_tokens = current.steps.last().map_or(0, |step| step.input_tokens);
        let accumulated = self.state.usage.is_some();
        let total = accumulate_model_usage(
            self.state.usage.as_ref().map(SavedUsage::usage).as_ref(),
            &current.usage,
        );
        self.state.usage = Some(SavedUsage::from_usage(&total, accumulated));
        self.state.steps.extend(current.steps.iter().cloned());
        self.state.last_finish_reason = current.finish_reason.clone();
        self.state.last_tool_results = current.tool_results.clone();
        self.state.stream_aborted = current.aborted;
        self.state.messages = current.messages;
        self.state.transcript = None;
        self.state.plain_tail = 0;
        let outputs: Vec<JsValue> = current
            .tool_results
            .iter()
            .filter_map(|result| JsValue::parse(&result.output))
            .collect();
        if screen_joined(&outputs) {
            self.rebuild_tools().await?;
            let rebuilt = tool_state(&self.state.messages, self.tools.initial);
            if rebuilt.seen || !self.state.toolset.seen {
                self.state.toolset = SavedToolState::of(&rebuilt);
            }
        }
        let opened = turn_results(&current.tool_results);
        let pushed = {
            let cell = std::sync::Mutex::new(ReceivedTurn::default());
            let environment = TurnEnvironment {
                run: self,
                turn: &cell,
            };
            push_opened_pages(&self.shared, &self.tools, &opened, &environment).await
        };
        self.state.plain_tail += pushed.len();
        self.state.messages.extend(pushed);
        if self.state.stream_aborted || !self.order.stopped_reason().is_empty() {
            return Ok(Flow::Leave);
        }
        if self.order.resume() {
            let required = self.tools.monitor.required_inspection();
            if !required.is_empty() {
                self.push_note(browser_reinspection_instruction(&required).to_owned());
            }
            return Ok(Flow::Next);
        }
        self.after_settled_turn(
            &current.steps,
            &current.tool_results,
            &current.finish_reason,
        )
        .await
    }

    async fn after_settled_turn(
        &mut self,
        steps: &[StepRecord],
        results: &[SavedResult],
        finish_reason: &str,
    ) -> Result<Flow, RuntimeError> {
        let (turn, limit) = (self.state.model_turn, self.state.limit);
        if finish_reason == "tool-calls" || steps.iter().any(|step| !step.tool_calls.is_empty()) {
            self.state.progress_nudges = 0;
        }
        let texts: Vec<Option<String>> = steps.iter().map(|step| Some(step.text.clone())).collect();
        let plain_answer = final_text(&texts);
        let acted = self
            .state
            .steps
            .iter()
            .any(|step| !step.tool_calls.is_empty());
        let parts: Vec<_> = steps.iter().map(completion_parts).collect();
        let executed = result_parts(results);
        let reported = final_task_completion(&parts, &executed).is_some();
        let has_answer = !plain_answer.is_empty();
        let progress_note = has_answer && is_progress_note(&plain_answer);
        if has_answer && acted && !progress_note && finish_reason != "tool-calls" && !reported {
            let report = TaskCompletion {
                outcome: Outcome::Completed,
                summary: js_prefix(&plain_answer, 12_000).to_owned(),
                remaining: Vec::new(),
            };
            let messages = self.state.messages.clone();
            if let Some(note) = verify_finish(&self.shared, &self.tools, &report, &messages).await {
                self.push_note(note);
                return Ok(Flow::Next);
            }
        }
        if has_answer
            && acted
            && progress_note
            && self.state.progress_nudges < 3
            && turn < limit - 1
        {
            self.state.progress_nudges += 1;
            self.push_note(PROGRESS_NOTE_NUDGE.to_owned());
            return Ok(Flow::Next);
        }
        if has_answer
            && acted
            && !self.state.finish_asked
            && finish_reason != "tool-calls"
            && !reported
            && turn < limit - 1
        {
            self.state.finish_asked = true;
            self.push_note(FINISH_MISSING_NOTE.to_owned());
            return Ok(Flow::Next);
        }
        if reported || finish_reason != "tool-calls" || steps.len() != 1 {
            let control = self.shared.deps.control.clone();
            let last = take_steering(
                control.as_ref(),
                &self.shared.identity,
                &format!("{turn}:finish"),
                true,
            )
            .await?;
            if last.messages.is_empty() {
                return Ok(Flow::Leave);
            }
            for message in last.messages {
                self.push_note(message);
            }
        }
        Ok(Flow::Next)
    }
}
