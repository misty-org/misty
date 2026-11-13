//! Runs with no server behind them. Everything a run used to ask the
//! server is answered here, behind the same `ControlPlane` and `ToolGateway` the loop already calls, so
//! the loop can't tell the difference and its tests still hold.
pub(crate) mod events;
pub(crate) mod planner;

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard, PoisonError},
};

use futures_util::future::BoxFuture;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{
    clock::now_ms,
    control_plane::{ControlPlane, RuntimeIdentity},
    js_json::JsValue,
    tool_gateway::{GatewayCall, ToolGateway},
    model_tools::CatalogTool,
    runtime_errors::RuntimeError,
    tool_execution::ToolExecutionResponse,
};

/// How long a run may work.
const EXECUTION_LIMIT_MS: i64 = 30 * 60_000;

/// What the app does for a local run.
pub trait LocalRunHost: Send + Sync {
    /// Tells whoever follows the run. `event` is what the chat's reducers read.
    fn publish(&self, run_id: &str, event: Value);
    /// Whether a write this run began has no known outcome.
    fn has_unconfirmed_effects<'a>(&'a self, run_id: &'a str) -> BoxFuture<'a, bool>;
}

/// Builds what a run starts from out of its request.
pub(crate) trait RunPlanner: Send + Sync {
    fn context(&self, request: &Value, device: &Value) -> Result<Value, RuntimeError>;
    fn catalog(&self, request: &Value) -> Vec<CatalogTool>;
    /// The chat's new running notes from what the run wrote.
    fn notes(&self, request: &Value, summary: &str, model: &str) -> Option<Value>;
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn value_of(value: &JsValue) -> Value {
    serde_json::from_str(&value.stringify()).unwrap_or(Value::Null)
}

fn js_of(value: &Value) -> Result<JsValue, RuntimeError> {
    JsValue::parse(&value.to_string()).ok_or_else(|| RuntimeError::error("local_run_unreadable"))
}

/// The run requests hold the person's prompts, so only they can read them, as with the run store.
fn create_private_dir(folder: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(folder)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(folder, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn write_private(path: &std::path::Path, text: &[u8]) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::{io::Write, os::unix::fs::{OpenOptionsExt, PermissionsExt}};
        let mut file = std::fs::OpenOptions::new().create(true).write(true).truncate(true).mode(0o600).open(path)?;
        // A file an earlier version left readable is tightened too.
        file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        return file.write_all(text);
    }
    #[cfg(not(unix))]
    std::fs::write(path, text)
}

/// A run's request and when its clock started, kept on disk so a restart can pick it up.
#[derive(Clone, Deserialize, Serialize)]
struct SavedRequest {
    body: Value,
    #[serde(default)]
    started_ms: Option<i64>,
}

#[derive(Default)]
struct Live {
    /// Each message with the id its `user.steering` event had, which the chat matches it by.
    steering: Vec<(String, String)>,
    paused: bool,
    closed: bool,
    /// The prompt, to check an answer doesn't repeat it.
    prompt: String,
    published: u64,
}

pub(crate) struct LocalControlPlane {
    pub(crate) host: Arc<dyn LocalRunHost>,
    pub(crate) planner: Arc<dyn RunPlanner>,
    folder: PathBuf,
    live: Mutex<HashMap<String, Live>>,
}

impl LocalControlPlane {
    pub(crate) fn new(host: Arc<dyn LocalRunHost>, planner: Arc<dyn RunPlanner>, data_dir: &std::path::Path) -> std::io::Result<Self> {
        let folder = data_dir.join("run-requests");
        create_private_dir(&folder)?;
        Ok(Self { host, planner, folder, live: Mutex::default() })
    }

    /// The request a run was started with, as it was saved. Nobody can change a run's mode through it
    /// once it's going: only a new tab's contexts are ever written back.
    pub(crate) fn saved_body(&self, run_id: &str) -> Option<Value> {
        self.saved(run_id).ok().map(|saved| saved.body)
    }

    /// The runs whose requests are still saved: those that can still resume.
    pub(crate) fn saved_runs(&self) -> Vec<String> {
        let Ok(entries) = std::fs::read_dir(&self.folder) else { return Vec::new() };
        entries.flatten().filter_map(|entry| entry.file_name().to_str()?.strip_suffix(".json").map(str::to_owned)).collect()
    }

