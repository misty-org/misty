//! Space/session authorization and event forwarding for the downloaded terminal.
use super::{
    document_intelligence::ServiceLease, native_process_worker::ProcessWorker as TerminalWorker,
};
use crate::platform::mini_app::MiniAppState;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
};
use tauri::{AppHandle, Emitter, State, Webview};
#[derive(Clone)]
struct Session {
    instance: String,
    lease: Arc<ServiceLease>,
    worker: Arc<TerminalWorker>,
}
fn sessions() -> &'static Mutex<HashMap<String, Session>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, Session>>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}
fn host(view: &Webview) -> Result<(), String> {
    if view.label() == "main" {
        Ok(())
    } else {
        Err("Only the Host can access terminal services.".into())
    }
}
fn owned(instance: &str, id: &str) -> Result<Session, String> {
    let sessions = sessions()
        .lock()
        .map_err(|_| "Terminal registry unavailable.")?;
    let session = sessions.get(id).ok_or("Terminal session is closed.")?;
    if session.instance != instance {
        return Err("Terminal belongs to another app instance.".into());
    }
    Ok(session.clone())
}
#[tauri::command]
pub async fn terminal_service_create(
    app: AppHandle,
    webview: Webview,
    instance: String,
    request: Value,
    native: State<'_, MiniAppState>,
) -> Result<String, String> {
    host(&webview)?;
    let lease = Arc::new(ServiceLease::acquire_terminal(&native, &instance).await?);
    let id = uuid::Uuid::new_v4().to_string();
    let event_id = id.clone();
    let event_lease = lease.clone();
    let events = Arc::new(move |event: Value| {
        if event["event"] == "output" {
            let present = sessions()
                .lock()
                .is_ok_and(|sessions| sessions.contains_key(&event_id));
            if present && !event_lease.cancelled() {
                let _ = app.emit_to(
                    "main",
                    "misty://terminal-output",
                    json!({"sessionId":event_id,"data":event["data"]}),
                );
            }
        } else if event["event"] == "exit" {
            if let Ok(mut sessions) = sessions().lock() {
                sessions.remove(&event_id);
            }
            let _ = app.emit_to(
                "main",
                "misty://terminal-exit",
                json!({"sessionId":event_id,"exitCode":event["exitCode"]}),
            );
        }
    });
    let spawn_lease = lease.clone();
    let worker = Arc::new(
        tokio::task::spawn_blocking(move || TerminalWorker::launch(spawn_lease, events))
            .await
            .map_err(|e| e.to_string())??,
    );
    sessions()
        .lock()
        .map_err(|_| "Terminal registry unavailable.")?
        .insert(
            id.clone(),
            Session {
                instance: instance.clone(),
                lease: lease.clone(),
                worker: worker.clone(),
            },
        );
    let running = worker.clone();
    let result = tokio::task::spawn_blocking(move || {
        running.call(json!({"operation":"create","request":request}))
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|result| result);
    if let Err(error) = result.and_then(|_| lease.validate(&native, &instance)) {
        worker.close();
        if let Ok(mut sessions) = sessions().lock() {
            sessions.remove(&id);
        }
        return Err(error);
    }
    Ok(id)
}
#[tauri::command]
pub async fn terminal_service_call(
    webview: Webview,
    instance: String,
    session_id: String,
    command: Value,
    native: State<'_, MiniAppState>,
) -> Result<Value, String> {
    host(&webview)?;
    if !matches!(
        command["operation"].as_str(),
        Some("write" | "resize" | "interrupt")
    ) {
        return Err("Unsupported terminal operation.".into());
    }
    let session = owned(&instance, &session_id)?;
    session.lease.validate(&native, &instance)?;
    let worker = session.worker.clone();
    let result = tokio::task::spawn_blocking(move || worker.call(command))
        .await
        .map_err(|e| e.to_string())??;
    session.lease.validate(&native, &instance)?;
    Ok(result)
}
#[tauri::command]
pub fn terminal_service_close(
    webview: Webview,
    instance: String,
    session_id: String,
) -> Result<(), String> {
    host(&webview)?;
    let mut sessions = sessions()
        .lock()
        .map_err(|_| "Terminal registry unavailable.")?;
    if let Some(session) = sessions.get(&session_id) {
        if session.instance != instance {
            return Err("Terminal belongs to another app instance.".into());
        }
        session.worker.close();
        sessions.remove(&session_id);
    }
    Ok(())
}
#[tauri::command]
pub async fn terminal_service_request(
    webview: Webview,
    instance: String,
    command: Value,
    native: State<'_, MiniAppState>,
) -> Result<Value, String> {
    host(&webview)?;
    if !matches!(
        command["operation"].as_str(),
        Some("sshEnvironments" | "sshPreflight" | "sshTrust")
    ) {
        return Err("Unsupported SSH operation.".into());
    }
    let lease = Arc::new(ServiceLease::acquire_terminal(&native, &instance).await?);
    let spawn_lease = lease.clone();
    let result = tokio::task::spawn_blocking(move || {
        let worker = TerminalWorker::launch(spawn_lease, Arc::new(|_| {}))?;
        worker.call(command)
    })
    .await
    .map_err(|e| e.to_string())??;
    lease.validate(&native, &instance)?;
    Ok(result)
}
