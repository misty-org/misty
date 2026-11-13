//! A model turn's tools: what `WorkflowAgent.stream` does with `stopWhen: isStepCount(1)` once the
//! model has answered (`model_call.rs`). A valid tool call runs through the serial lifecycle, an
//! invalid one goes back to the model as an error, and the transcript that comes back is the converted
//! prompt plus the assistant's message and the results.
use std::{sync::Mutex, time::Instant};

use futures_util::future::{join_all, BoxFuture};

use crate::js_json::JsValue;
use crate::model_budget::ModelUsage;
use crate::opened_pages::TurnResult;
use crate::runtime_errors::RuntimeError;
use crate::task_completion::CompletionPart;
use crate::tool_calls::{CallEnvironment, SavedWait};
use crate::tool_monitor::{ToolCall, ToolEnd};
use crate::tool_transport::{CheckpointState, HarnessCheckpoint, object, string};
use crate::model_calls::{Message, ToolOutput, ToolResultPart};

use super::{
    agent_run::{error_message, locked},
    run_tools::{execute_call, model_output, ExecutedCall},
    space_task_agent::RunLoop,
    state::{CallRecord, FinishedCall, ReceivedTurn, SavedResult, SavedUsage, Stage, StepRecord},
};

/// What `agent.stream` returned for one turn.
pub(super) struct TurnOutcome {
    pub(super) messages: Vec<Message>,
    pub(super) steps: Vec<StepRecord>,
    pub(super) tool_results: Vec<SavedResult>,
    pub(super) finish_reason: String,
    pub(super) usage: ModelUsage,
    pub(super) aborted: bool,
}

/// Records a call's waits in the run's file, so a restart keeps waiting on the same token.
pub(super) struct TurnEnvironment<'a> {
    pub(super) run: &'a RunLoop,
    pub(super) turn: &'a Mutex<ReceivedTurn>,
}

impl CallEnvironment for TurnEnvironment<'_> {
    fn waiting<'a>(&'a self, call_id: &'a str, wait: Option<SavedWait>) -> BoxFuture<'a, Result<(), RuntimeError>> {
        Box::pin(async move {
            let saved = {
                let mut turn = locked(self.turn);
                match wait {
                    Some(wait) => turn.waits.insert(call_id.to_owned(), wait),
                    None => turn.waits.remove(call_id),
                };
                turn.clone()
            };
            self.run.save(Stage::Tools(Box::new(saved))).await
        })
    }

}

fn call_input(call: &CallRecord) -> JsValue {
    JsValue::parse(&call.input).unwrap_or(JsValue::Object(Vec::new()))
}

fn invalid_result(call: &CallRecord, message: &str) -> FinishedCall {
    FinishedCall {
        part: ToolResultPart { kind: "tool-result".to_owned(), tool_call_id: call.id.clone(), tool_name: call.name.clone(), output: ToolOutput::ErrorText { value: message.to_owned() } },
        output: None,
    }
}

/// One tool call through its lifecycle hooks. A tool's own failure goes back to the model as text; a
/// failed hook fails the turn.
async fn run_one(run: &RunLoop, turn: &Mutex<ReceivedTurn>, messages: &[Message], call: &CallRecord, started: impl std::future::Future<Output = Result<(), RuntimeError>>, resumed: Option<SavedWait>) -> Result<(), RuntimeError> {
    let input = call_input(call);
    let tool_call = ToolCall { tool_call_id: call.id.clone(), tool_name: call.name.clone(), input: input.clone() };
    started.await?;
    if let Some(hook) = &run.shared.deps.before_tool {
        hook(&call.name);
    }
    let environment = TurnEnvironment { run, turn };
    let began = Instant::now();
    let executed = ExecutedCall { call_id: &call.id, tool_name: &call.name, input: &input, messages, resumed };
    let result = execute_call(&run.shared, &run.tools, &run.order, &environment, executed).await;
    let duration_ms = began.elapsed().as_millis() as u64;
    let (output, part_output, end) = match result {
        Ok(output) => {
            let shown = model_output(&run.tools, &call.name, &output);
            (output.clone(), shown, ToolEnd { tool_call, duration_ms, success: true, output: Some(output), error: None })
        }
        Err(error) => {
            let message = error_message(&error);
            let shown = ToolOutput::ErrorText { value: message.clone() };
            (string(message.as_str()), shown, ToolEnd { tool_call, duration_ms, success: false, output: None, error: Some(RuntimeError::text(message)) })
        }
    };
    let part = ToolResultPart { kind: "tool-result".to_owned(), tool_call_id: call.id.clone(), tool_name: call.name.clone(), output: part_output };
    // Saved before the next call may start, with what this one decided.
    let save = async {
        let saved = {
            let mut turn = locked(turn);
            turn.finished.insert(call.id.clone(), FinishedCall { part, output: Some(output.stringify()) });
            turn.waits.remove(&call.id);
            turn.clone()
        };
        run.save(Stage::Tools(Box::new(saved))).await
    };
    run.tools.monitor.on_end_then(end, save).await
}

