//! A run from start to end through the public API the app calls, with a stand-in for the app's run
//! host and tool host, and for an OpenAI-compatible model. Nothing else is on the network.
// Tests build their fixtures on disk directly.
#![allow(clippy::disallowed_methods)]

mod support;

use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use futures_util::future::BoxFuture;
use misty_agent::runtime::{
    local_run::LocalRunHost,
    local_tools::{LocalToolCall, LocalToolHost, LocalToolOutcome},
    AgentRuntime, AgentRuntimeOptions, InProcessPageReader, Logger, RuntimeApiError, ToolHook,
};
use serde_json::{json, Value};
use support::run_backend::{backend, calls, finish_call};

const RUN: &str = "invocation_11111111-2222-3333-4444-555555555555";
const OTHER_RUN: &str = "invocation_99999999-2222-3333-4444-555555555555";
const GARBLED_RUN: &str = "invocation_00000000-0000-0000-0000-000000000000";
const MODEL_KEY: &str = "test-model-key-parity";
const WRITE: &str = "log_work_write";
const ONE: &str = r#"{"section":"findings","content":"one"}"#;
const TWO: &str = r#"{"section":"findings","content":"two"}"#;

fn folder() -> PathBuf {
    std::env::temp_dir().join(format!("misty-run-loop-{}-{}", std::process::id(), rand::random::<u64>()))
}

fn logged() -> (Logger, Arc<Mutex<Vec<String>>>) {
    let lines = Arc::new(Mutex::new(Vec::new()));
    let sink = lines.clone();
    (Logger::to(Arc::new(move |line: &str| sink.lock().unwrap().push(line.to_owned()))), lines)
}

/// The app's run host: keeps every run's events.
#[derive(Default)]
struct Host {
    events: Mutex<Vec<(String, Value)>>,
}

impl LocalRunHost for Host {
    fn publish(&self, run_id: &str, event: Value) {
        self.events.lock().unwrap().push((run_id.to_owned(), event));
    }

    fn has_unconfirmed_effects<'a>(&'a self, _run_id: &'a str) -> BoxFuture<'a, bool> {
        Box::pin(async { false })
    }
}

impl Host {
    fn of(&self, run: &str, kind: &str) -> Vec<Value> {
        self.events.lock().unwrap().iter().filter(|(id, event)| id == run && event["type"] == kind).map(|(_, event)| event.clone()).collect()
    }
}

/// The app's tool host: runs `log.work.write` and keeps what it was asked.
#[derive(Default)]
struct Tools {
    calls: Mutex<Vec<LocalToolCall>>,
    /// Calls that never answer, the first time they're made.
    hang_on: Mutex<HashSet<String>>,
}

impl LocalToolHost for Tools {
    fn runs(&self, name: &str) -> bool {
        name == "log.work.write"
    }

    fn call<'a>(&'a self, call: LocalToolCall) -> BoxFuture<'a, LocalToolOutcome> {
        Box::pin(async move {
            let id = call.call_id.clone();
            self.calls.lock().unwrap().push(call);
            if self.hang_on.lock().unwrap().remove(&id) {
                futures_util::future::pending::<()>().await;
            }
            LocalToolOutcome::Result(json!({ "wrote": id }))
        })
    }
}

impl Tools {
    fn ids(&self) -> Vec<String> {
        self.calls.lock().unwrap().iter().map(|call| call.call_id.clone()).collect()
    }

    async fn until_called(&self, id: &str) {
        for _ in 0..2000 {
            if self.calls.lock().unwrap().iter().any(|call| call.call_id == id) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        panic!("the expected tool call never came");
    }
}

struct Fixture {
    data: PathBuf,
    base: String,
    host: Arc<Host>,
    tools: Arc<Tools>,
}

impl Fixture {
    fn runtime(&self, logger: Logger, before_tool: Option<ToolHook>) -> AgentRuntime {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let runtime = AgentRuntime::new(AgentRuntimeOptions {
            data_dir: self.data.clone(),
            client: reqwest::Client::builder().no_proxy().build().unwrap(),
            logger,
            page_reader: Arc::new(InProcessPageReader),
            local_tools: Some(self.tools.clone()),
            run_host: self.host.clone(),
            before_tool,
        })
        .unwrap();
        let models = json!({
            "version": 1,
            "providers": { "nvidia": { "apiKey": MODEL_KEY, "baseURL": format!("{}/v1", self.base) } },
            "models": { "agent": "nvidia/test-model" },
        });
        runtime.set_device_models(&models).unwrap();
        runtime
    }

