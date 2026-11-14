//! A fake OpenAI-compatible provider on loopback for the keyed-provider live test: it checks
//! the bearer key and streams canned replies, tool calls and usage included, at no cost.

use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// Words in a prompt that pick the fake provider's reply.
pub(super) const TOOL_MARK: &str = "TOOLTURN";
pub(super) const SLOW_MARK: &str = "SLOWTURN";

/// What the fake provider saw of one request.
#[derive(Clone, Debug)]
pub(super) struct Seen {
    pub(super) authorization: Option<String>,
    pub(super) model: String,
    /// A turn's steps offer the agent's tools; the title call offers none.
    pub(super) tools: bool,
}

pub(super) struct FakeProvider {
    pub(super) base_url: String,
    pub(super) seen: Arc<std::sync::Mutex<Vec<Seen>>>,
}

/// An OpenAI-style `/v1/chat/completions` on loopback that turns away a request without
/// `Authorization: Bearer <key>` and streams a canned reply: a `read` of `notes` when the prompt
/// asks for a tool, the answer once the tool's result comes back, a slow count to stop mid-way,
/// else "pong". Every reply ends with usage, cached tokens included.
pub(super) async fn fake_provider(key: &'static str, notes: String) -> FakeProvider {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = format!("http://{}/v1", listener.local_addr().unwrap());
    let seen: Arc<std::sync::Mutex<Vec<Seen>>> = Arc::default();
    let log = Arc::clone(&seen);
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            tokio::spawn(answer(stream, key, notes.clone(), Arc::clone(&log)));
        }
    });
    FakeProvider { base_url, seen }
}

/// One request's head and body (the body by its `content-length`).
async fn read_request(stream: &mut TcpStream) -> Option<(String, Vec<u8>)> {
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 8192];
    let end = loop {
        if let Some(at) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
            break at;
        }
        let count = stream.read(&mut buffer).await.ok().filter(|n| *n > 0)?;
        bytes.extend_from_slice(&buffer[..count]);
    };
    let head = String::from_utf8_lossy(&bytes[..end]).to_string();
    let length = header(&head, "content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let mut body = bytes[end + 4..].to_vec();
    while body.len() < length {
        let count = stream.read(&mut buffer).await.ok().filter(|n| *n > 0)?;
        body.extend_from_slice(&buffer[..count]);
    }
    Some((head, body))
}

fn header(head: &str, name: &str) -> Option<String> {
    head.lines().skip(1).find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.trim()
            .eq_ignore_ascii_case(name)
            .then(|| value.trim().to_string())
    })
}

async fn answer(
    mut stream: TcpStream,
    key: &str,
    notes: String,
    seen: Arc<std::sync::Mutex<Vec<Seen>>>,
) {
    let Some((head, body)) = read_request(&mut stream).await else {
        return;
    };
    let request: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    let authorization = header(&head, "authorization");
    seen.lock().unwrap().push(Seen {
        authorization: authorization.clone(),
        model: request["model"].as_str().unwrap_or("").to_string(),
        tools: request["tools"].as_array().is_some_and(|t| !t.is_empty()),
    });
    if authorization.as_deref() != Some(format!("Bearer {key}").as_str()) {
        let refusal =
            r#"{"error":{"message":"Incorrect API key provided","type":"invalid_request_error"}}"#;
        let _ = stream
            .write_all(
                format!(
                    "HTTP/1.1 401 Unauthorized\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{refusal}",
                    refusal.len()
                )
                .as_bytes(),
            )
            .await;
        return;
    }
    let head = "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncache-control: no-cache\r\nconnection: close\r\n\r\n";
    if stream.write_all(head.as_bytes()).await.is_err() {
        return;
    }
    let chunk = |delta: Value, finish: Option<&str>| {
        json!({
            "id": "chatcmpl-fake", "object": "chat.completion.chunk", "created": 0,
            "model": request["model"],
            "choices": [{ "index": 0, "delta": delta, "finish_reason": finish }],
        })
    };
    let (deltas, finish) = reply(&request, &notes);
    let mut frames: Vec<(Value, u64)> = deltas
        .into_iter()
        .enumerate()
        .map(|(n, (mut delta, pause))| {
            if n == 0 {
                delta["role"] = json!("assistant");
            }
            (chunk(delta, None), pause)
        })
        .collect();
    frames.push((chunk(json!({}), Some(finish)), 0));
    frames.push((
        json!({
            "id": "chatcmpl-fake", "object": "chat.completion.chunk", "created": 0,
            "model": request["model"], "choices": [],
            "usage": { "prompt_tokens": 1000, "completion_tokens": 50, "total_tokens": 1050,
                       "prompt_tokens_details": { "cached_tokens": 400 } },
        }),
        0,
    ));
    for (frame, pause) in frames {
        if pause > 0 {
            tokio::time::sleep(Duration::from_millis(pause)).await;
        }
        // A stopped turn hangs up on the stream; the reply ends there.
        if stream
            .write_all(format!("data: {frame}\n\n").as_bytes())
            .await
            .is_err()
        {
            return;
        }
    }
    let _ = stream.write_all(b"data: [DONE]\n\n").await;
    let _ = stream.shutdown().await;
}

/// The reply's deltas, each with the pause before it, and how the choice finishes.
fn reply(request: &Value, notes: &str) -> (Vec<(Value, u64)>, &'static str) {
    let messages = request["messages"].as_array().cloned().unwrap_or_default();
    let last = messages.last().cloned().unwrap_or(Value::Null);
    let said = last["content"].to_string();
    let text = |text: &str| (json!({ "content": text }), 0);
    let naming = messages.first().is_some_and(|first| {
        first["role"] == "system"
            && first["content"]
                .to_string()
                .contains("You name conversations")
    });
    if naming {
        return (vec![text("Fake paid chat")], "stop");
    }
    if last["role"] == "tool" {
        let answer = if said.contains("hello") {
            "notes.txt says hello"
        } else {
            "the read failed"
        };
        return (vec![text(answer)], "stop");
    }
    if said.contains(TOOL_MARK) {
        let call = json!({ "tool_calls": [{ "index": 0, "id": "call_read_1", "type": "function",
            "function": { "name": "read", "arguments": "" } }] });
        let arguments = json!({ "path": notes }).to_string();
        let rest =
            json!({ "tool_calls": [{ "index": 0, "function": { "arguments": arguments } }] });
        return (vec![(call, 0), (rest, 0)], "tool_calls");
    }
    if said.contains(SLOW_MARK) {
        let count = (1..=400)
            .map(|n| (json!({ "content": format!("{n}\n") }), 40))
            .collect();
        return (count, "stop");
    }
    (vec![text("po"), text("ng")], "stop")
}
