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

use crate::agents::shell::{self, SharedFolder, ShellOutcome, ShellRequest};
use crate::app::runtime::MistyRuntime;
use crate::devices::agent_grants::{self, AGENT_SCOPE};
use crate::devices::commands::{local_device_id, require_device_window};
use crate::devices::records::SignedRecord;

const SHELL_CAPABILITY: &str = "shell.run";
const FOLDER_READ_CAPABILITY: &str = "folder.read";
const FOLDER_WRITE_CAPABILITY: &str = "folder.write";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShellJobInput {
    command: String,
    #[serde(default)]
    timeout_seconds: Option<u64>,
    #[serde(default)]
    folder_scope_id: Option<String>,
}

fn running() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static RUNNING: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    RUNNING.get_or_init(Default::default)
}

struct RunningJob(String);

impl Drop for RunningJob {
    fn drop(&mut self) {
        if let Ok(mut jobs) = running().lock() {
            jobs.remove(&self.0);
        }
    }
}

fn workspace_key(account_id: &str, chat_key: &str) -> String {
    format!("{account_id}\n{chat_key}")
}

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
    let device = local_device_id(&state)
        .await
        .map_err(|_| "device_grant_invalid".to_owned())?;
    let verified = agent_grants::verify(&device, &grant, &scope_id, SHELL_CAPABILITY)?;
    if verified.chat_key.is_empty() {
        return Err("device_grant_invalid".to_owned());
    }
    let input: ShellJobInput =
        serde_json::from_value(input).map_err(|_| "shell_job_invalid".to_owned())?;
    let folder = match input.folder_scope_id {
        None => None,
        Some(folder_scope) => {
            agent_grants::verify(&device, &grant, &folder_scope, FOLDER_READ_CAPABILITY)?;
            let writable =
                agent_grants::verify(&device, &grant, &folder_scope, FOLDER_WRITE_CAPABILITY)
                    .is_ok()
                    && state
                        .agents
                        .folder_changes_allowed(verified.chat_key.clone(), folder_scope.clone())
                        .await;
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
    shell::run(
        &state.environment.misty_dir(),
        ShellRequest {
            workspace_key: workspace_key(&verified.account_id, &verified.chat_key),
            command: input.command,
            timeout: input.timeout_seconds.map(Duration::from_secs),
            folder,
        },
        stop,
    )
    .await
}

#[tauri::command]
pub async fn device_shell_cancel(webview: tauri::Webview, job_id: String) -> Result<(), String> {
    require_device_window(&webview)?;
    if let Some(stop) = running()
        .lock()
        .ok()
        .and_then(|jobs| jobs.get(&job_id).cloned())
    {
        stop.store(true, Ordering::Release);
    }
    Ok(())
}

#[tauri::command]
pub async fn agents_forget_workspace(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    conversation_id: String,
) -> Result<(), String> {
    require_device_window(&webview)?;
    let misty_dir = state.environment.misty_dir();
    let _ = state
        .agents
        .stop_folder_changes(conversation_id.clone(), None)
        .await;
    let key = workspace_key(AGENT_SCOPE, &conversation_id);
    tauri::async_runtime::spawn_blocking(move || shell::forget_workspace(&misty_dir, &key))
        .await
        .map_err(|error| error.to_string())?
}
