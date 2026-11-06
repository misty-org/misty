//! A run from start to end against a local stand-in for the server, its tool service and an
//! OpenAI-compatible model, through the public API the app calls.
// Tests build their fixtures on disk directly.
#![allow(clippy::disallowed_methods)]

mod support;

use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use misty_agent::runtime::{AgentRuntime, AgentRuntimeOptions, Logger, RuntimeApiError, StartRequest, StartedRun, ToolHook};
use serde_json::json;
use sha2::{Digest, Sha256};
use support::{
    run_backend::{backend, calls, finish_call},
    Captured,
};

const RUN: &str = "invocation_11111111-2222-3333-4444-555555555555";
const OTHER_RUN: &str = "invocation_99999999-2222-3333-4444-555555555555";
// Base64 of 32 bytes, as a run's own key is.
const RUN_KEY: &str = "cnVuLWtleS1ydW4ta2V5LXJ1bi1rZXktcnVuLWtleTE=";
const MODEL_KEY: &str = "test-model-key-parity";

fn folder() -> PathBuf {
    std::env::temp_dir().join(format!("misty-run-loop-{}-{}", std::process::id(), rand::random::<u64>()))
}

fn logged() -> (Logger, Arc<Mutex<Vec<String>>>) {
    let lines = Arc::new(Mutex::new(Vec::new()));
    let sink = lines.clone();
    (Logger::to(Arc::new(move |line: &str| sink.lock().unwrap().push(line.to_owned()))), lines)
}

fn runtime_at(data: &std::path::Path, base: &str, logger: Logger, before_tool: Option<ToolHook>) -> AgentRuntime {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let runtime = AgentRuntime::new(AgentRuntimeOptions {
        data_dir: data.to_path_buf(),
        client: reqwest::Client::builder().no_proxy().build().unwrap(),
        logger,
        internal_api_base: None,
        before_tool,
    })
    .unwrap();
    let models = json!({
        "version": 1,
        "providers": { "nvidia": { "apiKey": MODEL_KEY, "baseURL": format!("{base}/v1") } },
        "models": { "agent": "nvidia/test-model" },
    });
    runtime.set_device_models(&models).unwrap();
    runtime
}

fn start_request(run: &str, base: &str) -> StartRequest {
    StartRequest { run_id: run.to_owned(), callback_url: Some(base.to_owned()), adapter_version: None, run_key: RUN_KEY.to_owned(), receipt_callback: base.to_owned() }
}