    fn path(&self, run_id: &str) -> PathBuf {
        self.folder.join(format!("{run_id}.json"))
    }

    pub(crate) fn save_request(&self, run_id: &str, body: Value) -> Result<(), RuntimeError> {
        let text = serde_json::to_vec(&SavedRequest { body, started_ms: None }).map_err(|_| RuntimeError::error("local_run_unreadable"))?;
        write_private(&self.path(run_id), &text).map_err(|_| RuntimeError::error("run_store_failed: the run could not be saved"))
    }

    fn saved(&self, run_id: &str) -> Result<SavedRequest, RuntimeError> {
        let text = std::fs::read(self.path(run_id)).map_err(|_| RuntimeError::error("local_run_missing"))?;
        serde_json::from_slice(&text).map_err(|_| RuntimeError::error("local_run_unreadable"))
    }

    pub(crate) fn update_contexts(&self, run_id: &str, contexts: Value) -> Result<(), RuntimeError> {
        let mut saved = self.saved(run_id)?;
        saved.body["device_contexts"] = contexts;
        let text = serde_json::to_vec(&saved).map_err(|_| RuntimeError::error("local_run_unreadable"))?;
        write_private(&self.path(run_id), &text).map_err(|_| RuntimeError::error("run_store_failed: the run could not be saved"))
    }

    fn forget(&self, run_id: &str) {
        let _ = std::fs::remove_file(self.path(run_id));
        locked(&self.live).remove(run_id);
    }

    pub(crate) fn publish(&self, run_id: &str, mut event: Value) -> String {
        let number = {
            let mut live = locked(&self.live);
            let run = live.entry(run_id.to_owned()).or_default();
            run.published += 1;
            run.published
        };
        let id = format!("{run_id}:{number}");
        event["id"] = json!(id);
        event["runId"] = json!(run_id);
        self.host.publish(run_id, event);
        id
    }

    /// The person wrote to a run in progress: the id its message goes by, or nothing when it has
    /// stopped listening.
    pub(crate) fn steer(&self, run_id: &str, text: &str) -> Option<String> {
        if locked(&self.live).get(run_id).is_some_and(|run| run.closed) {
            return None;
        }
        let id = self.publish(run_id, json!({ "type": "user.steering", "text": text }));
        locked(&self.live).entry(run_id.to_owned()).or_default().steering.push((text.to_owned(), id.clone()));
        Some(id)
    }

    /// The person took the run's window, or gave it back.
    pub(crate) fn set_paused(&self, run_id: &str, paused: bool) {
        locked(&self.live).entry(run_id.to_owned()).or_default().paused = paused;
    }

    pub(crate) fn cancelled(&self, run_id: &str) {
        self.publish(run_id, json!({ "type": "invocation.canceled", "state": "canceled" }));
        self.forget(run_id);
    }

    fn budget(&self, run_id: &str) -> Result<Value, RuntimeError> {
        let mut saved = self.saved(run_id)?;
        let now = now_ms();
        let started = match saved.started_ms {
            Some(started) => started,
            None => {
                saved.started_ms = Some(now);
                let text = serde_json::to_vec(&saved).map_err(|_| RuntimeError::error("local_run_unreadable"))?;
                write_private(&self.path(run_id), &text).map_err(|_| RuntimeError::error("run_store_failed: the run could not be saved"))?;
                now
            }
        };
        let deadline = started + EXECUTION_LIMIT_MS;
        let text = chrono::DateTime::from_timestamp_millis(deadline).map(|at| at.to_rfc3339()).unwrap_or_default();
        Ok(json!({ "version": 1, "remaining_ms": deadline - now, "active": true, "deadline": text }))
    }

    fn steering(&self, run_id: &str, payload: &Value) -> Value {
        // A message that arrives as the run tries to finish keeps it going, and so does a pause.
        let (messages, paused, closing) = {
            let mut live = locked(&self.live);
            let run = live.entry(run_id.to_owned()).or_default();
            let messages = std::mem::take(&mut run.steering);
            let closing = payload.get("close").and_then(Value::as_bool).unwrap_or(false) && messages.is_empty() && !run.paused && !run.closed;
            run.closed |= closing;
            (messages, run.paused, closing)
        };
        let messages: Vec<Value> = messages.into_iter().map(|(text, sequence)| json!({ "text": text, "sequence": sequence })).collect();
        if !messages.is_empty() {
            self.publish(run_id, json!({ "type": "steering.received", "messages": messages, "closed": false }));
        }
        if closing {
            self.publish(run_id, json!({ "type": "steering.closed", "messages": [], "closed": true }));
        }
        json!({ "messages": messages, "paused": paused })
    }

