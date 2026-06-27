use std::{
    env,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::task::JoinHandle;

use crate::error::{ApiError, ApiResult};

const DEFAULT_OPENAI_MODEL: &str = "gpt-5.5";

#[derive(Clone)]
pub struct AiService {
    state: Arc<Mutex<AiState>>,
    client: Client,
    next_session_id: Arc<AtomicU64>,
}

#[derive(Default)]
struct AiState {
    running: bool,
    session_id: Option<String>,
    events: Vec<AiStreamEvent>,
    last_error: Option<String>,
    task: Option<JoinHandle<()>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub configured: bool,
    pub provider: String,
    pub model: String,
    pub running: bool,
    pub session_id: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSendRequest {
    pub prompt: String,
    pub cwd: Option<String>,
    pub resume_session: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AiEventKind {
    System,
    Text,
    ToolUse,
    ToolResult,
    Result,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStreamEvent {
    pub kind: AiEventKind,
    pub session_id: Option<String>,
    pub text: String,
    pub tool_name: String,
    pub tool_input: String,
    pub tool_use_id: String,
    pub tool_result: String,
    pub cost_usd: f64,
}

impl AiStreamEvent {
    fn text(text: impl Into<String>) -> Self {
        Self {
            kind: AiEventKind::Text,
            text: text.into(),
            ..Self::empty()
        }
    }

    fn error(text: impl Into<String>) -> Self {
        Self {
            kind: AiEventKind::Error,
            text: text.into(),
            ..Self::empty()
        }
    }

    fn empty() -> Self {
        Self {
            kind: AiEventKind::System,
            session_id: None,
            text: String::new(),
            tool_name: String::new(),
            tool_input: String::new(),
            tool_use_id: String::new(),
            tool_result: String::new(),
            cost_usd: 0.0,
        }
    }
}

impl AiService {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(AiState::default())),
            client: Client::new(),
            next_session_id: Arc::new(AtomicU64::new(1)),
        }
    }

    pub fn status(&self) -> AiStatus {
        let state = self.state.lock().expect("ai state poisoned");
        let config = AiConfig::from_env();
        AiStatus {
            configured: config.configured(),
            provider: config.provider,
            model: config.model,
            running: state.running,
            session_id: state.session_id.clone(),
            error: state.last_error.clone(),
        }
    }

    pub fn send_message(&self, request: AiSendRequest) -> ApiResult<AiStatus> {
        let prompt = request.prompt.trim().to_owned();
        if prompt.is_empty() {
            return Err(ApiError::Message("AI prompt is empty.".to_owned()));
        }

        let config = AiConfig::from_env();
        config.validate()?;

        let cwd = request
            .cwd
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);

        let session_id = {
            let mut state = self.state.lock().expect("ai state poisoned");
            if state.running {
                return Err(ApiError::Message("MistyAI is already running a request.".to_owned()));
            }
            let session_id = if request.resume_session.unwrap_or(true) {
                state.session_id.clone().unwrap_or_else(|| self.new_session_id())
            } else {
                self.new_session_id()
            };
            state.events.clear();
            state.last_error = None;
            state.running = true;
            state.session_id = Some(session_id.clone());
            session_id
        };

        let client = self.client.clone();
        let state = self.state.clone();
        let task = tokio::spawn(async move {
            let result = send_openai_request(&client, &config, &prompt, cwd.as_deref()).await;
            let mut state = state.lock().expect("ai state poisoned");
            match result {
                Ok(text) => {
                    let mut event = AiStreamEvent::text(text);
                    event.session_id = Some(session_id);
                    state.events.push(event);
                }
                Err(error) => {
                    let message = error.to_string();
                    state.last_error = Some(message.clone());
                    state.events.push(AiStreamEvent::error(message));
                }
            }
            state.running = false;
            state.task = None;
        });

        {
            let mut state = self.state.lock().expect("ai state poisoned");
            state.task = Some(task);
        }

        Ok(self.status())
    }

    pub fn drain_events(&self) -> Vec<AiStreamEvent> {
        let mut state = self.state.lock().expect("ai state poisoned");
        let mut events = Vec::new();
        events.append(&mut state.events);
        events
    }

    pub fn abort(&self) -> ApiResult<AiStatus> {
        let task = {
            let mut state = self.state.lock().expect("ai state poisoned");
            state.task.take()
        };
        if let Some(task) = task {
            task.abort();
        }
        let mut state = self.state.lock().expect("ai state poisoned");
        state.running = false;
        state.events.push(AiStreamEvent::error("MistyAI request aborted."));
        drop(state);
        Ok(self.status())
    }

    fn new_session_id(&self) -> String {
        let id = self.next_session_id.fetch_add(1, Ordering::Relaxed);
        format!("misty-ai-{id}")
    }
}

