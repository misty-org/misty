//! A local provider for device calls: it answers each request by what the request says, as a stream
//! of chat-completion events, and keeps each request's text so key order can be checked.
#![allow(dead_code)]

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use misty_agent::{
    runtime::device::{DeviceCalls, DeviceModels, DeviceRole},
    sdk::{parse_model_id, Credential, ModelError, ModelRoute, ProviderId},
};
use serde_json::{json, Value};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

pub struct Answer {
    pub status: u16,
    pub content_type: String,
    pub body: Vec<u8>,
}

impl Answer {
    pub fn json(status: u16, value: Value) -> Self {
        Self { status, content_type: "application/json".to_owned(), body: value.to_string().into_bytes() }
    }

    /// One chat completion as a stream: its text, or its tool calls.
    pub fn completion(message: &Value) -> Self {
        let mut events = Vec::new();
        let mut finish = "stop";
        if let Some(calls) = message.get("tool_calls").and_then(Value::as_array) {
            finish = "tool_calls";
            for (index, call) in calls.iter().enumerate() {
                let mut call = call.clone();
                call["index"] = json!(index);
                events.push(json!({ "id": "c", "created": 1_790_000_000, "model": "m", "choices": [{ "index": 0, "delta": { "tool_calls": [call] }, "finish_reason": null }] }));
            }
        } else if let Some(text) = message.get("content").and_then(Value::as_str) {
            events.push(json!({ "id": "c", "created": 1_790_000_000, "model": "m", "choices": [{ "index": 0, "delta": { "content": text }, "finish_reason": null }] }));
        }
        events.push(json!({ "id": "c", "created": 1_790_000_000, "model": "m", "choices": [{ "index": 0, "delta": {}, "finish_reason": finish }], "usage": { "prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7 } }));
        let mut body = String::new();
        for event in events {
            body.push_str(&format!("data: {event}\n\n"));
        }
        body.push_str("data: [DONE]\n\n");
        Self { status: 200, content_type: "text/event-stream".to_owned(), body: body.into_bytes() }
    }
}

#[derive(Clone, Debug)]
pub struct Seen {
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub text: String,
}

impl Seen {
    pub fn json(&self) -> Value {
        serde_json::from_str(&self.text).unwrap_or(Value::Null)
    }
}

pub struct Provider {
    pub base_url: String,
    pub seen: Arc<Mutex<Vec<Seen>>>,
}

impl Provider {
    pub fn requests(&self) -> Vec<Seen> {
        self.seen.lock().unwrap().clone()
    }
}

fn head_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n").map(|at| at + 4)
}

/// Serves until the test ends. `answer` hears each request.
pub async fn provider(answer: impl Fn(&Seen) -> Answer + Send + Sync + 'static) -> Provider {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = format!("http://{}/v1", listener.local_addr().unwrap());
    let seen: Arc<Mutex<Vec<Seen>>> = Arc::default();
    let log = seen.clone();
    let answer = Arc::new(answer);
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let log = log.clone();
            let answer = answer.clone();
            tokio::spawn(async move {
                let mut buffer = Vec::new();
                let mut chunk = [0u8; 8192];
                let end = loop {
                    if let Some(end) = head_end(&buffer) {
                        break end;
                    }
                    let read = socket.read(&mut chunk).await.unwrap_or(0);
                    if read == 0 {
                        return;
                    }
                    buffer.extend_from_slice(&chunk[..read]);
                };
                let head = String::from_utf8_lossy(&buffer[..end]).to_string();
                let mut lines = head.split("\r\n");
                let mut first = lines.next().unwrap_or("").split(' ');
                let method = first.next().unwrap_or("").to_owned();
                let path = first.next().unwrap_or("").to_owned();
                let mut headers = HashMap::new();
                for line in lines {
                    if let Some((name, value)) = line.split_once(':') {
                        headers.insert(name.trim().to_lowercase(), value.trim().to_owned());
                    }
                }
                let length: usize = headers.get("content-length").and_then(|value| value.parse().ok()).unwrap_or(0);
                while buffer.len() < end + length {
                    let read = socket.read(&mut chunk).await.unwrap_or(0);
                    if read == 0 {
                        break;
                    }
                    buffer.extend_from_slice(&chunk[..read]);
                }
                let text = String::from_utf8_lossy(&buffer[end..]).to_string();
                let request = Seen { method, path, headers, text };
                log.lock().unwrap().push(request.clone());
                let reply = answer(&request);
                let head = format!(
                    "HTTP/1.1 {} Status\r\ncontent-type: {}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                    reply.status,
                    reply.content_type,
                    reply.body.len()
                );
                let _ = socket.write_all(head.as_bytes()).await;
                let _ = socket.write_all(&reply.body).await;
                let _ = socket.shutdown().await;
            });
        }
    });
    Provider { base_url, seen }
}

/// A device's document of models and keys.
#[derive(Default)]
pub struct Device {
    pub models: HashMap<&'static str, String>,
    pub keys: HashMap<String, (String, Option<String>)>,
    pub reasoning: Option<String>,
}

impl Device {
    pub fn with_model(mut self, role: &'static str, model: &str) -> Self {
        self.models.insert(role, model.to_owned());
        self
    }

    pub fn with_key(mut self, provider: ProviderId, key: &str, base_url: &str) -> Self {
        self.keys.insert(provider.as_str().to_owned(), (key.to_owned(), Some(base_url.to_owned())));
        self
    }
}

impl DeviceModels for Device {
    fn model_id(&self, role: DeviceRole) -> Option<String> {
        let name = match role {
            DeviceRole::Agent => "agent",
            DeviceRole::Fast => "fast",
            DeviceRole::Embedding => "embedding",
            DeviceRole::Transcription => "transcription",
            DeviceRole::Speech => "speech",
        };
        self.models.get(name).cloned().or_else(|| (name == "fast").then(|| self.models.get("agent").cloned()).flatten())
    }

    fn route(&self, model_id: &str) -> Result<ModelRoute, ModelError> {
        let (provider, _) = parse_model_id(model_id)?;
        let (key, base_url) = self.keys.get(provider.as_str()).ok_or_else(|| ModelError::Setup {
            code: "model_key_needed",
            detail: "Add a model key in Settings → Models.".to_owned(),
        })?;
        Ok(ModelRoute {
            reasoning: self.reasoning.clone().or_else(|| Some("low".to_owned())),
            credential: Credential { provider, api_key: key.clone(), base_url: base_url.clone() },
        })
    }
}

pub fn client() -> reqwest::Client {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder().no_proxy().build().unwrap()
}

pub fn calls(device: Device) -> DeviceCalls {
    DeviceCalls::new(Arc::new(device), client())
}
