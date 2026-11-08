//! A run with everything outside the loop faked: whoever follows the run, its tools and the model, each
//! answering from a script and keeping what it was asked.
use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::{
        atomic::{AtomicI64, Ordering},
        Arc, Mutex,
    },
};

use futures_util::{future::BoxFuture, stream};
use serde_json::json;

use crate::control_plane::{ControlPlane, RuntimeIdentity};
use crate::device::DeviceRole;
use crate::device_hooks::DeviceHooks;
use crate::js_json::JsValue;
use crate::logger::Logger;
use crate::tool_gateway::{GatewayCall, ToolGateway};
use crate::model_access::fixtures::FakeModel;
use crate::model_access::ModelAccess;
use crate::model_tools::CatalogTool;
use crate::runtime_errors::RuntimeError;
use crate::tool_execution::ToolExecutionResponse;
use crate::web_search::search_step::{DeviceSearch, SearchEndpoints, WebSearchCache};
use crate::model_calls::{prepare_call, CallOptions, FinishReason, InputTokens, ModelError, ModelStream, OutputTokens, RawJson, StreamPart, Usage};

use super::{
    deps::{RunDeps, RunDevice, TurnModels},
    run_start::new_stored,
    space_task_agent::{run_space_task_agent, RunResult},
    store::{RunStore, StoredRun},
};

pub(super) type Answer = Result<JsValue, RuntimeError>;

pub(super) fn json(text: &str) -> JsValue {
    JsValue::parse(text).unwrap()
}

/// `{"version":1,...}`: time enough for any turn.
pub(super) fn budget_json(now: i64, remaining_ms: i64) -> JsValue {
    let deadline = chrono::DateTime::from_timestamp_millis(now + remaining_ms).unwrap().to_rfc3339();
    json(&format!(r#"{{"version":1,"remaining_ms":{remaining_ms},"active":true,"deadline":"{deadline}"}}"#))
}

pub(super) struct FakeControl {
    pub(super) context: Mutex<String>,
    pub(super) calls: Mutex<Vec<(String, JsValue, String)>>,
    pub(super) steering: Mutex<VecDeque<JsValue>>,
    #[allow(clippy::type_complexity)]
    pub(super) intercept: Mutex<Option<Box<dyn Fn(&str, &JsValue) -> Option<Answer> + Send + Sync>>>,
    pub(super) clock: Arc<AtomicI64>,
    pub(super) budget_ms: Mutex<i64>,
}

impl FakeControl {
    pub(super) fn completions(&self) -> Vec<JsValue> {
        self.calls.lock().unwrap().iter().filter(|(action, ..)| action == "complete").map(|(_, body, _)| body.clone()).collect()
    }

    pub(super) fn nodes(&self, state: &str) -> Vec<String> {
        let calls = self.calls.lock().unwrap();
        calls
            .iter()
            .filter(|(action, body, _)| action == "events" && body.get("state").and_then(JsValue::as_str) == Some(state))
            .filter_map(|(_, body, _)| body.get("node_id")?.as_str().map(str::to_owned))
            .filter(|node| node.starts_with("model:"))
            .collect()
    }
}

impl ControlPlane for FakeControl {
    fn request<'a>(&'a self, _: &'a RuntimeIdentity, action: &'static str, payload: JsValue, key: String) -> BoxFuture<'a, Result<JsValue, RuntimeError>> {
        Box::pin(async move {
            self.calls.lock().unwrap().push((action.to_owned(), payload.clone(), key));
            if let Some(intercept) = self.intercept.lock().unwrap().as_ref() {
                if let Some(answer) = intercept(action, &payload) {
                    return answer;
                }
            }
            Ok(match action {
                "context" => json(&self.context.lock().unwrap()),
                "steering" => {
                    let closing = payload.get("close") == Some(&JsValue::Bool(true));
                    let next = if closing { self.steering.lock().unwrap().pop_front() } else { None };
                    next.unwrap_or_else(|| json(r#"{"messages":[],"closed":true}"#))
                }
                "budget" => budget_json(self.clock.load(Ordering::SeqCst), *self.budget_ms.lock().unwrap()),
                _ => json(r#"{"accepted":true}"#),
            })
        })
    }
}

#[derive(Default)]
pub(super) struct FakeGateway {
    pub(super) catalog: Mutex<Vec<CatalogTool>>,
    pub(super) executed: Mutex<Vec<(String, String, String, String)>>,
    /// Calls that never come back, the first time they're made.
    pub(super) hang_on: Mutex<Vec<String>>,
    #[allow(clippy::type_complexity)]
    pub(super) answer: Mutex<Option<Box<dyn Fn(&str, &str) -> ToolExecutionResponse + Send + Sync>>>,
}

impl ToolGateway for FakeGateway {
    fn discover<'a>(&'a self, _: &'a RuntimeIdentity) -> BoxFuture<'a, Result<Vec<CatalogTool>, RuntimeError>> {
        Box::pin(async move { Ok(self.catalog.lock().unwrap().clone()) })
    }

    fn call<'a>(&'a self, call: GatewayCall<'a>) -> BoxFuture<'a, Result<ToolExecutionResponse, RuntimeError>> {
        Box::pin(async move {
            self.executed.lock().unwrap().push((call.call_id.to_owned(), call.name.to_owned(), call.input.stringify(), call.device_hook_token.to_owned()));
            let hang = {
                let mut hang_on = self.hang_on.lock().unwrap();
                let found = hang_on.iter().position(|id| id == call.call_id);
                found.map(|at| hang_on.remove(at)).is_some()
            };
            if hang {
                futures_util::future::pending::<()>().await;
            }
            let answer = self.answer.lock().unwrap();
            let answer = answer.as_ref().expect("the test says what tools return");
            Ok(answer(call.call_id, call.name))
        })
    }
}

pub(super) struct FakeDevice;

impl RunDevice for FakeDevice {
    fn model_id(&self, _: DeviceRole) -> Option<String> {
        Some("fixture/model".to_owned())
    }

    fn reasoning(&self) -> String {
        "low".to_owned()
    }

    fn search(&self) -> Option<DeviceSearch> {
        None
    }

    fn title_for<'a>(&'a self, _: &'a str, _: &'a str) -> BoxFuture<'a, Result<String, String>> {
        Box::pin(async { Ok("A title".to_owned()) })
    }

    fn summary_for<'a>(&'a self, _: &'a str, _: &'a str) -> BoxFuture<'a, Result<String, String>> {
        Box::pin(async { Ok(String::new()) })
    }
}

