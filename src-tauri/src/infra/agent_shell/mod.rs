//! `shell.run`: a real shell for agents, inside `permission-agent-shell`
//! (`docs/plans/app-permissions.md`). Each chat gets a private workspace in Misty's data folder.
//! Commands get the same shell and tools on every computer, all one program Misty ships (`tools`), and
//! their workspace and, when granted, one shared folder. They have no network, no environment beyond
//! what's set here, and no way to reach tabs, keys or the rest of `.misty`.
//!
//! Rust starts every command itself, so the limits don't depend on anything an agent wrote. Linux has
//! no OS wall here yet, so commands are refused there rather than run without one.
mod workspace;

#[cfg(target_os = "macos")]
mod exit_watcher;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(any(target_os = "macos", windows))]
mod output;
#[cfg(target_os = "macos")]
mod process_tree;
#[cfg(any(target_os = "macos", windows))]
mod tools;
#[cfg(windows)]
mod windows;

#[cfg(all(test, target_os = "macos"))]
// Tests build their fixtures directly, outside the file gate.
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

/// The longest a command may run unless the agent asks for less.
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_TIMEOUT: Duration = Duration::from_secs(600);
const MAX_COMMAND_BYTES: usize = 64 * 1024;

/// A shared folder this command may use, already checked against the run's grant.
pub struct SharedFolder {
    pub root: PathBuf,
    /// Add and edit files. Deleting, renaming and moving stay refused either way.
    pub writable: bool,
}

pub struct ShellRequest {
    /// Which chat or workflow the workspace belongs to.
    pub workspace_key: String,
    pub command: String,
    pub timeout: Option<Duration>,
    pub folder: Option<SharedFolder>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellOutcome {
    /// None when the command was stopped.
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    /// Some output was left out of the middle, because there was too much.
    pub truncated: bool,
    /// The chat's shared folder, relative to the workspace, when it has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shared_folder: Option<&'static str>,
}

/// Runs one command to the end, or until its time is up or `stop` is set.
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
        outcome.stderr.push_str("\nStopped: this chat's workspace is full. Delete files in it to make room.");
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

#[cfg(not(any(target_os = "macos", windows)))]
async fn platform_run(
    _workspace: &Path,
    _request: &ShellRequest,
    _timeout: Duration,
    _stop: Arc<AtomicBool>,
) -> Result<ShellOutcome, String> {
    Err("shell_unsupported_platform".into())
}
