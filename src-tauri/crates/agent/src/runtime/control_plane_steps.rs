//! Durable run lifecycle calls. Each is one idempotent step. Ported from `control-plane-steps.ts`.
use super::{
    control_plane::{ControlPlane, RuntimeIdentity},
    device::DeviceRole,
    js_json::JsValue,
    model_budget::ExecutionBudget,
    run::{deps::RunDevice, step::{step, DEFAULT_STEP_RETRIES}},
    runtime_errors::{rethrow_step_error, RuntimeError, StepFailure},
    tool_transport::{object, string, HarnessCheckpoint},
};

/// How a run ended, as the server records it (`HarnessCompletion`).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct HarnessCompletion {
    pub(crate) status: &'static str,
    pub(crate) text: String,
    pub(crate) usage: Option<JsValue>,
    pub(crate) error_code: Option<String>,
    pub(crate) error_message: Option<String>,
}

impl HarnessCompletion {
    pub(crate) fn success(text: impl Into<String>) -> Self {
        Self { status: "success", text: text.into(), usage: None, error_code: None, error_message: None }
    }

    pub(crate) fn ended(status: &'static str, text: impl Into<String>, code: &str, message: &str) -> Self {
        Self { status, text: text.into(), usage: None, error_code: Some(code.to_owned()), error_message: Some(message.to_owned()) }
    }

    fn fields(&self) -> Vec<(String, JsValue)> {
        let mut fields = vec![("status".to_owned(), string(self.status)), ("text".to_owned(), string(self.text.as_str()))];
        if let Some(usage) = &self.usage {
            fields.push(("usage".to_owned(), usage.clone()));
        }
        if let Some(code) = &self.error_code {
            fields.push(("error_code".to_owned(), string(code.as_str())));
        }
        if let Some(message) = &self.error_message {
            fields.push(("error_message".to_owned(), string(message.as_str())));
        }
        fields
    }
}

fn request_step_failure(error: RuntimeError) -> StepFailure {
    rethrow_step_error(error)
}

pub(crate) async fn activate_runtime(control: &dyn ControlPlane, identity: &RuntimeIdentity) -> Result<(), RuntimeError> {
    let key = format!("{}:activate", identity.misty_run_id);
    step("activateRuntime", DEFAULT_STEP_RETRIES, || async {
        control.request(identity, "activate", object([("runtime_kind", string("vercel-workflow"))]), key.clone()).await.map_err(request_step_failure)
    })
    .await
    .map(|_| ())
}

/// The run thinks on the device's models; the server learns which, to show them and size the context
/// window. So is its web search: with a search key the device runs web.search itself, and tells the
/// server so the run's prompt describes it. The run's file keeps the answer, so a resumed run keeps
/// the models it started with.
pub(crate) async fn fetch_context(control: &dyn ControlPlane, device: &dyn RunDevice, identity: &RuntimeIdentity) -> Result<JsValue, RuntimeError> {
    let Some(model) = device.model_id(DeviceRole::Agent) else {
        return Err(RuntimeError::named("FatalError", "model_key_needed: Add a model key in Settings → Models."));
    };
    let reasoning = device.reasoning();
    let search = device.search_provider();
    let tools: Vec<JsValue> = if search.is_some() { vec![string("web.search"), string("web.fetch")] } else { vec![string("web.fetch")] };
    let payload = object([
        ("model_id", string(model.as_str())),
        ("vision_model_id", string(model.as_str())),
        ("reasoning_effort", string(reasoning.as_str())),
        ("device_tools", JsValue::Array(tools)),
    ]);
    let key = format!("{}:context", identity.misty_run_id);
    let context = step("fetchContext", DEFAULT_STEP_RETRIES, || async {
        control.request(identity, "context", payload.clone(), key.clone()).await.map_err(request_step_failure)
    })
    .await?;
    let mut merged = context.with_field("model_id", string(model.as_str())).with_field("vision_model_id", string(model.as_str())).with_field("reasoning_effort", string(reasoning));
    if let Some(search) = search {
        merged = merged.with_field("device_search", string(search.name()));
    }
    Ok(merged)
}

