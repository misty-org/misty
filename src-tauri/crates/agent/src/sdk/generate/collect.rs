//! Adds up a stream into what the assistant said. Follows how the `ai` package builds a step's
//! content in `streamText`, and turns it into a message the way its `toResponseMessages` does.
use serde_json::Value;

use crate::sdk::{
    model::ModelStream,
    prompt::{AssistantPart, Message, ProviderOptions},
    providers::ordered::Ordered,
    raw_json::RawJson,
    stream::{FinishReason, StreamPart, Usage},
};
use futures_util::StreamExt;

/// A tool call as the model made it.
#[derive(Clone, Debug)]
pub struct CollectedToolCall {
    pub tool_call_id: String,
    pub tool_name: String,
    /// The JSON text the model wrote, which may be invalid.
    pub raw_input: String,
    /// What goes back to the model and to the tool: the input, or `{}` when it can't be read.
    pub input: RawJson,
    /// Whether `raw_input` could be read as JSON.
    pub input_is_valid: bool,
    pub provider_metadata: Option<Value>,
}

/// One whole model answer.
#[derive(Clone, Debug, Default)]
pub struct CollectedTurn {
    /// The answer's parts in the order they began, ready to append to the message list.
    pub content: Vec<AssistantPart>,
    pub text: String,
    pub reasoning_text: Option<String>,
    pub tool_calls: Vec<CollectedToolCall>,
    pub finish_reason: Option<FinishReason>,
    pub usage: Usage,
    pub provider_metadata: Option<Value>,
    pub warnings: Vec<Value>,
    pub response_id: Option<String>,
    pub response_model_id: Option<String>,
    pub response_timestamp: Option<String>,
    /// Failures the provider reported inside the stream.
    pub errors: Vec<Value>,
}

impl CollectedTurn {
    /// The assistant message for the next call, if the model said anything to carry.
    pub fn response_message(&self) -> Option<Message> {
        (!self.content.is_empty()).then(|| Message::Assistant {
            content: self.content.clone(),
            provider_options: None,
        })
    }
}

fn provider_options(metadata: Option<Value>) -> Option<ProviderOptions> {
    match metadata {
        Some(Value::Object(fields)) => Some(fields),
        _ => None,
    }
}

/// A forbidden key anywhere fails the parse, as in the SDK's `secureJsonParse`.
fn has_forbidden_key(tree: &Ordered) -> bool {
    match tree {
        Ordered::Array(items) => items.iter().any(has_forbidden_key),
        Ordered::Object(fields) => fields.iter().any(|(key, value)| {
            key == "__proto__"
                || (key == "constructor" && matches!(value, Ordered::Object(_)) && value.get("prototype").is_some())
                || has_forbidden_key(value)
        }),
        _ => false,
    }
}

/// `input.trim() === "" ? {} : parse(input)`, keeping the key order. Input that can't be read
/// becomes `{}`, so the next call still has a valid prompt, as with `toResponseMessages`.
fn parsed_input(raw: &str) -> (RawJson, bool) {
    if raw.trim().is_empty() {
        return (RawJson::empty_object(), true);
    }
    match Ordered::from_text(raw) {
        Ok(tree) if !has_forbidden_key(&tree) => {
            // Text, a number or a boolean isn't an object and fails the tool's schema.
            let usable = matches!(tree, Ordered::Object(_) | Ordered::Array(_) | Ordered::Null);
            let input = usable.then(|| RawJson::from_text(tree.to_text()).ok()).flatten();
            match input {
                Some(input) => (input, true),
                None => (RawJson::empty_object(), false),
            }
        }
        _ => (RawJson::empty_object(), false),
    }
}

/// A text or reasoning part still being written.
enum Building {
    Text { text: String, metadata: Option<Value> },
    Reasoning { text: String, metadata: Option<Value> },
    Call(CollectedToolCall),
}

#[derive(Default)]
struct Collector {
    parts: Vec<Building>,
    open_text: Vec<(String, usize)>,
    open_reasoning: Vec<(String, usize)>,
    turn: CollectedTurn,
}

fn position(open: &[(String, usize)], id: &str) -> Option<usize> {
    open.iter().find(|(known, _)| known == id).map(|(_, at)| *at)
}