/// One model turn of a script.
#[derive(Clone)]
pub(super) enum Turn {
    Parts(Vec<StreamPart>),
    /// A call that fails the same way every try.
    Fails(String),
    /// A stream that never answers.
    Hangs,
}

#[derive(Default)]
pub(super) struct FakeModels {
    pub(super) script: Mutex<VecDeque<Turn>>,
    /// Said once the script is over.
    pub(super) after: Mutex<Option<Turn>>,
    pub(super) calls: Mutex<Vec<CallOptions>>,
    #[allow(clippy::type_complexity)]
    pub(super) on_call: Mutex<Option<Box<dyn Fn() + Send + Sync>>>,
}

impl TurnModels for FakeModels {
    fn stream<'a>(&'a self, _: &'a str, options: CallOptions, _: u32, _: bool) -> BoxFuture<'a, Result<ModelStream, ModelError>> {
        Box::pin(async move {
            self.calls.lock().unwrap().push(prepare_call(options)?);
            if let Some(on_call) = self.on_call.lock().unwrap().as_ref() {
                on_call();
            }
            let next = self.script.lock().unwrap().pop_front().or_else(|| self.after.lock().unwrap().clone()).expect("the script ran out");
            match next {
                Turn::Parts(parts) => Ok(Box::pin(stream::iter(parts)) as ModelStream),
                Turn::Fails(message) => Err(ModelError::Api { status: 500, message, retryable: false, retry_after_ms: None }),
                Turn::Hangs => Ok(Box::pin(stream::pending()) as ModelStream),
            }
        })
    }
}

pub(super) fn text(id: &str, delta: &str) -> Vec<StreamPart> {
    vec![
        StreamPart::TextStart { id: id.to_owned(), provider_metadata: None },
        StreamPart::TextDelta { id: id.to_owned(), delta: delta.to_owned(), provider_metadata: None },
        StreamPart::TextEnd { id: id.to_owned(), provider_metadata: None },
    ]
}

pub(super) fn call(id: &str, name: &str, input: &str) -> StreamPart {
    StreamPart::ToolCall { tool_call_id: id.to_owned(), tool_name: name.to_owned(), input: input.to_owned(), provider_metadata: None }
}

