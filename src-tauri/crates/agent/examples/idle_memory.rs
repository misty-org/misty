//! Reports what an `AgentRuntime` costs in memory while idle, next to the 328 MB one reading of the
//! Node runtime came to:
//!
//!     cargo run --release --example idle_memory
//!
//! It makes a runtime with a device model and a key in a throwaway folder, makes no model call, waits
//! a moment, and asks `ps` for this program's resident memory. That's the crate and its dependencies
//! on their own: not the Misty app or its web views, and not a running agent, whose transcript, screenshots
//! and model streams take more. The Node number is the helper process alone, also idle, so the two
//! compare, but the comparison says nothing about memory during a run.
// A small program with its own throwaway folder, not part of the app.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use std::{process::Command, sync::Arc, time::Duration};

use misty_agent::runtime::{runtime_client_builder, AgentRuntime, AgentRuntimeOptions, InProcessPageReader, Logger};

const NODE_RUNTIME_MB: f64 = 328.0;

fn resident_kb() -> u64 {
    let output = Command::new("ps").args(["-o", "rss=", "-p", &std::process::id().to_string()]).output().expect("ps runs");
    String::from_utf8_lossy(&output.stdout).trim().parse().expect("ps reports a number")
}

#[tokio::main]
async fn main() {
    let before = resident_kb();
    let _ = rustls::crypto::ring::default_provider().install_default();
    let data = std::env::temp_dir().join(format!("misty-idle-memory-{}", std::process::id()));
    let runtime = AgentRuntime::new(AgentRuntimeOptions {
        data_dir: data.clone(),
        client: runtime_client_builder().no_proxy().build().expect("the client builds"),
        logger: Logger::default(),
        internal_api_base: None,
        page_reader: Arc::new(InProcessPageReader),
        before_tool: None,
    })
    .expect("the runtime opens");
    runtime
        .set_device_models(&serde_json::json!({
            "version": 1,
            "providers": { "anthropic": { "apiKey": "sk-ant-not-a-real-key" } },
            "models": { "agent": "anthropic/claude-sonnet-4-5", "fast": "anthropic/claude-haiku-4-5" },
        }))
        .expect("the models are valid");
    let resumed = runtime.resume_unfinished().await.expect("the store reads");
    assert!(resumed.resumed.is_empty());
    tokio::time::sleep(Duration::from_secs(3)).await;
    let idle = resident_kb();
    runtime.shutdown();
    drop(runtime);
    let _ = std::fs::remove_dir_all(&data);
    let megabytes = idle as f64 / 1024.0;
    println!("Before the runtime: {:.1} MB", before as f64 / 1024.0);
    println!("Idle, with device models set: {megabytes:.1} MB");
    println!("Node runtime, one earlier reading: {NODE_RUNTIME_MB:.0} MB");
    println!("Not measured: the Misty app, a running agent, or any model call.");
}
