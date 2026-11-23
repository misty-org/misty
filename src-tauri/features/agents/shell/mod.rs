mod workspace;

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) mod exit_watcher;
#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
mod output;
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod process_tree;
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
mod tools;
#[cfg(windows)]
mod windows;

#[cfg(desktop)]
pub mod commands;
#[cfg(all(test, target_os = "macos"))]
#[allow(clippy::disallowed_methods, clippy::disallowed_types)]
mod tests;

use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use serde::Serialize;

pub use workspace::forget as forget_workspace;

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_TIMEOUT: Duration = Duration::from_secs(600);
const MAX_COMMAND_BYTES: usize = 64 * 1024;

pub struct SharedFolder {
    pub root: PathBuf,
    pub writable: bool,
}

pub struct ShellRequest {
    pub workspace_key: String,
    pub command: String,
    pub timeout: Option<Duration>,
    pub folder: Option<SharedFolder>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellOutcome {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shared_folder: Option<&'static str>,
}

pub async fn run(
    misty_dir: &Path,
    request: ShellRequest,
    stop: Arc<AtomicBool>,
) -> Result<ShellOutcome, String> {
    if request.command.trim().is_empty() {
        return Err("shell_command_empty".into());
    }
    if request.command.len() > MAX_COMMAND_BYTES {
        return Err("shell_command_too_long".into());
    }
    let timeout = request.timeout.unwrap_or(DEFAULT_TIMEOUT).min(MAX_TIMEOUT);
    let workspace = workspace::prepare(misty_dir, &request.workspace_key)?;
    let linked = workspace::link_folder(&workspace, request.folder.as_ref())?;
    let full = Arc::new(AtomicBool::new(false));
    let size_watch = tokio::spawn(workspace::stop_when_full(
        workspace.clone(),
        workspace::MAX_WORKSPACE_BYTES,
        stop.clone(),
        full.clone(),
    ));
    let outcome = platform_run(&workspace, &request, timeout, stop).await;
    size_watch.abort();
    let mut outcome = outcome?;
    outcome.shared_folder = linked;
    if full.load(Ordering::Acquire) {
        outcome
            .stderr
            .push_str("\nStopped: this chat's workspace is full. Delete files in it to make room.");
    }
    Ok(outcome)
}

#[cfg(target_os = "macos")]
async fn platform_run(
    workspace: &Path,
    request: &ShellRequest,
    timeout: Duration,
    stop: Arc<AtomicBool>,
) -> Result<ShellOutcome, String> {
    macos::run(workspace, request, timeout, stop).await
}

#[cfg(windows)]
async fn platform_run(
    workspace: &Path,
    request: &ShellRequest,
    timeout: Duration,
    stop: Arc<AtomicBool>,
) -> Result<ShellOutcome, String> {
    windows::run(workspace, request, timeout, stop).await
}

#[cfg(target_os = "linux")]
async fn platform_run(
    workspace: &Path,
    request: &ShellRequest,
    timeout: Duration,
    stop: Arc<AtomicBool>,
) -> Result<ShellOutcome, String> {
    linux::run(workspace, request, timeout, stop).await
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
async fn platform_run(
    _workspace: &Path,
    _request: &ShellRequest,
    _timeout: Duration,
    _stop: Arc<AtomicBool>,
) -> Result<ShellOutcome, String> {
    Err("shell_unsupported_platform".into())
}