/// Runs the turn's tools that haven't finished, each with its own ID, and returns what the turn adds
/// up to. Every call starts at once and the serial lifecycle decides who goes when, so all of them
/// run even after one fails, as with `Promise.all`.
pub(super) async fn run_turn_tools(run: &RunLoop, received: ReceivedTurn) -> Result<TurnOutcome, RuntimeError> {
    let calls = received.calls.clone();
    let messages = with_system(run, &received.messages);
    let mut ready = received;
    for call in &calls {
        if let Some(message) = &call.invalid {
            ready.finished.entry(call.id.clone()).or_insert_with(|| invalid_result(call, message));
        }
    }
    let waits = ready.waits.clone();
    let finished: Vec<String> = ready.finished.keys().cloned().collect();
    let turn = Mutex::new(ready);
    let pending = calls.iter().filter(|call| !finished.contains(&call.id));
    // Each call takes its place in line now, in the order the model wrote them.
    let running: Vec<_> = pending
        .map(|call| {
            let tool_call = ToolCall { tool_call_id: call.id.clone(), tool_name: call.name.clone(), input: call_input(call) };
            let started = run.tools.monitor.on_start(&tool_call);
            run_one(run, &turn, &messages, call, started, waits.get(&call.id).cloned())
        })
        .collect();
    let results = join_all(running).await;
    results.into_iter().collect::<Result<Vec<()>, RuntimeError>>()?;
    let turn = turn.into_inner().unwrap_or_else(std::sync::PoisonError::into_inner);
    Ok(outcome(turn, &calls))
}

fn with_system(run: &RunLoop, messages: &[Message]) -> Vec<Message> {
    let mut all = Vec::with_capacity(messages.len() + 1);
    all.push(Message::System { content: run.tools.instructions.clone(), provider_options: None });
    all.extend_from_slice(messages);
    all
}

fn outcome(mut turn: ReceivedTurn, calls: &[CallRecord]) -> TurnOutcome {
    let finish_reason = turn.step.finish_reason.clone();
    let mut parts = Vec::new();
    let mut tool_results = Vec::new();
    for call in calls {
        let Some(finished) = turn.finished.remove(&call.id) else {
            continue;
        };
        if let Some(output) = finished.output {
            tool_results.push(SavedResult { tool_call_id: call.id.clone(), tool_name: call.name.clone(), output });
        }
        parts.push(finished.part);
    }
    if finish_reason == "tool-calls" {
        turn.messages.push(Message::Tool { content: parts, provider_options: None });
    }
    let usage = SavedUsage::of_turn(turn.step.input_tokens, turn.step.output_tokens);
    TurnOutcome { messages: turn.messages, steps: vec![turn.step], tool_results, finish_reason, usage, aborted: false }
}

/// `onStepEnd`: the turn's text reaches the server here, and the agent's hooks can't fail a turn.
pub(super) async fn step_ended(run: &RunLoop, finish_reason: &str, text: &str) -> Option<RuntimeError> {
    let turn = run.shared.model_turn();
    let event = HarnessCheckpoint {
        node_id: format!("model:{}", turn + 1),
        state: CheckpointState::Completed,
        phase: "working".to_owned(),
        progress: (15 + turn * 6).min(90) as u32,
        input: None,
        // The control plane projects this model-owned text into the public SSE stream for interactive
        // invocations. Tool-only steps normally have no text, while the final step supplies Markdown.
        output: Some(object([("finish_reason", string(finish_reason)), ("text_delta", string(text))])),
        error_message: None,
    };
    crate::control_plane_steps::checkpoint(run.shared.deps.control.as_ref(), &run.shared.identity, &event).await.err()
}

/// The turn's parts as `step.content` lists them.
pub(super) fn completion_parts(step: &StepRecord) -> Vec<CompletionPart> {
    let mut parts = Vec::new();
    if !step.text.is_empty() {
        parts.push(CompletionPart { kind: "text".to_owned(), ..CompletionPart::default() });
    }
    parts.extend(step.tool_calls.iter().map(|(id, name)| CompletionPart { kind: "tool-call".to_owned(), tool_name: Some(name.clone()), tool_call_id: Some(id.clone()), output: None }));
    parts
}

pub(super) fn result_parts(results: &[SavedResult]) -> Vec<CompletionPart> {
    results
        .iter()
        .map(|result| CompletionPart { kind: "tool-result".to_owned(), tool_name: Some(result.tool_name.clone()), tool_call_id: Some(result.tool_call_id.clone()), output: JsValue::parse(&result.output) })
        .collect()
}

pub(super) fn turn_results(results: &[SavedResult]) -> Vec<TurnResult> {
    results.iter().map(|result| TurnResult { tool_name: Some(result.tool_name.clone()), output: JsValue::parse(&result.output) }).collect()
}
