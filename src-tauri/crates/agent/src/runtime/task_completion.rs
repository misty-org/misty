//! The report that ends a run: what `agent_finish` takes and records, and what a run that never
//! called it answered.
mod text;

use serde::Serialize;

#[allow(unused_imports)]
pub(crate) use text::{closing_text, is_progress_note, last_text_answer, ClosingStep, FINISH_MISSING_NOTE, PROGRESS_NOTE_NUDGE, SUMMARY_MISSING_NOTE, TASK_COMPLETION_INSTRUCTIONS};

use super::{
    js_json::{zod_optional_string, zod_string, JsValue},
    text::{js_prefix, js_trim},
};
use crate::sdk::{Message, RawJson};

pub(crate) const TASK_COMPLETION_TOOL: &str = "agent_finish";

/// What `taskCompletionInputSchema` becomes for a model, from `zodSchema` in the AI SDK.
const INPUT_SCHEMA: &str = r##"{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"outcome":{"type":"string","enum":["completed","partial","blocked"]},"summary":{"type":"string","maxLength":12000},"remaining":{"maxItems":20,"type":"array","items":{"type":"object","properties":{"requirement":{"type":"string","minLength":1,"maxLength":1000},"reason":{"type":"string","minLength":1,"maxLength":1000}},"required":["requirement","reason"],"additionalProperties":false}}},"required":["outcome","remaining"],"additionalProperties":false}"##;

pub(crate) fn task_completion_input_schema() -> RawJson {
    RawJson::from_text(INPUT_SCHEMA.to_owned()).expect("the schema is fixed, valid JSON")
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Outcome {
    Completed,
    Partial,
    Blocked,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct RemainingItem {
    pub(crate) requirement: String,
    pub(crate) reason: String,
}

/// The recorded report: the tool returns it with its summary filled in.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct TaskCompletion {
    pub(crate) outcome: Outcome,
    pub(crate) summary: String,
    pub(crate) remaining: Vec<RemainingItem>,
}

/// What the model sends: summary may be left out when the answer was just given as text.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TaskCompletionInput {
    pub(crate) outcome: Outcome,
    pub(crate) summary: Option<String>,
    pub(crate) remaining: Vec<RemainingItem>,
}

fn parse_outcome(value: &JsValue) -> Option<Outcome> {
    match value.as_str()? {
        "completed" => Some(Outcome::Completed),
        "partial" => Some(Outcome::Partial),
        "blocked" => Some(Outcome::Blocked),
        _ => None,
    }
}

fn parse_remaining(value: &JsValue) -> Option<Vec<RemainingItem>> {
    let items = value.as_array()?;
    if items.len() > 20 {
        return None;
    }
    items
        .iter()
        .map(|item| {
            Some(RemainingItem {
                requirement: zod_string(item.get("requirement")?, 1, 1000)?,
                reason: zod_string(item.get("reason")?, 1, 1000)?,
            })
        })
        .collect()
}

/// `taskCompletionSchema.safeParse(value)`.
pub(crate) fn parse_task_completion(value: &JsValue) -> Option<TaskCompletion> {
    Some(TaskCompletion {
        outcome: parse_outcome(value.get("outcome")?)?,
        summary: zod_string(value.get("summary")?, 1, 12_000)?,
        remaining: parse_remaining(value.get("remaining")?)?,
    })
}

/// `taskCompletionInputSchema.safeParse(value)`.
pub(crate) fn parse_task_completion_input(value: &JsValue) -> Option<TaskCompletionInput> {
    Some(TaskCompletionInput {
        outcome: parse_outcome(value.get("outcome")?)?,
        summary: zod_optional_string(value.get("summary"), 0, 12_000)?,
        remaining: parse_remaining(value.get("remaining")?)?,
    })
}

