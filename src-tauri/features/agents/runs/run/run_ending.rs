//! How a run that left its loop ends: its report, its answer, or why it stopped.
use crate::closing_answer::closing_answer;
use crate::control_plane_steps::HarnessCompletion;
use crate::js_json::JsValue;
use crate::ledger::ledger_suffix;
use crate::runtime_errors::RuntimeError;
use crate::task_completion::{closing_text, final_task_completion, task_completion_outcome, task_completion_text, ClosingStep, TaskOutcome};
use crate::text::{js_prefix, js_trim};
use crate::tool_outcomes::{incomplete_tool_result_text, keeps_answer_after_odd_stop, unfinished_model_result};
use crate::tool_transport::string;

use super::{
    agent_run::locked,
    agent_step::{completion_parts, result_parts},
    space_task_agent::{RunLoop, RunResult},
};

impl RunLoop {
    pub(super) async fn finish(&self, mut completion: HarnessCompletion) -> Result<RunResult, RuntimeError> {
        completion.usage = self.state.usage.as_ref().map(|usage| usage.to_json());
        self.shared.finish_run(&completion).await?;
        Ok(RunResult { text: completion.text, steps: self.state.steps.len(), incomplete: completion.status != "success" })
    }

    fn stopped(&self) -> HarnessCompletion {
        let monitor = &self.tools.monitor;
        let handoff = monitor.handoff();
        if !handoff.is_empty() {
            return HarnessCompletion::success(handoff);
        }
        let reason = self.order.stopped_reason();
        let failures = monitor.failures();
        let text = if failures.is_empty() { reason.clone() } else { incomplete_tool_result_text(&failures) };
        HarnessCompletion::ended("incomplete", text, "tool_sequence_stopped", &reason)
    }

    /// A stopped run writes its answer from what it found before the stop reason (`closing_answer.rs`);
    /// a handoff or a run that barely started keeps the plain message.
    pub(super) async fn finish_stopped(&self) -> Result<RunResult, RuntimeError> {
        let mut ending = self.stopped();
        if self.tools.monitor.handoff().is_empty() && self.state.steps.len() > 2 {
            let context = &self.shared.context;
            let transcript = self.state.transcript.as_deref().unwrap_or(&self.state.messages);
            let answer = closing_answer(self.shared.as_ref(), self.shared.deps.access.as_ref(), &context.model_id, &context.prompt, transcript, &self.order.stopped_reason()).await;
            if !answer.is_empty() {
                ending.text = format!("{answer}\n\n{}", ending.text);
            }
        }
        self.finish(ending).await
    }

    pub(super) async fn end_run(&self) -> Result<RunResult, RuntimeError> {
        let steps = &self.state.steps;
        let last_parts: Vec<_> = steps.last().map(completion_parts).into_iter().collect();
        let task_report = final_task_completion(&last_parts, &result_parts(&self.state.last_tool_results));
        let finish_reason = self.state.last_finish_reason.as_str();
        let limit = self.state.limit.max(0) as usize;
        let shown_reason = if task_report.is_some() { "stop" } else { finish_reason };
        let unfinished = unfinished_model_result(self.state.stream_aborted, steps.len(), shown_reason, limit);
        if let Some(unfinished) = unfinished.as_ref().filter(|_| self.state.stream_aborted) {
            return self.finish(HarnessCompletion::ended("incomplete", unfinished.message, unfinished.code, unfinished.message)).await;
        }
        if !self.order.stopped_reason().is_empty() {
            return self.finish_stopped().await;
        }
        let closing: Vec<ClosingStep> = steps.iter().map(|step| ClosingStep { text: Some(step.text.clone()), has_tool_call: !step.tool_calls.is_empty() }).collect();
        let answer_text = closing_text(&closing);
        if let Some(unfinished) = &unfinished {
            if keeps_answer_after_odd_stop(Some(unfinished.code), finish_reason, &answer_text, self.tools.monitor.failures().len()) {
                // The answer is kept, with the reason after it (the app shows the answer, then the reason).
                let text = format!("{}\n\nI couldn't fully complete that request. The model stopped without confirming it was done.", js_trim(&answer_text));
                return self.finish(HarnessCompletion::ended("incomplete", text, unfinished.code, unfinished.message)).await;
            }
            return self.finish(HarnessCompletion::ended("incomplete", unfinished.message, unfinished.code, unfinished.message)).await;
        }
        // A run that took no actions and answered in text (a greeting, or a question answered directly)
        // is a reply, with nothing to confirm. Any run that acted must still confirm its outcome with
        // agent_finish.
        let acted = steps.iter().any(|step| !step.tool_calls.is_empty());
        self.log_run_finish(task_report.as_ref(), acted, &answer_text);
        if task_report.is_none() && !acted && !answer_text.is_empty() {
            return self.finish(HarnessCompletion::success(answer_text)).await;
        }
        let outcome = task_completion_outcome(task_report.as_ref());
        let text = match &task_report {
            Some(report) => format!("{}{}", task_completion_text(report), ledger_suffix(&locked(&self.shared.ledger))),
            None => answer_text,
        };
        self.finish(match outcome {
            TaskOutcome::Success => HarnessCompletion::success(text),
            TaskOutcome::Incomplete { error_code, error_message } => {
                let shown = if text.is_empty() { error_message.clone() } else { text };
                HarnessCompletion::ended("incomplete", shown, error_code, &error_message)
            }
        })
        .await
    }

    /// How runs end: most Odysseys runs ended as partial or unreported.
    fn log_run_finish(&self, report: Option<&crate::task_completion::TaskCompletion>, acted: bool, text: &str) {
        let mut fields = vec![
            ("run".to_owned(), string(self.shared.identity.misty_run_id.as_str())),
            ("turns".to_owned(), JsValue::Number(self.state.model_turn as f64)),
            ("reported".to_owned(), JsValue::Bool(report.is_some())),
        ];
        if let Some(report) = report {
            let outcome = serde_json::to_value(report.outcome).ok().and_then(|value| value.as_str().map(str::to_owned)).unwrap_or_default();
            fields.push(("outcome".to_owned(), string(outcome)));
            let remaining = report.remaining.iter().map(|item| string(js_prefix(&item.requirement, 120))).collect();
            fields.push(("remaining".to_owned(), JsValue::Array(remaining)));
        }
        fields.push(("acted".to_owned(), JsValue::Bool(acted)));
        fields.push(("plainText".to_owned(), JsValue::Bool(report.is_none() && !text.is_empty())));
        self.shared.deps.logger.line("run_finish", &JsValue::Object(fields));
    }
}