impl Collector {
    /// `upsertTextContentPart`: a part starts on the first piece that names it, and later metadata
    /// replaces earlier metadata.
    fn upsert(&mut self, is_text: bool, id: &str, delta: Option<&str>, metadata: Option<Value>) {
        let open = if is_text { &mut self.open_text } else { &mut self.open_reasoning };
        let at = match position(open, id) {
            Some(at) => at,
            None => {
                let at = self.parts.len();
                open.push((id.to_owned(), at));
                self.parts.push(if is_text {
                    Building::Text { text: String::new(), metadata: None }
                } else {
                    Building::Reasoning { text: String::new(), metadata: None }
                });
                at
            }
        };
        if let Building::Text { text, metadata: kept } | Building::Reasoning { text, metadata: kept } = &mut self.parts[at] {
            if let Some(delta) = delta {
                text.push_str(delta);
            }
            if metadata.is_some() {
                *kept = metadata;
            }
        }
    }

    fn close(&mut self, is_text: bool, id: &str) {
        let open = if is_text { &mut self.open_text } else { &mut self.open_reasoning };
        open.retain(|(known, _)| known != id);
    }

    fn take(&mut self, part: StreamPart) {
        match part {
            StreamPart::StreamStart { warnings } => self.turn.warnings.extend(warnings),
            StreamPart::ResponseMetadata { id, model_id, timestamp } => {
                self.turn.response_id = id.or(self.turn.response_id.take());
                self.turn.response_model_id = model_id.or(self.turn.response_model_id.take());
                self.turn.response_timestamp = timestamp.or(self.turn.response_timestamp.take());
            }
            StreamPart::TextStart { id, provider_metadata } => self.upsert(true, &id, None, provider_metadata),
            StreamPart::TextDelta { id, delta, provider_metadata } => self.upsert(true, &id, Some(&delta), provider_metadata),
            StreamPart::TextEnd { id, provider_metadata } => {
                self.upsert(true, &id, None, provider_metadata);
                self.close(true, &id);
            }
            StreamPart::ReasoningStart { id, provider_metadata } => self.upsert(false, &id, None, provider_metadata),
            StreamPart::ReasoningDelta { id, delta, provider_metadata } => self.upsert(false, &id, Some(&delta), provider_metadata),
            StreamPart::ReasoningEnd { id, provider_metadata } => {
                self.upsert(false, &id, None, provider_metadata);
                self.close(false, &id);
            }
            StreamPart::ToolCall { tool_call_id, tool_name, input, provider_metadata } => {
                let (parsed, input_is_valid) = parsed_input(&input);
                self.parts.push(Building::Call(CollectedToolCall {
                    tool_call_id,
                    tool_name,
                    raw_input: input,
                    input: parsed,
                    input_is_valid,
                    provider_metadata,
                }));
            }
            StreamPart::Finish { finish_reason, usage, provider_metadata } => {
                self.turn.finish_reason = Some(finish_reason);
                self.turn.usage = usage;
                self.turn.provider_metadata = provider_metadata;
            }
            StreamPart::Error { error } => self.turn.errors.push(error),
            StreamPart::ToolInputStart { .. }
            | StreamPart::ToolInputDelta { .. }
            | StreamPart::ToolInputEnd { .. }
            | StreamPart::Other(_) => {}
        }
    }

    fn finish(mut self) -> CollectedTurn {
        let mut text_all = String::new();
        let mut reasoning_all: Vec<String> = Vec::new();
        for part in self.parts {
            match part {
                Building::Text { text, metadata } => {
                    text_all.push_str(&text);
                    // An empty text part is dropped, whatever its metadata.
                    if !text.is_empty() {
                        self.turn.content.push(AssistantPart::Text { text, provider_options: provider_options(metadata) });
                    }
                }
                Building::Reasoning { text, metadata } => {
                    reasoning_all.push(text.clone());
                    self.turn.content.push(AssistantPart::Reasoning { text, provider_options: provider_options(metadata) });
                }
                Building::Call(call) => {
                    self.turn.content.push(AssistantPart::ToolCall {
                        tool_call_id: call.tool_call_id.clone(),
                        tool_name: call.tool_name.clone(),
                        input: call.input.clone(),
                        provider_options: provider_options(call.provider_metadata.clone()),
                    });
                    self.turn.tool_calls.push(call);
                }
            }
        }
        self.turn.text = text_all;
        self.turn.reasoning_text = (!reasoning_all.is_empty()).then(|| reasoning_all.concat());
        self.turn
    }
}

/// Reads a stream to its end and adds it up.
pub async fn collect_turn(mut stream: ModelStream) -> CollectedTurn {
    let mut collector = Collector::default();
    while let Some(part) = stream.next().await {
        collector.take(part);
    }
    collector.finish()
}

#[cfg(test)]
#[path = "collect_tests.rs"]
mod tests;
