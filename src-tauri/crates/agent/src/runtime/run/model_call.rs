//! A turn's model call: one step that tries again as Workflow steps do, with the tools it's offered, the
//! tool choice and settings the agent gives it, and its answer read the way the adapter reads it.
use std::{collections::HashMap, time::Duration};

use futures_util::StreamExt;
use serde_json::{json, Value};

use crate::{
    runtime::{
        context::prompt_cache::with_cache_breakpoint,
        runtime_errors::{RuntimeError, StepFailure},
    },
    sdk::{to_model_prompt, AssistantPart, CallOptions, Message, ModelError, ProviderOptions, StreamPart, ToolDefinition},
};

use super::{
    space_task_agent::RunLoop,
    state::{CallRecord, ReceivedTurn, StepRecord},
    step::{step, DEFAULT_STEP_RETRIES},
    tool_input::parse_tool_call,
};

/// The most one turn may write (agents.MaxAgentTurnOutputTokens).
const MAX_OUTPUT_TOKENS: u32 = 32_000;
/// Backoff of 2, 4, 8 and 16 seconds rides out a short network blip to the provider, which failed
/// whole runs at their first call when three quick retries did not.
const MODEL_RETRIES: u32 = 4;

pub(super) enum ModelReply {
    Aborted(Vec<Message>),
    Turn(Box<ReceivedTurn>),
}

/// A `ModelError` as what a step sees thrown.
pub(crate) fn model_failure(error: ModelError) -> StepFailure {
    match &error {
        ModelError::Setup { .. } => StepFailure::Fatal(error.to_string()),
        ModelError::Api { status, .. } => StepFailure::Unrecognized(RuntimeError::named("AI_APICallError", error.to_string()).with_status(*status)),
        ModelError::Retry { .. } => StepFailure::Unrecognized(RuntimeError::named("AI_RetryError", error.to_string())),
        ModelError::NoOutput { name, .. } => StepFailure::Unrecognized(RuntimeError::named(*name, error.to_string())),
        ModelError::Network(_) | ModelError::Unsupported(_) => StepFailure::Unrecognized(RuntimeError::error(error.to_string())),
    }
}

/// Strips OpenAI's itemId from provider metadata, which needs reasoning items that aren't kept. All
/// the rest stays, such as Gemini's thoughtSignature.
fn sanitized_call_metadata(metadata: Option<Value>) -> Option<ProviderOptions> {
    let Value::Object(mut fields) = metadata? else {
        return None;
    };
    if let Some(Value::Object(openai)) = fields.get_mut("openai") {
        openai.remove("itemId");
        if openai.is_empty() {
            fields.remove("openai");
        }
        if fields.is_empty() {
            return None;
        }
    }
    Some(fields)
}

fn thrown(error: &Value) -> Option<RuntimeError> {
    let field = |name: &str| error.get(name);
    let name = field("name").and_then(Value::as_str).unwrap_or("Error");
    let dropped = name == "AI_APICallError" && field("isRetryable").and_then(Value::as_bool) == Some(true);
    if !dropped && field("thrown").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    Some(RuntimeError::named(name, field("message").and_then(Value::as_str).unwrap_or("")))
}

/// What one stream added up to.
#[derive(Default)]
struct Consumed {
    text: String,
    assistant_calls: Vec<AssistantPart>,
    calls: Vec<CallRecord>,
    valid: Vec<(String, String)>,
    finish_reason: Option<String>,
    input_tokens: u64,
    output_tokens: u64,
}

async fn consume(mut stream: crate::sdk::ModelStream, active: &[&ToolDefinition]) -> Result<Consumed, RuntimeError> {
    let mut consumed = Consumed::default();
    while let Some(part) = stream.next().await {
        match part {
            StreamPart::TextDelta { delta, .. } => consumed.text.push_str(&delta),
            StreamPart::ToolCall { tool_call_id, tool_name, input, provider_metadata } => {
                let parsed = parse_tool_call(&tool_name, &input, active);
                consumed.assistant_calls.push(AssistantPart::ToolCall {
                    tool_call_id: tool_call_id.clone(),
                    tool_name: tool_name.clone(),
                    input: parsed.input,
                    provider_options: sanitized_call_metadata(provider_metadata),
                });
                if parsed.invalid.is_none() {
                    consumed.valid.push((tool_call_id.clone(), tool_name.clone()));
                }
                consumed.calls.push(CallRecord { id: tool_call_id, name: tool_name, input: parsed.value.stringify(), invalid: parsed.invalid });
            }
            StreamPart::Finish { finish_reason, usage, .. } => {
                consumed.finish_reason = Some(finish_reason.unified);
                consumed.input_tokens = usage.input_tokens.total.unwrap_or(0);
                consumed.output_tokens = usage.output_tokens.total.unwrap_or(0);
            }
            // The adapter ignores a provider's failure parts. What ends the step is a stream that throws.
            StreamPart::Error { error } => {
                if let Some(error) = thrown(&error) {
                    return Err(error);
                }
            }
            _ => {}
        }
    }
    Ok(consumed)
}