/// What the person sent since the last boundary, and whether they've taken the window.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Steering {
    pub(crate) messages: Vec<String>,
    pub(crate) paused: bool,
}

pub(crate) async fn take_steering(control: &dyn ControlPlane, identity: &RuntimeIdentity, boundary: &str, close: bool) -> Result<Steering, RuntimeError> {
    let payload = object([("boundary", string(boundary)), ("close", JsValue::Bool(close))]);
    let key = format!("{}:steering:{boundary}", identity.misty_run_id);
    let answer = step("takeSteering", DEFAULT_STEP_RETRIES, || async {
        control.request(identity, "steering", payload.clone(), key.clone()).await.map_err(request_step_failure)
    })
    .await?;
    let messages = answer.get("messages").and_then(JsValue::as_array).unwrap_or_default().iter().filter_map(|message| message.get("text")?.as_str().map(str::to_owned)).collect();
    let paused = !matches!(answer.get("paused"), None | Some(JsValue::Null | JsValue::Bool(false)));
    Ok(Steering { messages, paused })
}

pub(crate) async fn fetch_execution_budget(control: &dyn ControlPlane, identity: &RuntimeIdentity, turn: i64) -> Result<ExecutionBudget, RuntimeError> {
    let key = format!("{}:budget:{turn}", identity.misty_run_id);
    let answer = step("fetchExecutionBudget", DEFAULT_STEP_RETRIES, || async {
        control.request(identity, "budget", object([("begin", JsValue::Bool(true))]), key.clone()).await.map_err(request_step_failure)
    })
    .await?;
    // A malformed budget reads as an absent one, and `model_timeout` refuses it.
    Ok(serde_json::from_str(&answer.stringify()).unwrap_or_default())
}

/// `{ attempt: 1, output: {}, ...event }`.
pub(crate) fn event_body(event: &JsValue) -> JsValue {
    let mut body = object([("attempt", JsValue::Number(1.0)), ("output", JsValue::Object(Vec::new()))]);
    if let JsValue::Object(fields) = event {
        for (name, value) in fields {
            body = body.with_field(name, value.clone());
        }
    }
    body
}

pub(crate) async fn checkpoint(control: &dyn ControlPlane, identity: &RuntimeIdentity, event: &HarnessCheckpoint) -> Result<(), RuntimeError> {
    let body = event_body(&event.to_json());
    let key = format!("{}:event:{}:{}", identity.misty_run_id, event.node_id, event.state.as_str());
    step("checkpoint", DEFAULT_STEP_RETRIES, || async {
        control.request(identity, "events", body.clone(), key.clone()).await.map_err(request_step_failure)
    })
    .await
    .map(|_| ())
}

/// A new chat is named, and a long chat's aged-out turns become notes, on the device's fast model. A
/// run never fails for either.
pub(crate) async fn complete(
    control: &dyn ControlPlane,
    device: &dyn RunDevice,
    identity: &RuntimeIdentity,
    result: &HarnessCompletion,
    title_prompt: Option<&str>,
    summary_request: Option<&(String, String)>,
) -> Result<(), RuntimeError> {
    let done = result.status == "success";
    let title = match title_prompt.filter(|_| done) {
        Some(prompt) => device.title_for(prompt, &result.text).await.unwrap_or_default(),
        None => String::new(),
    };
    let summary = match summary_request.filter(|_| done) {
        Some((previous, turns)) => device.summary_for(previous, turns).await.unwrap_or_default(),
        None => String::new(),
    };
    let mut fields = result.fields();
    if !title.is_empty() {
        fields.push(("title".to_owned(), string(title)));
    }
    if !summary.is_empty() {
        fields.push(("summary".to_owned(), string(summary)));
        if let Some(model) = device.model_id(DeviceRole::Agent) {
            fields.push(("model".to_owned(), string(model)));
        }
    }
    let body = JsValue::Object(fields);
    let key = format!("{}:complete", identity.misty_run_id);
    step("complete", DEFAULT_STEP_RETRIES, || async {
        control.request(identity, "complete", body.clone(), key.clone()).await.map_err(request_step_failure)
    })
    .await
    .map(|_| ())
}