/// The report with its summary filled from the text answer when the model left it out.
pub(crate) fn with_answer_summary(input: &TaskCompletionInput, messages: &[Message]) -> Option<TaskCompletion> {
    let written = input.summary.as_deref().map(js_trim).filter(|summary| !summary.is_empty()).map(str::to_owned);
    let summary = written.unwrap_or_else(|| js_prefix(&last_text_answer(messages), 12_000).to_owned());
    if summary.is_empty() {
        return None;
    }
    Some(TaskCompletion { outcome: input.outcome, summary, remaining: input.remaining.clone() })
}

/// One piece of a finished model step: `type` is `tool-call`, `tool-result`, `tool-error`, `text` and
/// so on, as the step lists them.
#[derive(Clone, Debug, Default)]
pub(crate) struct CompletionPart {
    pub(crate) kind: String,
    pub(crate) tool_name: Option<String>,
    pub(crate) tool_call_id: Option<String>,
    pub(crate) output: Option<JsValue>,
}

/// Only the final, standalone terminal call reports the outcome of this task. Earlier reports cannot
/// survive further work or newly received steering.
pub(crate) fn final_task_completion(steps: &[Vec<CompletionPart>], executed_results: &[CompletionPart]) -> Option<TaskCompletion> {
    let last = steps.last()?;
    let tool_parts: Vec<&CompletionPart> = last.iter().filter(|part| part.kind.starts_with("tool-")).collect();
    if tool_parts.iter().any(|part| part.tool_name.as_deref() != Some(TASK_COMPLETION_TOOL) || part.kind == "tool-error") {
        return None;
    }
    let mut results: Vec<&CompletionPart> = tool_parts.iter().copied().filter(|part| part.kind == "tool-result").collect();
    // The pinned WorkflowAgent exposes executed raw outputs in toolResults; step.content contains the
    // model's calls before those tools execute. Accept only the receipt paired with the sole final
    // completion call.
    if results.is_empty() {
        let calls: Vec<&&CompletionPart> = tool_parts.iter().filter(|part| part.kind == "tool-call").collect();
        let [call] = calls.as_slice() else {
            return None;
        };
        let id = call.tool_call_id.as_deref().filter(|id| !id.is_empty())?;
        results = executed_results.iter().filter(|part| part.tool_call_id.as_deref() == Some(id)).collect();
        if results.iter().any(|part| part.kind != "tool-result" || part.tool_name.as_deref() != Some(TASK_COMPLETION_TOOL)) {
            return None;
        }
    }
    let [result] = results.as_slice() else {
        return None;
    };
    parse_task_completion(result.output.as_ref()?)
}

/// How a run ended, as the control plane records it.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum TaskOutcome {
    Success,
    Incomplete { error_code: &'static str, error_message: String },
}

pub(crate) fn task_completion_outcome(report: Option<&TaskCompletion>) -> TaskOutcome {
    let Some(report) = report else {
        return TaskOutcome::Incomplete {
            error_code: "task_outcome_unreported",
            error_message: "The agent stopped without confirming the requested outcome.".to_owned(),
        };
    };
    if report.outcome == Outcome::Completed && report.remaining.is_empty() {
        return TaskOutcome::Success;
    }
    TaskOutcome::Incomplete {
        error_code: if report.outcome == Outcome::Blocked { "task_blocked" } else { "task_incomplete" },
        error_message: if report.remaining.is_empty() {
            "The agent reported that the requested work is not complete.".to_owned()
        } else {
            report.remaining.iter().map(|item| format!("{}: {}", item.requirement, item.reason)).collect::<Vec<_>>().join("; ")
        },
    }
}

pub(crate) fn task_completion_text(report: &TaskCompletion) -> String {
    if report.remaining.is_empty() {
        return report.summary.clone();
    }
    let lines: Vec<String> = report.remaining.iter().map(|item| format!("- {}: {}", item.requirement, item.reason)).collect();
    format!("{}\n\nStill incomplete:\n{}", report.summary, lines.join("\n"))
}

#[cfg(test)]
mod tests;
