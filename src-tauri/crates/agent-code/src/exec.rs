//! Running one command to completion inside the sandbox.
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use serde::Deserialize;
use serde_json::{json, Value};

use crate::{output::Capped, sandbox::Setup, CodeError};

#[cfg(unix)]
mod unix;
#[cfg(unix)]
pub use unix::{collect, kill_group, signal, start, Child, Tree};
#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::{collect, kill_group, signal, start, Child, Tree};

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(120);
/// Below the five minutes a device job may take, so a result always returns.
pub const MAX_TIMEOUT: Duration = Duration::from_secs(240);
const MAX_COMMAND_BYTES: usize = 16 * 1024;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    pub command: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub timeout_seconds: Option<u64>,
}

pub fn check_command(command: &str) -> Result<(), CodeError> {
    if command.trim().is_empty() {
        return Err(CodeError::fix("The command is empty."));
    }
    if command.len() > MAX_COMMAND_BYTES {
        return Err(CodeError::fix(
            "That command is over 16 KB. Write a script file with code_write and run it.",
        ));
    }
    if command.contains('\0') {
        return Err(CodeError::fix("Commands can't contain NUL characters."));
    }
    Ok(())
}

/// Runs a command to completion or until its timeout. A non-zero exit is a
/// normal result the model reads, not an error.
pub async fn run(setup: Setup, timeout: Duration) -> Result<Value, CodeError> {
    let started = Instant::now();
    let (mut child, tree) = start(&setup)?;
    let pid = child.id();
    let sink = Arc::new(Mutex::new(Capped::new(6 * 1024, 10 * 1024)));
    let readers = collect(&mut child, sink.clone());
    let status = tokio::time::timeout(timeout, child.wait()).await;
    // Background jobs a command left behind would hold the pipes open and
    // outlive the call; dev servers belong in code_start instead.
    kill_group(pid);
    tree.kill_all();
    let timed_out = status.is_err();
    if timed_out {
        let _ = child.kill().await;
    }
    drop(tree);
    for reader in readers {
        let _ = tokio::time::timeout(Duration::from_secs(2), reader).await;
    }
    let (output, bytes) = sink
        .lock()
        .map(|sink| (sink.render(), sink.total()))
        .unwrap_or_default();
    let exit_code = match &status {
        Ok(Ok(status)) => status.code(),
        _ => None,
    };
    let signal = match &status {
        Ok(Ok(status)) => signal(status),
        _ => None,
    };
    let mut result = json!({
        "exitCode": exit_code,
        "output": output,
        "outputBytes": bytes,
        "seconds": (started.elapsed().as_millis() as f64 / 1000.0),
    });
    if timed_out {
        result["timedOut"] = json!(true);
        result["note"] = json!(format!(
            "Stopped after {} seconds. Long-running servers belong in code_start.",
            timeout.as_secs()
        ));
    } else if let Some(signal) = signal {
        result["signal"] = json!(signal);
    }
    let blocked = ["Operation not permitted", "deny(1)", "Access is denied"];
    if blocked.iter().any(|text| output.contains(text)) {
        result["sandboxNote"] = json!(
            "Some access was blocked by the sandbox: commands can use only the project folder, can't change .git or secret files, and reach the network only when package installs are allowed for this project."
        );
    }
    Ok(result)
}