async fn status_is(runtime: &AgentRuntime, id: &str, wanted: &str) {
    for _ in 0..2000 {
        if runtime.status(id).unwrap() == wanted {
            return;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    panic!("the run's status stayed {}", runtime.status(id).unwrap());
}

fn run_file(data: &std::path::Path, run: &str) -> PathBuf {
    data.join("runs").join(format!("{run}.json"))
}

fn hmac_sha256(key: &[u8], message: &[u8]) -> Vec<u8> {
    let mut block = [0u8; 64];
    block[..key.len()].copy_from_slice(key);
    let pad = |value: u8| block.iter().map(|byte| byte ^ value).collect::<Vec<u8>>();
    let inner = Sha256::digest([pad(0x36).as_slice(), message].concat());
    Sha256::digest([pad(0x5c).as_slice(), inner.as_slice()].concat()).to_vec()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_run_goes_through_its_tools_to_its_finish() {
    let (backend, base) = backend().await;
    backend.model.lock().unwrap().extend([calls(&[("one", "task_write", r#"{"b":1,"a":2}"#), ("two", "task_write", "{}")]), finish_call()]);
    let data = folder();
    let (logger, lines) = logged();
    let runtime = runtime_at(&data, &base, logger, None);
    let started = runtime.start(start_request(RUN, &base)).await.unwrap();
    assert!(started.runtime_run_id.starts_with("wrun_"));
    assert_eq!(started.adapter_version, "vercel-workflow/1");
    status_is(&runtime, &started.runtime_run_id, "completed").await;

    // The server: every call is the run's, signed with its own key, and it ended with the answer.
    let receipts = backend.actions("start-receipt");
    assert_eq!(receipts[0].body["runtime_run_id"], "");
    assert_eq!(receipts[1].body["claim_token"], "exclusive");
    assert_eq!(receipts[1].body["runtime_run_id"], started.runtime_run_id.as_str());
    for action in ["activate", "context", "steering", "budget", "events", "complete"] {
        let sent = backend.actions(action);
        assert!(!sent.is_empty(), "{action}");
        assert!(sent.iter().all(|request| request.body["runtime_run_id"] == started.runtime_run_id.as_str()), "{action}");
    }
    let activate = &backend.actions("activate")[0];
    assert_eq!(activate.headers["idempotency-key"], format!("{RUN}:activate"));
    // The body as sent: the captured one has lost its key order.
    let raw = format!(r#"{{"runtime_run_id":"{}","runtime_kind":"vercel-workflow"}}"#, started.runtime_run_id);
    let timestamp = &activate.headers["x-misty-agent-timestamp"];
    let digest = hex::encode(Sha256::digest(raw.as_bytes()));
    let signed = format!("POST\n/internal/agent-runtime/runs/{RUN}/activate\n{timestamp}\n{digest}");
    let key = base64_decode(RUN_KEY);
    assert_eq!(activate.headers["x-misty-agent-signature"], hex::encode(hmac_sha256(&key, signed.as_bytes())));
    assert_eq!(backend.actions("context")[0].body["model_id"], "nvidia/test-model");
    let completions = backend.actions("complete");
    assert_eq!(completions.len(), 1);
    assert_eq!(completions[0].body["status"], "success");
    assert_eq!(completions[0].body["text"], "All done.");

    // The tool service: the version probe, the catalog, then each call with its identity.
    let mcp = backend.sent(|request| request.path == "/mcp");
    assert_eq!(mcp[0].body["method"], "server/discover");
    assert_eq!(mcp[0].headers["mcp-protocol-version"], "2026-07-28");
    assert_eq!(mcp[0].headers["mcp-method"], "server/discover");
    assert_eq!(mcp[0].headers["authorization"], "Bearer bearer-1");
    assert_eq!(mcp[0].body["params"]["_meta"]["io.modelcontextprotocol/clientInfo"]["name"], "misty-vercel-agent-runtime");
    assert_eq!(mcp[1].body["method"], "tools/list");
    assert_eq!(backend.tool_call_ids(), ["one", "two"]);
    let first = &mcp[2];
    assert_eq!(first.headers["mcp-name"], "task.write");
    assert_eq!(first.body["params"]["name"], "task.write");
    assert_eq!(first.body["params"]["_meta"]["misty/device_hook_token"], format!("misty-device:{RUN}:one:wait:0"));
    assert_eq!(first.body["params"]["arguments"], json!({ "b": 1, "a": 2 }));

    // The model: on the device's key, with the tools, then the results.
    let model = backend.model_requests();
    assert_eq!(model.len(), 2);
    assert_eq!(model[0].headers["authorization"], format!("Bearer {MODEL_KEY}"));
    assert_eq!(model[0].body["model"], "test-model");
    let tools: Vec<&str> = model[0].body["tools"].as_array().unwrap().iter().map(|tool| tool["function"]["name"].as_str().unwrap()).collect();
    assert!(tools.contains(&"task_write") && tools.contains(&"agent_finish"));
    let messages = model[1].body["messages"].as_array().unwrap();
    let results: Vec<&str> = messages.iter().filter(|message| message["role"] == "tool").map(|message| message["tool_call_id"].as_str().unwrap()).collect();
    assert_eq!(results, ["one", "two"]);

    // The run's file holds its key while it runs, and goes when it ends.
    assert!(!run_file(&data, RUN).exists());
    let log = lines.lock().unwrap().join("\n");
    assert!(log.contains("[misty-agent-runtime] tool_timing"), "{log}");
    assert!(log.contains("[misty-agent-runtime] context_breakdown"), "{log}");
    assert!(log.contains("[misty-agent-runtime] run_finish"), "{log}");
    assert!(!log.contains(MODEL_KEY) && !log.contains(RUN_KEY) && !log.contains("bearer-1"), "{log}");
    drop(runtime);
    let _ = std::fs::remove_dir_all(data);
}

fn base64_decode(text: &str) -> Vec<u8> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    STANDARD.decode(text).unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_run_stopped_mid_turn_continues_after_a_restart_with_the_same_call_ids() {
    let (backend, base) = backend().await;
    backend.hang_on.lock().unwrap().insert("two".to_owned());
    backend.model.lock().unwrap().extend([calls(&[("one", "task_write", "{}"), ("two", "task_write", "{}")]), finish_call()]);
    let data = folder();
    let first = runtime_at(&data, &base, Logger::default(), None);
    let started = first.start(start_request(RUN, &base)).await.unwrap();
    backend.until(|request| request.path == "/mcp" && request.body["params"]["_meta"]["misty/call_id"] == "two").await;

    // Misty closes. The run's file says where it was, with its key and no model key.
    drop(first);
    let saved = std::fs::read_to_string(run_file(&data, RUN)).unwrap();
    assert!(saved.contains(RUN_KEY));
    assert!(!saved.contains(MODEL_KEY));
    assert!(saved.contains("\"one\""));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(run_file(&data, RUN)).unwrap().permissions().mode() & 0o777, 0o600);
    }

    // Misty opens again.
    let second = runtime_at(&data, &base, Logger::default(), None);
    let resumed = second.resume_unfinished().await.unwrap();
    assert_eq!(resumed.resumed, [RUN]);
    status_is(&second, &started.runtime_run_id, "completed").await;

    // The unfinished call ran again as itself, and the finished one didn't.
    assert_eq!(backend.tool_call_ids(), ["one", "two", "two"]);
    let model = backend.model_requests();
    assert_eq!(model.len(), 2, "the turn already received isn't asked for again");
    let messages = model[1].body["messages"].as_array().unwrap();
    let results: Vec<&str> = messages.iter().filter(|message| message["role"] == "tool").map(|message| message["tool_call_id"].as_str().unwrap()).collect();
    assert_eq!(results, ["one", "two"]);
    assert_eq!(backend.actions("complete").len(), 1);
    // Activation isn't repeated: the run keeps its context and its models.
    assert_eq!(backend.actions("activate").len(), 1);
    assert_eq!(backend.actions("context").len(), 1);
    assert!(!run_file(&data, RUN).exists());
    drop(second);
    let _ = std::fs::remove_dir_all(data);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_device_wait_survives_a_restart_on_the_same_token() {
    let (backend, base) = backend().await;
    backend.device_wait_on.lock().unwrap().insert("one".to_owned());
    backend.model.lock().unwrap().extend([calls(&[("one", "task_write", "{}")]), finish_call()]);
    let data = folder();
    let first = runtime_at(&data, &base, Logger::default(), None);
    let started = first.start(start_request(RUN, &base)).await.unwrap();
    backend.until(|request| request.path == "/mcp" && request.body["params"]["_meta"]["misty/call_id"] == "one").await;
    let token = format!("misty-device:{RUN}:one:wait:0");
    // It takes a moment for the wait to reach the file.
    for _ in 0..2000 {
        if std::fs::read_to_string(run_file(&data, RUN)).is_ok_and(|text| text.contains("\"waits\":{\"one\"")) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    drop(first);

    let second = runtime_at(&data, &base, Logger::default(), None);
    second.resume_unfinished().await.unwrap();
    assert_eq!(second.resume_device("misty-device:someone-else:call:wait:0", true), Err(RuntimeApiError::DeviceResumeFailed));
    second.resume_device(&token, true).unwrap();
    status_is(&second, &started.runtime_run_id, "completed").await;
    // No second request for the wait it was in, and the next request is the wait's next attempt.
    let tokens: Vec<String> = backend
        .sent(|request| request.path == "/mcp" && request.body["method"] == "tools/call")
        .iter()
        .map(|request| request.body["params"]["_meta"]["misty/device_hook_token"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(tokens, [token, format!("misty-device:{RUN}:one:wait:1")]);
    drop(second);
    let _ = std::fs::remove_dir_all(data);
}

#[tokio::test(flavor = "multi_thread")]
async fn cancel_stops_a_run_and_forgets_it() {
    let (backend, base) = backend().await;
    backend.hang_on.lock().unwrap().insert("one".to_owned());
    backend.model.lock().unwrap().push_back(calls(&[("one", "task_write", "{}")]));
    let data = folder();
    let runtime = runtime_at(&data, &base, Logger::default(), None);
    let started = runtime.start(start_request(RUN, &base)).await.unwrap();
    backend.until(|request| request.path == "/mcp" && request.body["method"] == "tools/call").await;
    assert_eq!(runtime.status(&started.runtime_run_id).unwrap(), "running");
    runtime.cancel(&started.runtime_run_id).unwrap();
    assert_eq!(runtime.status(&started.runtime_run_id).unwrap(), "cancelled");
    assert!(!run_file(&data, RUN).exists());
    // Cancelling again changes nothing, and nothing else happens to the run.
    runtime.cancel(&started.runtime_run_id).unwrap();
    assert_eq!(runtime.cancel("wrun_unknown"), Err(RuntimeApiError::WorkflowCancelFailed));
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(backend.actions("complete").is_empty());
    assert!(runtime.resume_unfinished().await.unwrap().resumed.is_empty());
    drop(runtime);
    let _ = std::fs::remove_dir_all(data);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_panic_in_a_tool_fails_that_run_and_leaves_the_others() {
    let (backend, base) = backend().await;
    backend.model.lock().unwrap().push_back(calls(&[("boom", "agent_ledger", r#"{"rows":[{"requirement":"Part","state":"pending"}]}"#)]));
    let data = folder();
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
    let runtime = runtime_at(&data, &base, logger, Some(hook));
    let started = runtime.start(start_request(RUN, &base)).await.unwrap();
    status_is(&runtime, &started.runtime_run_id, "failed").await;
    for _ in 0..2000 {
        if !backend.actions("complete").is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    let completions = backend.actions("complete");
    assert_eq!(completions.len(), 1);
    assert_eq!(completions[0].body["status"], "failed");
    assert_eq!(completions[0].body["error_code"], "agent_runtime_failed");
    assert!(!run_file(&data, RUN).exists());
    let log = lines.lock().unwrap().join("\n");
    assert!(log.contains("run_panicked"), "{log}");
    assert!(!log.contains("sk-a-secret"), "{log}");
    // The runtime carries on with other runs.
    backend.model.lock().unwrap().push_back(finish_call());
    let next = runtime.start(start_request(OTHER_RUN, &base)).await.unwrap();
    status_is(&runtime, &next.runtime_run_id, "completed").await;
    drop(runtime);
    let _ = std::fs::remove_dir_all(data);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_file_that_does_not_read_fails_only_its_own_run() {
    let (backend, base) = backend().await;
    backend.hang_on.lock().unwrap().insert("one".to_owned());
    backend.model.lock().unwrap().extend([calls(&[("one", "task_write", "{}")]), finish_call()]);
    let data = folder();
    let first = runtime_at(&data, &base, Logger::default(), None);
    let healthy = first.start(start_request(RUN, &base)).await.unwrap();
    backend.until(|request| request.path == "/mcp" && request.body["method"] == "tools/call").await;
    drop(first);

    // One file cut off after its identity, one with nothing readable at all.
    let cut = format!(r#"{{"version":1,"misty_run_id":"{OTHER_RUN}","runtime_run_id":"wrun_cut","control_plane_url":"{base}","run_key":"{RUN_KEY}","context":"#);
    std::fs::write(run_file(&data, OTHER_RUN), cut).unwrap();
    std::fs::write(run_file(&data, "invocation_00000000-0000-0000-0000-000000000000"), "garbage").unwrap();
    let second = runtime_at(&data, &base, Logger::default(), None);
    let report = second.resume_unfinished().await.unwrap();
    assert_eq!(report.resumed, [RUN]);
    let mut failed = report.failed.clone();
    failed.sort();
    assert_eq!(failed, ["invocation_00000000-0000-0000-0000-000000000000", OTHER_RUN]);
    status_is(&second, &healthy.runtime_run_id, "completed").await;

    // The readable identity was reported under its own key; the other couldn't be.
    let reports: Vec<Captured> = backend.actions("complete").into_iter().filter(|request| request.body["runtime_run_id"] == "wrun_cut").collect();
    assert_eq!(reports.len(), 1);
    assert_eq!(reports[0].body["status"], "failed");
    assert_eq!(second.status("wrun_cut").unwrap(), "failed");
    assert!(!run_file(&data, OTHER_RUN).exists());
    assert!(!run_file(&data, "invocation_00000000-0000-0000-0000-000000000000").exists());
    drop(second);
    let _ = std::fs::remove_dir_all(data);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_api_refuses_with_its_routes_codes() {
    let (backend, base) = backend().await;
    let data = folder();
    let runtime = runtime_at(&data, &base, Logger::default(), None);
    let bad = |edit: fn(&mut StartRequest)| {
        let mut request = start_request(RUN, &base);
        edit(&mut request);
        request
    };
    let code = |result: Result<StartedRun, RuntimeApiError>| result.unwrap_err().code();
    assert_eq!(code(runtime.start(bad(|request| request.run_id = "run_short".to_owned())).await), "invalid_run_id");
    assert_eq!(code(runtime.start(bad(|request| request.adapter_version = Some("other/1".to_owned()))).await), "harness_version_unavailable");
    assert_eq!(code(runtime.start(bad(|request| request.run_key = "short".to_owned())).await), "invalid_run_key");
    assert_eq!(code(runtime.start(bad(|request| request.receipt_callback = String::new())).await), "invalid_run_key");
    assert_eq!(code(runtime.start(bad(|request| request.receipt_callback = "x".repeat(513))).await), "invalid_run_key");
    assert_eq!(code(runtime.start(bad(|request| request.callback_url = Some("http://public.example.com".to_owned()))).await), "workflow_start_failed");
    assert_eq!(runtime.status("").unwrap_err().code(), "invalid_runtime_run_id");
    assert_eq!(runtime.cancel("").unwrap_err().code(), "invalid_runtime_run_id");
    assert_eq!(runtime.status("wrun_unknown").unwrap(), "missing");
    assert_eq!(runtime.resume_device("", true).unwrap_err().code(), "invalid_device_resume");
    assert_eq!(runtime.resume_device("misty-device:gone:call:wait:0", true).unwrap_err().code(), "device_resume_failed");
    assert_eq!(runtime.set_device_models(&json!({ "version": 2 })).unwrap_err().code(), "invalid_models");
    // A key never prints in a request's debug form.
    assert!(!format!("{:?}", start_request(RUN, &base)).contains(RUN_KEY));

    // The server decides duplicates: an unconfirmed start says so, a known one gets its original ID.
    *backend.unclaimed.lock().unwrap() = true;
    assert_eq!(code(runtime.start(start_request(RUN, &base)).await), "workflow_start_unconfirmed");
    *backend.known_runtime_id.lock().unwrap() = Some("wrun_original".to_owned());
    let again = runtime.start(start_request(RUN, &base)).await.unwrap();
    assert_eq!(again.runtime_run_id, "wrun_original");
    assert!(!run_file(&data, RUN).exists(), "nothing new was started");
    drop(runtime);
    let _ = std::fs::remove_dir_all(data);
}