#[derive(Clone)]
struct AiConfig {
    provider: String,
    model: String,
    api_key: Option<String>,
    base_url: String,
}

impl AiConfig {
    fn from_env() -> Self {
        let provider = env::var("MISTY_AI_PROVIDER")
            .ok()
            .map(|value| value.trim().to_lowercase())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "openai".to_owned());
        let model = env::var("MISTY_AI_MODEL")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_OPENAI_MODEL.to_owned());
        let api_key = env::var("OPENAI_API_KEY")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let base_url = env::var("MISTY_AI_BASE_URL")
            .ok()
            .map(|value| value.trim().trim_end_matches('/').to_owned())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "https://api.openai.com/v1".to_owned());
        Self {
            provider,
            model,
            api_key,
            base_url,
        }
    }

    fn configured(&self) -> bool {
        self.provider == "openai" && self.api_key.is_some()
    }

    fn validate(&self) -> ApiResult<()> {
        if self.provider != "openai" {
            return Err(ApiError::Message(format!(
                "Unsupported AI provider \"{}\". Set MISTY_AI_PROVIDER=openai.",
                self.provider
            )));
        }
        if self.api_key.is_none() {
            return Err(ApiError::Message(
                "MistyAI is not configured. Set OPENAI_API_KEY before starting Misty.".to_owned(),
            ));
        }
        Ok(())
    }
}

async fn send_openai_request(
    client: &Client,
    config: &AiConfig,
    prompt: &str,
    cwd: Option<&str>,
) -> ApiResult<String> {
    let system_prompt = [
        "You are MistyAI, an assistant inside Misty, a file manager.",
        "Help the user understand, search, plan, rename, organize, or troubleshoot files.",
        "Do not claim to have read file contents unless the user included them or Misty provided them.",
        "For destructive file actions, propose a reviewable plan instead of saying you performed the action.",
    ]
    .join(" ");
    let context = cwd
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!("Current folder: {value}"))
        .unwrap_or_else(|| "Current folder: none".to_owned());
    let request_body = json!({
        "model": config.model,
        "input": [
            {
                "role": "system",
                "content": [{ "type": "input_text", "text": system_prompt }]
            },
            {
                "role": "user",
                "content": [{ "type": "input_text", "text": format!("{context}\n\n{prompt}") }]
            }
        ]
    });

    let response = client
        .post(format!("{}/responses", config.base_url))
        .bearer_auth(config.api_key.as_deref().unwrap_or_default())
        .json(&request_body)
        .send()
        .await?;
    let status = response.status();
    let value: Value = response.json().await?;
    if !status.is_success() {
        return Err(ApiError::Message(openai_error_message(&value, status.as_u16())));
    }
    let text = openai_response_text(&value);
    if text.trim().is_empty() {
        return Err(ApiError::Message("OpenAI returned an empty response.".to_owned()));
    }
    Ok(text)
}

fn openai_error_message(value: &Value, status: u16) -> String {
    value
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .map(|message| format!("OpenAI request failed ({status}): {message}"))
        .unwrap_or_else(|| format!("OpenAI request failed with HTTP status {status}."))
}

fn openai_response_text(value: &Value) -> String {
    if let Some(text) = value.get("output_text").and_then(Value::as_str) {
        return text.to_owned();
    }
    value
        .get("output")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|item| {
            item.get("content")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter_map(|content| {
            content
                .get("text")
                .or_else(|| content.get("output_text"))
                .and_then(Value::as_str)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::openai_response_text;
    use serde_json::json;

    #[test]
    fn reads_openai_output_text_shortcut() {
        let value = json!({ "output_text": "Hello from MistyAI." });
        assert_eq!(openai_response_text(&value), "Hello from MistyAI.");
    }

    #[test]
    fn reads_openai_nested_output_content() {
        let value = json!({
            "output": [{
                "content": [
                    { "type": "output_text", "text": "One" },
                    { "type": "output_text", "text": "Two" }
                ]
            }]
        });
        assert_eq!(openai_response_text(&value), "One\nTwo");
    }
}
