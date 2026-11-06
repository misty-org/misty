//! Follows tool calls as they stream in pieces. Ported from the Vercel AI SDK's
//! `StreamingToolCallTracker`.
use std::collections::HashMap;

use serde_json::{json, Value};

use super::stream::StreamPart;

/// One piece of a streaming tool call.
#[derive(Default)]
pub(crate) struct ToolCallDelta {
    pub index: Option<u64>,
    pub id: Option<String>,
    pub name: Option<String>,
    pub arguments: Option<String>,
    pub metadata: Option<Value>,
}

struct TrackedCall {
    id: String,
    name: String,
    arguments: String,
    finished: bool,
    metadata: Option<Value>,
}

#[derive(Default)]
pub(crate) struct ToolCallTracker {
    calls: Vec<TrackedCall>,
    by_id: HashMap<String, usize>,
    by_index: HashMap<u64, usize>,
    latest: Option<usize>,
}

impl ToolCallTracker {
    /// Takes a piece, emitting the parts it completes. A piece that can't belong to anything is an
    /// invalid response, reported as the error part it returns.
    pub(crate) fn process(&mut self, delta: ToolCallDelta, out: &mut Vec<StreamPart>) -> Result<(), Value> {
        let known = match (&delta.id, delta.index) {
            (Some(id), _) if !id.is_empty() => self.by_id.get(id).copied(),
            (_, Some(index)) => self.by_index.get(&index).copied(),
            _ => self.latest,
        };
        let index = delta.index;
        let call = match known {
            Some(call) => {
                self.extend(call, delta, out);
                call
            }
            None => self.begin(delta, out)?,
        };
        if let Some(index) = index {
            self.by_index.insert(index, call);
        }
        self.latest = Some(call);
        Ok(())
    }

    /// Finishes every call still open, at the end of the stream.
    pub(crate) fn flush(&mut self, out: &mut Vec<StreamPart>) {
        for call in &mut self.calls {
            if call.finished {
                continue;
            }
            call.finished = true;
            out.push(StreamPart::ToolInputEnd { id: call.id.clone() });
            out.push(StreamPart::ToolCall {
                tool_call_id: call.id.clone(),
                tool_name: call.name.clone(),
                input: call.arguments.clone(),
                provider_metadata: call.metadata.clone(),
            });
        }
    }

    fn begin(&mut self, delta: ToolCallDelta, out: &mut Vec<StreamPart>) -> Result<usize, Value> {
        let invalid = |message: &str| {
            json!({ "name": "AI_InvalidResponseDataError", "message": message })
        };
        let id = delta.id.ok_or_else(|| invalid("Expected 'id' to be a string."))?;
        let name = delta
            .name
            .ok_or_else(|| invalid("Expected 'function.name' to be a string."))?;
        out.push(StreamPart::ToolInputStart {
            id: id.clone(),
            tool_name: name.clone(),
        });
        let arguments = delta.arguments.unwrap_or_default();
        if !arguments.is_empty() {
            out.push(StreamPart::ToolInputDelta {
                id: id.clone(),
                delta: arguments.clone(),
            });
        }
        let position = self.calls.len();
        if !id.is_empty() {
            self.by_id.insert(id.clone(), position);
        }
        self.calls.push(TrackedCall {
            id,
            name,
            arguments,
            finished: false,
            metadata: delta.metadata,
        });
        Ok(position)
    }

    fn extend(&mut self, position: usize, delta: ToolCallDelta, out: &mut Vec<StreamPart>) {
        let call = &mut self.calls[position];
        if call.finished {
            return;
        }
        if let Some(arguments) = delta.arguments {
            call.arguments.push_str(&arguments);
            out.push(StreamPart::ToolInputDelta {
                id: call.id.clone(),
                delta: arguments,
            });
        }
    }
}