pub(super) fn finish(reason: &str, input_tokens: u64, output_tokens: u64) -> StreamPart {
    StreamPart::Finish {
        finish_reason: FinishReason { unified: reason.to_owned(), raw: None },
        usage: Usage { input_tokens: InputTokens { total: Some(input_tokens), ..InputTokens::default() }, output_tokens: OutputTokens { total: Some(output_tokens), ..OutputTokens::default() }, raw: None },
        provider_metadata: None,
    }
}

/// A turn that answers in text and stops.
pub(super) fn answer(words: &str) -> Turn {
    let mut parts = text("a", words);
    parts.push(finish("stop", 100, 12));
    Turn::Parts(parts)
}

/// A turn that makes calls.
pub(super) fn calling(calls: Vec<StreamPart>) -> Turn {
    let mut parts = calls;
    parts.push(finish("tool-calls", 100, 12));
    Turn::Parts(parts)
}

pub(super) fn tool(name: &str) -> CatalogTool {
    CatalogTool { name: name.to_owned(), description: name.to_owned(), input_schema: RawJson::from_text(r#"{"type":"object","properties":{}}"#.to_owned()).unwrap(), concurrent: false, read_only: false, local: false }
}

pub(super) struct Harness {
    pub(super) control: Arc<FakeControl>,
    pub(super) gateway: Arc<FakeGateway>,
    pub(super) models: Arc<FakeModels>,
    pub(super) access: Arc<FakeModel>,
    pub(super) clock: Arc<AtomicI64>,
    pub(super) folder: PathBuf,
    pub(super) store: Arc<RunStore>,
    pub(super) hooks: Arc<DeviceHooks>,
    pub(super) logged: Arc<Mutex<Vec<String>>>,
}

impl Harness {
    pub(super) fn new(context: &str) -> Self {
        let clock = Arc::new(AtomicI64::new(1_790_000_000_000));
        let folder = std::env::temp_dir().join(format!("misty-run-tests-{}-{}", std::process::id(), rand::random::<u64>()));
        Self {
            control: Arc::new(FakeControl { context: Mutex::new(context.to_owned()), calls: Mutex::default(), steering: Mutex::default(), intercept: Mutex::default(), clock: clock.clone(), budget_ms: Mutex::new(1_800_000) }),
            gateway: Arc::default(),
            models: Arc::default(),
            access: Arc::new(FakeModel::answering("")),
            clock,
            store: Arc::new(RunStore::open(&folder).unwrap()),
            folder,
            hooks: Arc::default(),
            logged: Arc::default(),
        }
    }

    pub(super) fn deps(&self) -> Arc<RunDeps> {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let clock = self.clock.clone();
        let logged = self.logged.clone();
        Arc::new(RunDeps {
            control: self.control.clone(),
            gateway: self.gateway.clone(),
            models: self.models.clone(),
            access: self.access.clone() as Arc<dyn ModelAccess>,
            device: Arc::new(FakeDevice),
            hooks: self.hooks.clone(),
            store: self.store.clone(),
            logger: Logger::to(Arc::new(move |line: &str| logged.lock().unwrap().push(line.to_owned()))),
            http: reqwest::Client::new(),
            search_cache: WebSearchCache::default(),
            search_endpoints: SearchEndpoints::default(),
            page_reader: Arc::new(crate::web_fetch::reader::InProcessPageReader),
            local_tools: None,
            clock: Arc::new(move || clock.load(Ordering::SeqCst)),
            before_tool: None,
        })
    }

    pub(super) fn stored(&self) -> StoredRun {
        new_stored(&RuntimeIdentity { misty_run_id: "run-fixture".to_owned(), runtime_run_id: "pinned-runtime".to_owned() })
    }

    pub(super) async fn run(&self) -> Result<RunResult, RuntimeError> {
        let deps = self.deps();
        run_space_task_agent(deps, self.stored()).await
    }

    pub(super) fn script(&self, turns: Vec<Turn>) {
        *self.models.script.lock().unwrap() = turns.into();
    }

    /// The text in each model call's prompt, as JSON, for searching.
    pub(super) fn prompt_json(&self, index: usize) -> String {
        serde_json::to_string(&self.models.calls.lock().unwrap()[index].prompt).unwrap()
    }

    pub(super) fn tool_names(&self, index: usize) -> Vec<String> {
        self.models.calls.lock().unwrap()[index].tools.iter().map(|tool| tool.name.clone()).collect()
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.folder);
    }
}

/// A context with no tools from the server.
pub(super) fn plain_context(prompt: &str) -> String {
    json!({ "model_id": "fixture/model", "system": "", "prompt": prompt, "allowed_tools": [] }).to_string()
}
