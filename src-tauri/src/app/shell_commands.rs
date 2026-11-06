//! `shell.run` jobs. The page script only passes a job along: this checks the job's signed grant
//! itself, for the shell and for any folder it touches, so a compromised page can't run a command
//! the run wasn't granted or widen what one reaches.
#![cfg(desktop)]

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};

use serde::Deserialize;
use serde_json::Value;
use tauri::State;

use crate::{
    app::{device_commands::require_device_window, runtime::MistyRuntime},
    infra::{
        agent_shell::{self, ShellOutcome, ShellRequest, SharedFolder},
        devices::{records::SignedRecord, trust},
    },
};

const SHELL_CAPABILITY: &str = "shell.run";
const FOLDER_READ_CAPABILITY: &str = "folder.read";
const FOLDER_WRITE_CAPABILITY: &str = "folder.write";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShellJobInput {
    command: String,
    /// The chat or workflow this workspace belongs to.
    workspace_key: String,
    #[serde(default)]
    timeout_seconds: Option<u64>,
    /// The chat's shared folder, if it has one.
    #[serde(default)]
    folder_scope_id: Option<String>,
}

fn running() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static RUNNING: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    RUNNING.get_or_init(Default::default)
}

/// Forgets a running job when it ends, however it ends.
struct RunningJob(String);

impl Drop for RunningJob {
    fn drop(&mut self) {
        if let Ok(mut jobs) = running().lock() {
            jobs.remove(&self.0);
        }
    }
}

/// Runs one claimed `shell.run` job after checking its grant.
#[tauri::command]
pub async fn device_shell_job(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    job_id: String,
    scope_id: String,
    input: Value,
    config: Value,
) -> Result<ShellOutcome, String> {
    require_device_window(&webview)?;
    let grant: SignedRecord = serde_json::from_value(config["runGrant"].clone())
        .map_err(|_| "device_grant_invalid".to_owned())?;
    trust::verify_job_grant(&grant, &scope_id, SHELL_CAPABILITY)
        .map_err(|_| "device_grant_invalid".to_owned())?;
    let input: ShellJobInput =
        serde_json::from_value(input).map_err(|_| "shell_job_invalid".to_owned())?;
    let folder = match input.folder_scope_id {
        None => None,
        Some(folder_scope) => {
            trust::verify_job_grant(&grant, &folder_scope, FOLDER_READ_CAPABILITY)
                .map_err(|_| "device_grant_invalid".to_owned())?;
            let writable = trust::verify_job_grant(&grant, &folder_scope, FOLDER_WRITE_CAPABILITY).is_ok();
            let root = state
                .agents
                .folder_root(folder_scope)
                .await
                .map_err(|_| "shell_folder_unavailable".to_owned())?;
            Some(SharedFolder { root, writable })
        }
    };
    let stop = Arc::new(AtomicBool::new(false));
    running()
        .lock()
        .map_err(|_| "shell_unavailable".to_owned())?
        .insert(job_id.clone(), stop.clone());
    let _running = RunningJob(job_id);
    agent_shell::run(
        &state.environment.misty_dir(),
        ShellRequest {
            workspace_key: input.workspace_key,
            command: input.command,
            timeout: input.timeout_seconds.map(Duration::from_secs),
            folder,
        },
        stop,
    )
    .await
}

/// Stops a running job, when its run is cancelled or its lease is lost.
#[tauri::command]
pub async fn device_shell_cancel(webview: tauri::Webview, job_id: String) -> Result<(), String> {
    require_device_window(&webview)?;
    if let Some(stop) = running().lock().ok().and_then(|jobs| jobs.get(&job_id).cloned()) {
        stop.store(true, Ordering::Release);
    }
    Ok(())
}

/// Deletes a chat's workspace when the chat is deleted.
#[tauri::command]
pub async fn agents_forget_workspace(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    conversation_id: String,
) -> Result<(), String> {
    require_device_window(&webview)?;
    let misty_dir = state.environment.misty_dir();
    tauri::async_runtime::spawn_blocking(move || agent_shell::forget_workspace(&misty_dir, &conversation_id))
        .await
        .map_err(|error| error.to_string())?
}