    fn run_file(&self, run: &str) -> PathBuf {
        self.data.join("runs").join(format!("{run}.json"))
    }

    fn request_file(&self, run: &str) -> PathBuf {
        self.data.join("run-requests").join(format!("{run}.json"))
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.data);
    }
}

fn fixture(base: String) -> Fixture {
    Fixture { data: folder(), base, host: Arc::default(), tools: Arc::default() }
}

fn request() -> Value {
    json!({ "prompt": "Write the two things." })
}

async fn status_is(runtime: &AgentRuntime, run: &str, wanted: &str) {
    for _ in 0..2000 {
        if runtime.status(run) == wanted {
            return;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    panic!("the run's status stayed {}", runtime.status(run));
}

fn tool_results(request: &support::Captured) -> Vec<String> {
    request.body["messages"].as_array().unwrap().iter().filter(|message| message["role"] == "tool").map(|message| message["tool_call_id"].as_str().unwrap().to_owned()).collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_run_goes_through_its_tools_to_its_finish() {
    let (backend, base) = backend().await;
    backend.model.lock().unwrap().extend([calls(&[("one", WRITE, ONE), ("two", WRITE, TWO)]), finish_call()]);
    let run = fixture(base);
    let (logger, lines) = logged();
    let runtime = run.runtime(logger, None);
    runtime.start_local(RUN, request()).await.unwrap();
    status_is(&runtime, RUN, "completed").await;

    // Whoever follows the run: it started once, and ended with the answer.
    assert_eq!(run.host.of(RUN, "invocation.started").len(), 1);
    let answers = run.host.of(RUN, "assistant.message");
    assert_eq!(answers.len(), 1);
    assert_eq!(answers[0]["text"], "All done.");
    assert_eq!(run.host.of(RUN, "invocation.completed").len(), 1);
    assert!(run.host.of(RUN, "invocation.failed").is_empty());
    assert_eq!(run.host.of(RUN, "tool.completed").iter().filter(|event| event["toolName"] == "log.work.write").count(), 2);

    // The tools: each call with its identity, and its input as the model wrote it.
    assert_eq!(run.tools.ids(), ["one", "two"]);
    let first = run.tools.calls.lock().unwrap()[0].clone();
    assert_eq!(first, LocalToolCall { run_id: RUN.to_owned(), call_id: "one".to_owned(), turn: 0, name: "log.work.write".to_owned(), input: json!({ "section": "findings", "content": "one" }) });

    // The model: on the device's key, with the tools, then the results.
    let model = backend.model_requests();
    assert_eq!(model.len(), 2);
    assert_eq!(model[0].headers["authorization"], format!("Bearer {MODEL_KEY}"));
    assert_eq!(model[0].body["model"], "test-model");
    let tools: Vec<&str> = model[0].body["tools"].as_array().unwrap().iter().map(|tool| tool["function"]["name"].as_str().unwrap()).collect();
    assert!(tools.contains(&WRITE) && tools.contains(&"agent_finish"));
    assert_eq!(tool_results(&model[1]), ["one", "two"]);
    // And the model is all that reached the network.
    assert!(backend.others().is_empty(), "{:?}", backend.others());

    // The run's files go when it ends.
    assert!(!run.run_file(RUN).exists());
    assert!(!run.request_file(RUN).exists());
    let log = lines.lock().unwrap().join("\n");
    assert!(log.contains("[misty-agent-runtime] tool_timing"), "{log}");
    assert!(log.contains("[misty-agent-runtime] context_breakdown"), "{log}");
    assert!(log.contains("[misty-agent-runtime] run_finish"), "{log}");
    assert!(!log.contains(MODEL_KEY), "{log}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_run_stopped_mid_turn_continues_after_a_restart_with_the_same_call_ids() {
    let (backend, base) = backend().await;
    backend.model.lock().unwrap().extend([calls(&[("one", WRITE, ONE), ("two", WRITE, TWO)]), finish_call()]);
    let run = fixture(base);
    run.tools.hang_on.lock().unwrap().insert("two".to_owned());
    let first = run.runtime(Logger::default(), None);
    first.start_local(RUN, request()).await.unwrap();
    run.tools.until_called("two").await;

    // Misty closes. The run's file says where it was, with no model key.
    drop(first);
    let saved = std::fs::read_to_string(run.run_file(RUN)).unwrap();
    assert!(!saved.contains(MODEL_KEY));
    assert!(saved.contains("\"one\""));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(run.run_file(RUN)).unwrap().permissions().mode() & 0o777, 0o600);
    }

    // Misty opens again.
    let second = run.runtime(Logger::default(), None);
    let resumed = second.resume_unfinished().await.unwrap();
    assert_eq!(resumed.resumed, [RUN]);
    status_is(&second, RUN, "completed").await;

    // The unfinished call ran again as itself, and the finished one didn't.
    assert_eq!(run.tools.ids(), ["one", "two", "two"]);
    let model = backend.model_requests();
    assert_eq!(model.len(), 2, "the turn already received isn't asked for again");
    assert_eq!(tool_results(&model[1]), ["one", "two"]);
    assert_eq!(run.host.of(RUN, "invocation.completed").len(), 1);
    // Activation isn't repeated: the run keeps its context and its models.
    assert_eq!(run.host.of(RUN, "invocation.started").len(), 1);
    assert!(!run.run_file(RUN).exists());
    assert!(!run.request_file(RUN).exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn cancel_stops_a_run_and_forgets_it() {
    let (backend, base) = backend().await;
    backend.model.lock().unwrap().push_back(calls(&[("one", WRITE, ONE)]));
    let run = fixture(base);
    run.tools.hang_on.lock().unwrap().insert("one".to_owned());
    let runtime = run.runtime(Logger::default(), None);
    runtime.start_local(RUN, request()).await.unwrap();
    run.tools.until_called("one").await;
    assert_eq!(runtime.status(RUN), "running");
    assert!(runtime.local_run_live(RUN));
    runtime.cancel_local(RUN).unwrap();
    assert_eq!(runtime.status(RUN), "cancelled");
    assert!(!runtime.local_run_live(RUN));
    assert!(!run.run_file(RUN).exists());
    assert!(!run.request_file(RUN).exists());
    // Cancelling again, or a run nobody knows, changes nothing, and nothing else happens to the run.
    runtime.cancel_local(RUN).unwrap();
    runtime.cancel_local(OTHER_RUN).unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(run.host.of(RUN, "invocation.canceled").len(), 1);
    assert!(run.host.of(RUN, "invocation.completed").is_empty());
    assert!(run.host.of(RUN, "invocation.failed").is_empty());
    assert!(runtime.resume_unfinished().await.unwrap().resumed.is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_panic_in_a_tool_fails_that_run_and_leaves_the_others() {
    let (backend, base) = backend().await;
    backend.model.lock().unwrap().push_back(calls(&[("boom", "agent_ledger", r#"{"rows":[{"requirement":"Part","state":"pending"}]}"#)]));
    let run = fixture(base);
    let (logger, lines) = logged();
    let tripped = Arc::new(Mutex::new(false));
    let trip = tripped.clone();
    let hook: ToolHook = Arc::new(move |_name: &str| {
        let mut once = trip.lock().unwrap();
        if !*once {
            *once = true;
            drop(once);
            panic!("a tool went wrong with sk-a-secret");
        }
    });
    let runtime = run.runtime(logger, Some(hook));
    runtime.start_local(RUN, request()).await.unwrap();
    status_is(&runtime, RUN, "failed").await;
    let failures = run.host.of(RUN, "invocation.failed");
    assert_eq!(failures.len(), 1);
    assert!(!failures[0].to_string().contains("sk-a-secret"));
    assert!(run.host.of(RUN, "invocation.completed").is_empty());
    assert!(!run.run_file(RUN).exists());
    let log = lines.lock().unwrap().join("\n");
    assert!(log.contains("run_panicked"), "{log}");
    assert!(!log.contains("sk-a-secret"), "{log}");
    // The runtime carries on with other runs.
    backend.model.lock().unwrap().push_back(finish_call());
    runtime.start_local(OTHER_RUN, request()).await.unwrap();
    status_is(&runtime, OTHER_RUN, "completed").await;
    assert_eq!(run.host.of(OTHER_RUN, "invocation.completed").len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_file_that_does_not_read_fails_only_its_own_run() {
    let (backend, base) = backend().await;
    backend.model.lock().unwrap().extend([calls(&[("one", WRITE, ONE)]), finish_call()]);
    let run = fixture(base);
    run.tools.hang_on.lock().unwrap().insert("one".to_owned());
    let first = run.runtime(Logger::default(), None);
    first.start_local(RUN, request()).await.unwrap();
    run.tools.until_called("one").await;
    drop(first);

    // One file cut off after its identity, one with nothing readable at all.
    let cut = format!(r#"{{"version":1,"misty_run_id":"{OTHER_RUN}","runtime_run_id":"wrun_cut","context":"#);
    std::fs::write(run.run_file(OTHER_RUN), cut).unwrap();
    std::fs::write(run.run_file(GARBLED_RUN), "garbage").unwrap();
    let second = run.runtime(Logger::default(), None);
    let report = second.resume_unfinished().await.unwrap();
    assert_eq!(report.resumed, [RUN]);
    let mut failed = report.failed.clone();
    failed.sort();
    assert_eq!(failed, [GARBLED_RUN, OTHER_RUN]);
    status_is(&second, RUN, "completed").await;

    // The readable identity was reported; the other couldn't be.
    assert_eq!(run.host.of(OTHER_RUN, "invocation.failed").len(), 1);
    assert!(run.host.of(GARBLED_RUN, "invocation.failed").is_empty());
    assert_eq!(second.status(OTHER_RUN), "failed");
    assert!(!run.run_file(OTHER_RUN).exists());
    assert!(!run.run_file(GARBLED_RUN).exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn the_api_refuses_with_its_codes_and_a_repeated_start_starts_nothing() {
    let (backend, base) = backend().await;
    let run = fixture(base);
    let runtime = run.runtime(Logger::default(), None);
    assert_eq!(runtime.start_local("run_short", request()).await, Err(RuntimeApiError::InvalidRunId));
    assert_eq!(runtime.status(""), "missing");
    assert_eq!(runtime.status(RUN), "missing");
    assert_eq!(runtime.resume_device("", true).unwrap_err().code(), "invalid_device_resume");
    assert_eq!(runtime.resume_device("misty-device:gone:call:wait:0", true).unwrap_err().code(), "device_resume_failed");
    assert_eq!(runtime.set_device_models(&json!({ "version": 2 })).unwrap_err().code(), "invalid_models");

    // A run's own ID decides duplicates: a start while it runs changes nothing.
    backend.model.lock().unwrap().extend([calls(&[("one", WRITE, ONE)]), finish_call()]);
    run.tools.hang_on.lock().unwrap().insert("one".to_owned());
    runtime.start_local(RUN, request()).await.unwrap();
    run.tools.until_called("one").await;
    runtime.start_local(RUN, request()).await.unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(run.tools.ids(), ["one"]);
    assert_eq!(run.host.of(RUN, "invocation.started").len(), 1);
    assert_eq!(backend.model_requests().len(), 1);
}