    fn context(&self, run_id: &str, device: &Value) -> Result<Value, RuntimeError> {
        let context = self.planner.context(&self.saved(run_id)?.body, device)?;
        let prompt = context.get("prompt").and_then(Value::as_str).unwrap_or("").to_owned();
        locked(&self.live).entry(run_id.to_owned()).or_default().prompt = prompt;
        Ok(context)
    }

    async fn complete(&self, run_id: &str, body: &Value) -> Value {
        let text = |name: &str| body.get(name).and_then(Value::as_str).unwrap_or("");
        let request = self.saved(run_id).map(|saved| saved.body).unwrap_or(Value::Null);
        let unconfirmed = text("status") == "success" && self.host.has_unconfirmed_effects(run_id).await;
        let notes = if text("summary").is_empty() { None } else { self.planner.notes(&request, text("summary"), text("model")) };
        let prompt = locked(&self.live).get(run_id).map(|run| run.prompt.clone()).unwrap_or_default();
        let ending = events::Ending {
            status: text("status"),
            text: text("text"),
            error_code: text("error_code"),
            prompt: &prompt,
            unconfirmed,
            artifact: wants_artifact(&request),
            title: text("title"),
            notes: notes.as_ref(),
        };
        for event in events::ending_events(&ending) {
            self.publish(run_id, event);
        }
        self.forget(run_id);
        json!({ "run_id": run_id })
    }

    pub(crate) fn catalog(&self, run_id: &str) -> Result<Vec<CatalogTool>, RuntimeError> {
        Ok(self.planner.catalog(&self.saved(run_id)?.body))
    }
}

/// Whether the app builds a reviewable proposal from this run's answer.
fn wants_artifact(request: &Value) -> bool {
    let text = |name: &str| request.get(name).and_then(Value::as_str).unwrap_or("").trim();
    !text("requested_artifact_kind").is_empty()
        || (request.get("selection").is_some_and(|selection| !selection.is_null()) && text("surface_id").starts_with("notes"))
}

impl ControlPlane for LocalControlPlane {
    fn request<'a>(&'a self, identity: &'a RuntimeIdentity, action: &'static str, payload: JsValue, _idempotency_key: String) -> BoxFuture<'a, Result<JsValue, RuntimeError>> {
        Box::pin(async move {
            let run_id = identity.misty_run_id.as_str();
            let payload = value_of(&payload);
            let answer = match action {
                "activate" => {
                    self.publish(run_id, json!({ "type": "invocation.started", "state": "running" }));
                    self.publish(run_id, json!({ "type": "assistant.status", "phase": "thinking" }));
                    json!({})
                }
                "context" => self.context(run_id, &payload)?,
                "budget" => self.budget(run_id)?,
                "steering" => self.steering(run_id, &payload),
                "events" => {
                    for event in events::checkpoint_events(&payload) {
                        self.publish(run_id, event);
                    }
                    json!({ "accepted": true })
                }
                "complete" => self.complete(run_id, &payload).await,
                _ => return Err(RuntimeError::error("local_run_unknown_action")),
            };
            js_of(&answer)
        })
    }
}

/// The loop's tool service for a local run: the catalog comes from here, and a tool the computer
/// doesn't run is simply unavailable, never sent anywhere.
pub(crate) struct LocalGateway {
    pub(crate) control: Arc<LocalControlPlane>,
}

impl ToolGateway for LocalGateway {
    fn discover<'a>(&'a self, identity: &'a RuntimeIdentity) -> BoxFuture<'a, Result<Vec<CatalogTool>, RuntimeError>> {
        Box::pin(async move { self.control.catalog(&identity.misty_run_id) })
    }

    fn call<'a>(&'a self, _call: GatewayCall<'a>) -> BoxFuture<'a, Result<ToolExecutionResponse, RuntimeError>> {
        Box::pin(async { Ok(ToolExecutionResponse::tool_error("tool_unavailable", "That tool is not available on this computer.")) })
    }
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
