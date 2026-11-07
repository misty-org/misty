//! A stand-in for the one thing a run reaches over the network here: an OpenAI-compatible model.
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

use serde_json::{json, Value};

use super::{serve_fn, Captured, Reply};

/// What the stand-in answers, and what it saw.
#[derive(Default)]
pub struct Backend {
    pub seen: Mutex<Vec<Captured>>,
    /// One answer per model call, as SSE bodies.
    pub model: Mutex<VecDeque<String>>,
}

fn sse(chunks: &[Value]) -> String {
    let mut body: String = chunks.iter().map(|chunk| format!("data: {chunk}\n\n")).collect();
    body.push_str("data: [DONE]\n\n");
    body
}

fn chunk(delta: Value, finish: Value) -> Value {
    json!({ "id": "c", "created": 1_790_000_000, "model": "m", "choices": [{ "index": 0, "delta": delta, "finish_reason": finish }], "usage": { "prompt_tokens": 5, "completion_tokens": 2 } })
}

/// A model answer that makes these calls: `(id, name, arguments)`.
pub fn calls(list: &[(&str, &str, &str)]) -> String {
    let parts: Vec<Value> = list
        .iter()
        .enumerate()
        .map(|(index, (id, name, arguments))| json!({ "index": index, "id": id, "type": "function", "function": { "name": name, "arguments": arguments } }))
        .collect();
    sse(&[chunk(json!({ "tool_calls": parts }), Value::Null), chunk(json!({}), json!("tool_calls"))])
}

pub fn finish_call() -> String {
    calls(&[("finish", "agent_finish", r#"{"outcome":"completed","summary":"All done.","remaining":[]}"#)])
}

impl Backend {
    pub fn model_requests(&self) -> Vec<Captured> {
        self.seen.lock().unwrap().iter().filter(|request| request.path.ends_with("/chat/completions")).cloned().collect()
    }

    /// Everything that reached the network and wasn't a model call.
    pub fn others(&self) -> Vec<Captured> {
        self.seen.lock().unwrap().iter().filter(|request| !request.path.ends_with("/chat/completions")).cloned().collect()
    }
}

pub async fn backend() -> (Arc<Backend>, String) {
    let state = Arc::new(Backend::default());
    let shared = state.clone();
    let base = serve_fn(move |request: Captured| {
        let state = shared.clone();
        async move {
            state.seen.lock().unwrap().push(request.clone());
            if request.path.ends_with("/chat/completions") {
                let next = state.model.lock().unwrap().pop_front().unwrap_or_else(finish_call);
                return Reply::new(200, "text/event-stream", next);
            }
            Reply::new(404, "application/json", "{}")
        }
    })
    .await;
    (state, base)
}
