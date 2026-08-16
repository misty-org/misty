//! UI-approved folder proposals. No model-facing path or deletion command exists.
use crate::app::runtime::MistyRuntime;
use misty_agent_files::{Manifest, Organizer, Snapshot, Step};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Manager, State, Webview};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct AgentFilesState {
    engine: Mutex<Option<Organizer>>,
    cancellations: Mutex<HashMap<String, Arc<AtomicBool>>>,
}
fn authorize(webview: &Webview, api_base: &str, account_id: &str) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("Open the main Misty window to organize a folder".into());
    }
    authenticated(api_base, account_id)
}
fn authenticated(api_base: &str, account_id: &str) -> Result<(), String> {
    let url = super::auth_cookies::server(api_base)?;
    super::auth_cookies::current(&url)?.require_account(&url, account_id)
}
fn with_engine<T>(
    app: &tauri::AppHandle,
    state: &AgentFilesState,
    operation: impl FnOnce(&mut Organizer) -> Result<T, String>,
) -> Result<T, String> {
    let mut engine = state
        .engine
        .lock()
        .map_err(|_| "File organizer is unavailable")?;
    if engine.is_none() {
        let runtime = app.state::<MistyRuntime>();
        let directory = runtime
            .environment
            .misty_db_path()
            .parent()
            .ok_or("Device storage is unavailable")?
            .join("agent-file-journal");
        *engine = Some(Organizer::new(directory)?);
    }
    operation(engine.as_mut().unwrap())
}
#[tauri::command]
pub async fn agent_files_choose(
    app: tauri::AppHandle,
    webview: Webview,
    api_base: String,
    account_id: String,
) -> Result<Option<Snapshot>, String> {
    authorize(&webview, &api_base, &account_id)?;
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choose a folder for Misty to organize — changes require a reviewed proposal")
        .pick_folder(move |folder| {
            let _ = send.send(folder);
        });
    let Some(folder) = receive.await.map_err(|_| "Folder selection was canceled")? else {
        return Ok(None);
    };
    authorize(&webview, &api_base, &account_id)?;
    let path = folder.into_path().map_err(|_| "Choose a local folder")?;
    tauri::async_runtime::spawn_blocking(move || {
        authenticated(&api_base, &account_id)?;
        with_engine(&app, &app.state::<AgentFilesState>(), |engine| {
            engine.grant(&account_id, &path)
        })
        .map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn agent_files_prepare(
    app: tauri::AppHandle,
    webview: Webview,
    state: State<'_, AgentFilesState>,
    api_base: String,
    account_id: String,
    grant_id: String,
    plan_id: String,
    steps: Vec<Step>,
) -> Result<Manifest, String> {
    authorize(&webview, &api_base, &account_id)?;
    with_engine(&app, &state, |engine| {
        engine.prepare(&account_id, &grant_id, &plan_id, steps)
    })
}
#[tauri::command]
pub async fn agent_files_apply(
    app: tauri::AppHandle,
    webview: Webview,
    api_base: String,
    account_id: String,
    plan_id: String,
) -> Result<Manifest, String> {
    authorize(&webview, &api_base, &account_id)?;
    let state = app.state::<AgentFilesState>();
    let cancellation = Arc::new(AtomicBool::new(false));
    let key = format!("{account_id}:{plan_id}");
    {
        let mut active = state
            .cancellations
            .lock()
            .map_err(|_| "File organizer unavailable")?;
        if active.contains_key(&key) {
            return Err("This proposal is already being applied".into());
        }
        active.insert(key.clone(), cancellation.clone());
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AgentFilesState>();
        let result = with_engine(&app, &state, |engine| {
            engine.apply(&account_id, &plan_id, || {
                cancellation.load(Ordering::SeqCst)
                    || authenticated(&api_base, &account_id).is_err()
            })
        });
        if let Ok(mut active) = state.cancellations.lock() {
            active.remove(&key);
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?;
    result
}
#[tauri::command]
pub fn agent_files_cancel(
    webview: Webview,
    state: State<'_, AgentFilesState>,
    api_base: String,
    account_id: String,
    plan_id: String,
) -> Result<(), String> {
    authorize(&webview, &api_base, &account_id)?;
    if let Some(flag) = state
        .cancellations
        .lock()
        .map_err(|_| "File organizer unavailable")?
        .get(&format!("{account_id}:{plan_id}"))
    {
        flag.store(true, Ordering::SeqCst);
    }
    Ok(())
}
#[tauri::command]
pub fn agent_files_manifest(
    app: tauri::AppHandle,
    webview: Webview,
    state: State<'_, AgentFilesState>,
    api_base: String,
    account_id: String,
    plan_id: String,
) -> Result<Manifest, String> {
    authorize(&webview, &api_base, &account_id)?;
    with_engine(&app, &state, |engine| {
        engine.manifest(&account_id, &plan_id)
    })
}
#[tauri::command]
pub fn agent_files_undo(
    app: tauri::AppHandle,
    webview: Webview,
    state: State<'_, AgentFilesState>,
    api_base: String,
    account_id: String,
    plan_id: String,
) -> Result<Manifest, String> {
    authorize(&webview, &api_base, &account_id)?;
    with_engine(&app, &state, |engine| engine.undo(&account_id, &plan_id))
}
#[tauri::command]
pub fn agent_files_revoke(
    app: tauri::AppHandle,
    webview: Webview,
    state: State<'_, AgentFilesState>,
    api_base: String,
    account_id: String,
    grant_id: String,
) -> Result<(), String> {
    authorize(&webview, &api_base, &account_id)?;
    // Stop first, then wait for the current indivisible operation to finish before revocation.
    for (key, flag) in state
        .cancellations
        .lock()
        .map_err(|_| "File organizer unavailable")?
        .iter()
    {
        if key.starts_with(&format!("{account_id}:")) {
            flag.store(true, Ordering::SeqCst);
        }
    }
    with_engine(&app, &state, |engine| engine.revoke(&account_id, &grant_id))
}

#[tauri::command]
pub fn agent_files_history(
    app: tauri::AppHandle,
    webview: Webview,
    state: State<'_, AgentFilesState>,
    api_base: String,
    account_id: String,
) -> Result<Vec<Manifest>, String> {
    authorize(&webview, &api_base, &account_id)?;
    with_engine(&app, &state, |engine| engine.history(&account_id))
}

#[tauri::command]
pub fn agent_files_snapshot(
    app: tauri::AppHandle,
    webview: Webview,
    state: State<'_, AgentFilesState>,
    api_base: String,
    account_id: String,
    grant_id: String,
) -> Result<Snapshot, String> {
    authorize(&webview, &api_base, &account_id)?;
    with_engine(&app, &state, |engine| {
        engine.snapshot(&account_id, &grant_id)
    })
}