/// The message list a turn sends: the fixed system text first, then the transcript tidied by the SDK.
fn conversation(run: &RunLoop, messages: &[Message]) -> Result<Vec<Message>, RuntimeError> {
    let model_id = &run.shared.context.model_id;
    let mut prompt = Vec::with_capacity(messages.len() + 1);
    prompt.push(Message::System { content: run.tools.instructions.clone(), provider_options: None });
    prompt.extend(with_cache_breakpoint(messages, model_id).into_owned());
    to_model_prompt(prompt).map_err(|error| match model_failure(error) {
        StepFailure::Unrecognized(error) => error,
        StepFailure::Fatal(message) | StepFailure::Retryable { message, .. } => RuntimeError::named("FatalError", message),
    })
}

fn call_options(run: &RunLoop, prompt: Vec<Message>, active: &[&ToolDefinition]) -> CallOptions {
    let context = &run.shared.context;
    let mut provider_options = ProviderOptions::new();
    provider_options.insert("gateway".to_owned(), json!({ "models": [context.model_id] }));
    let reasoning = Some(context.reasoning_effort.clone()).filter(|effort| !effort.is_empty() && effort != "max");
    CallOptions {
        prompt,
        max_output_tokens: Some(MAX_OUTPUT_TOKENS),
        reasoning,
        tools: active.iter().map(|tool| (*tool).clone()).collect(),
        provider_options: Some(provider_options),
        ..CallOptions::default()
    }
}

/// `prepareStep`'s filter. An empty list means every tool.
fn active_tools<'a>(definitions: &'a [ToolDefinition], names: &[String]) -> Vec<&'a ToolDefinition> {
    if names.is_empty() {
        return definitions.iter().collect();
    }
    definitions.iter().filter(|tool| names.contains(&tool.name)).collect()
}

/// The model's half of a turn. `timeout_ms` is the run's remaining active time.
pub(super) async fn call_model(run: &RunLoop, messages: &[Message], timeout_ms: i64) -> Result<ModelReply, RuntimeError> {
    let timeout_at = (run.shared.deps.clock)() + timeout_ms;
    let deps = &run.shared.deps;
    let context = &run.shared.context;
    let converted = conversation(run, messages)?;
    let names = run.tools.monitor.active_tools(&run.state.visible_tools);
    let active = active_tools(&run.tools.definitions, &names);
    let options = call_options(run, converted.clone(), &active);
    // A stream past the deadline is an abort, not a failure.
    let consumed = step("doStreamStep", DEFAULT_STEP_RETRIES, || {
        let options = options.clone();
        let active = &active;
        async move {
            let left = timeout_at - (deps.clock)();
            if left <= 0 {
                return Ok(None);
            }
            let call = async {
                let stream = deps.models.stream(&context.model_id, options, MODEL_RETRIES, true).await.map_err(model_failure)?;
                consume(stream, active).await.map_err(StepFailure::Unrecognized)
            };
            match tokio::time::timeout(Duration::from_millis(left as u64), call).await {
                Err(_) => Ok(None),
                Ok(result) => {
                    let consumed = result?;
                    Ok(((deps.clock)() < timeout_at).then_some(consumed))
                }
            }
        }
    })
    .await?;
    let without_system = |mut all: Vec<Message>| {
        all.retain(|message| !matches!(message, Message::System { .. }));
        all
    };
    let Some(consumed) = consumed else {
        return Ok(ModelReply::Aborted(without_system(converted)));
    };
    let finish_reason = consumed.finish_reason.clone().unwrap_or_else(|| "other".to_owned());
    if !matches!(finish_reason.as_str(), "tool-calls" | "stop" | "length" | "content-filter" | "error" | "other" | "unknown") {
        return Err(RuntimeError::error(format!("Unexpected finish reason: {finish_reason}")));
    }
    let mut conversation = without_system(converted);
    let text_part = (!consumed.text.is_empty()).then(|| AssistantPart::Text { text: consumed.text.clone(), provider_options: None });
    let mut calls = Vec::new();
    match finish_reason.as_str() {
        "tool-calls" => {
            let content = text_part.into_iter().chain(consumed.assistant_calls).collect();
            conversation.push(Message::Assistant { content, provider_options: None });
            calls = consumed.calls;
        }
        "stop" if text_part.is_some() => {
            conversation.push(Message::Assistant { content: text_part.into_iter().collect(), provider_options: None });
        }
        _ => {}
    }
    let step_record = StepRecord { text: consumed.text, tool_calls: consumed.valid, finish_reason, input_tokens: consumed.input_tokens, output_tokens: consumed.output_tokens };
    Ok(ModelReply::Turn(Box::new(ReceivedTurn { step: step_record, messages: conversation, calls, finished: HashMap::new(), waits: HashMap::new() })))
}
