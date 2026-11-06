//! A stand-in for the Misty server: its run routes, its tool service, and an OpenAI-compatible model.
use std::{
    collections::{HashSet, VecDeque},
    sync::{Arc, Mutex},
    time::Duration,
};

use serde_json::{json, Value};
use tokio::sync::Notify;

use super::{serve_fn, Captured, Reply};

/// What the stand-in answers, and what it saw.
#[derive(Default)]
pub struct Backend {
    pub seen: Mutex<Vec<Captured>>,
    /// One answer per model call, as SSE bodies.
    pub model: Mutex<VecDeque<String>>,
    /// Tool calls that never answer, the first time they're made.
    pub hang_on: Mutex<HashSet<String>>,
    /// Tool calls that wait for a device, the first time they're made.
    pub device_wait_on: Mutex<HashSet<String>>,
    /// Runs whose start receipt names a run already recorded.
    pub known_runtime_id: Mutex<Option<String>>,
    pub unclaimed: Mutex<bool>,
    arrived: Notify,
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

fn json_reply(value: Value) -> Reply {
    Reply::new(200, "application/json", value.to_string())
}

impl Backend {
    fn control(&self, action: &str, _body: &Value) -> Reply {
        match action {
            "start-receipt" => {
                if let Some(known) = self.known_runtime_id.lock().unwrap().clone() {
                    return json_reply(json!({ "claimed": false, "runtime_run_id": known }));
                }
                if *self.unclaimed.lock().unwrap() {
                    return json_reply(json!({ "claimed": false }));
                }
                json_reply(json!({ "claimed": true, "claim_token": "exclusive" }))
            }
            "context" => json_reply(json!({ "model_id": "ignored", "system": "You are Misty.", "prompt": "Write the two things.", "allowed_tools": ["task.write"] })),
            "steering" => json_reply(json!({ "messages": [], "closed": true })),
            "budget" => {
                let deadline = chrono_free_deadline();
                json_reply(json!({ "version": 1, "remaining_ms": 1_800_000, "active": true, "deadline": deadline }))
            }
            "mcp-token" => json_reply(json!({ "access_token": "bearer-1", "token_type": "Bearer", "expires_in": 300, "mcp_path": "/mcp", "protocol": "2026-07-28" })),
            _ => json_reply(json!({ "accepted": true })),
        }
    }

    async fn mcp(&self, request: &Captured) -> Reply {
        let id = request.body["id"].clone();
        let answer = |result: Value| json_reply(json!({ "jsonrpc": "2.0", "id": id, "result": result }));
        match request.body["method"].as_str().unwrap_or("") {
            "server/discover" => answer(json!({ "supportedVersions": ["2026-07-28"], "capabilities": { "tools": {} }, "serverInfo": { "name": "misty", "version": "1.0.0" } })),
            "tools/list" => answer(json!({ "tools": [{ "name": "task.write", "description": "Write a thing.", "inputSchema": { "type": "object", "properties": {} }, "annotations": { "readOnlyHint": false }, "_meta": { "misty/locality": "server" } }] })),
            "tools/call" => {
                let call_id = request.body["params"]["_meta"]["misty/call_id"].as_str().unwrap_or("").to_owned();
                if self.hang_on.lock().unwrap().remove(&call_id) {
                    futures_util::future::pending::<()>().await;
                }
                if self.device_wait_on.lock().unwrap().remove(&call_id) {
                    return answer(json!({ "content": [{ "type": "text", "text": "Waiting." }], "_meta": { "misty/device_wait": true } }));
                }
                answer(json!({ "content": [], "structuredContent": { "wrote": call_id } }))
            }
            other => panic!("unexpected MCP method {other}"),
        }
    }

    pub fn sent(&self, wanted: impl Fn(&Captured) -> bool) -> Vec<Captured> {
        self.seen.lock().unwrap().iter().filter(|request| wanted(request)).cloned().collect()
    }

    pub fn tool_call_ids(&self) -> Vec<String> {
        self.sent(|request| request.path == "/mcp" && request.body["method"] == "tools/call").iter().map(|request| request.body["params"]["_meta"]["misty/call_id"].as_str().unwrap().to_owned()).collect()
    }

    pub fn actions(&self, action: &str) -> Vec<Captured> {
        self.sent(|request| request.path.ends_with(&format!("/{action}")))
    }

    pub fn model_requests(&self) -> Vec<Captured> {
        self.sent(|request| request.path.ends_with("/chat/completions"))
    }

    /// Waits until the stand-in has seen a request `wanted` accepts.
    pub async fn until(&self, wanted: impl Fn(&Captured) -> bool) {
        for _ in 0..2000 {
            if self.seen.lock().unwrap().iter().any(&wanted) {
                return;
            }
            let _ = tokio::time::timeout(Duration::from_millis(5), self.arrived.notified()).await;
        }
        panic!("the expected request never came");
    }
}

/// An hour from now, as RFC 3339, without a clock library in the tests.
fn chrono_free_deadline() -> String {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64 + 3600;
    let (days, seconds) = (now.div_euclid(86_400), now.rem_euclid(86_400));
    // Civil-from-days, for the date part.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z", seconds / 3600, seconds / 60 % 60, seconds % 60)
}

pub async fn backend() -> (Arc<Backend>, String) {
    let state = Arc::new(Backend::default());
    let shared = state.clone();
    let base = serve_fn(move |request: Captured| {
        let state = shared.clone();
        async move {
            state.seen.lock().unwrap().push(request.clone());
            state.arrived.notify_waiters();
            if request.path == "/mcp" {
                return state.mcp(&request).await;
            }
            if request.path.ends_with("/chat/completions") {
                let next = state.model.lock().unwrap().pop_front().unwrap_or_else(finish_call);
                return Reply::new(200, "text/event-stream", next);
            }
            let action = request.path.rsplit('/').next().unwrap_or("").to_owned();
            state.control(&action, &request.body)
        }
    })
    .await;
    (state, base)
}
