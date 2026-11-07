use std::sync::Arc;

use futures_util::future::BoxFuture;
use misty_agent::runtime::{
    local_run::LocalRunHost, AgentRuntime, AgentRuntimeOptions, InProcessPageReader, Logger,
};

/// No run starts in these tests, so nothing publishes.
struct NoRuns;

impl LocalRunHost for NoRuns {
    fn publish(&self, _run_id: &str, _event: serde_json::Value) {}

    fn has_unconfirmed_effects<'a>(&'a self, _run_id: &'a str) -> BoxFuture<'a, bool> {
        Box::pin(async { false })
    }
}

fn runtime() -> AgentRuntime {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let data = crate::infra::paths::misty_home_dir()
        .unwrap()
        .join(format!("runtime-test-{}", uuid::Uuid::new_v4()));
    AgentRuntime::new(AgentRuntimeOptions {
        data_dir: data,
        client: reqwest::Client::builder().no_proxy().build().unwrap(),
        logger: Logger::default(),
        page_reader: Arc::new(InProcessPageReader),
        local_tools: None,
        run_host: Arc::new(NoRuns),
        before_tool: None,
    })
    .unwrap()
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
