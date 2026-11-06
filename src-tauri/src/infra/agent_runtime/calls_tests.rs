use std::sync::Arc;

use misty_agent::runtime::{AgentRuntimeOptions, InProcessPageReader, Logger};

use super::*;

fn runtime() -> AgentRuntime {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let data = crate::infra::paths::misty_home_dir()
        .unwrap()
        .join(format!("runtime-test-{}", uuid::Uuid::new_v4()));
    AgentRuntime::new(AgentRuntimeOptions {
        data_dir: data,
        client: reqwest::Client::builder().no_proxy().build().unwrap(),
        logger: Logger::default(),
        internal_api_base: None,
        page_reader: Arc::new(InProcessPageReader),
        before_tool: None,
    })
    .unwrap()
}

fn delivery(operation: &str) -> Delivery {
    Delivery {
        operation: operation.to_owned(),
        run_id: "run_00000000-0000-0000-0000-000000000000".to_owned(),
        runtime_run_id: String::new(),
        hook_token: String::new(),
        available: true,
        run_key: format!("{}=", "A".repeat(43)),
        adapter_version: String::new(),
        receipt_callback: "http://127.0.0.1:1/receipt".to_owned(),
    }
}

const SERVER: &str = "http://127.0.0.1:1/v1";

async fn error_of(runtime: &AgentRuntime, delivery: Delivery) -> Option<String> {
    apply(runtime, delivery, SERVER).await.unwrap().error
}

#[tokio::test]
async fn refused_starts_answer_with_the_routes_codes() {
    let runtime = runtime();
    let mut bad_run = delivery("invocation.start");
    bad_run.run_id = "nonsense".to_owned();
    assert_eq!(error_of(&runtime, bad_run).await.unwrap(), "invalid_run_id");

    // The server always names a version. An empty one failed the route's check, and still does.
    assert_eq!(
        error_of(&runtime, delivery("invocation.start"))
            .await
            .unwrap(),
        "harness_version_unavailable"
    );

    let mut other = delivery("invocation.start");
    other.adapter_version = "someone-elses".to_owned();
    assert_eq!(
        error_of(&runtime, other).await.unwrap(),
        "harness_version_unavailable"
    );
}

#[tokio::test]
async fn a_start_needs_a_real_server_address() {
    let runtime = runtime();
    let error = apply(&runtime, delivery("invocation.start"), "file:///etc/passwd").await;
    assert_eq!(error.unwrap_err(), "Invalid API URL");
}

#[tokio::test]
async fn runs_it_does_not_know_answer_as_they_did() {
    let runtime = runtime();
    let mut cancel = delivery("runtime.cancel");
    cancel.runtime_run_id = "wrun_gone".to_owned();
    assert_eq!(
        error_of(&runtime, cancel).await.unwrap(),
        "workflow_cancel_failed"
    );

    let mut reconcile = delivery("runtime.reconcile");
    reconcile.runtime_run_id = "wrun_gone".to_owned();
    assert_eq!(
        apply(&runtime, reconcile, SERVER).await.unwrap(),
        Outcome {
            status: Some("missing".to_owned()),
            ..Outcome::default()
        }
    );

    let mut resume = delivery("device.resume");
    resume.hook_token = "gone".to_owned();
    assert_eq!(
        error_of(&runtime, resume).await.unwrap(),
        "device_resume_failed"
    );
}

/// `/v1/runs//cancel` and `/v1/devices/` matched no route, and the server keeps that status.
#[tokio::test]
async fn an_empty_id_is_the_404_it_was() {
    let runtime = runtime();
    for operation in [
        "runtime.cancel",
        "runtime.reconcile",
        "device.resume",
        "intervention.resume",
    ] {
        assert_eq!(
            error_of(&runtime, delivery(operation)).await.unwrap(),
            "agent_runtime_404",
            "{operation}"
        );
    }
}

#[tokio::test]
async fn an_unknown_delivery_is_refused() {
    let runtime = runtime();
    assert!(apply(&runtime, delivery("something.else"), SERVER)
        .await
        .is_err());
}

#[test]
fn calls_the_server_at_its_origin() {
    assert_eq!(
        origin("http://127.0.0.1:8081/v1").unwrap(),
        "http://127.0.0.1:8081"
    );
    assert_eq!(
        origin("https://misty.example.com/v1").unwrap(),
        "https://misty.example.com"
    );
    assert!(origin("file:///etc/passwd").is_err());
}

#[tokio::test]
async fn a_device_call_with_no_model_says_what_to_do() {
    let runtime = runtime();
    let calls = misty_agent::runtime::device::DeviceCalls::new(
        runtime.device_models(),
        reqwest::Client::builder().no_proxy().build().unwrap(),
    );
    let body = r#"{"text":"hi","style":"clean","dictionary":[],"language":"en"}"#;
    let failure = calls.device_call("cleanup", body).await.unwrap_err();
    assert_eq!(failure.status, 409);
    assert_eq!(failure.body["code"], "model_key_needed");
    let bad = calls.device_call("cleanup", "{nope").await.unwrap_err();
    assert_eq!(bad.status, 400);
    assert_eq!(bad.body["code"], "invalid_model_call");
}
