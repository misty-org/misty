use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::Duration,
};

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

static WATCHERS: OnceLock<Mutex<HashMap<String, RecommendedWatcher>>> = OnceLock::new();

fn watchers() -> &'static Mutex<HashMap<String, RecommendedWatcher>> {
    WATCHERS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CodeFileEvent {
    watcher_id: String,
    root: String,
    paths: Vec<String>,
    kind: String,
}

fn kind_label(kind: &EventKind) -> &'static str {
    match kind {
        EventKind::Create(_) => "create",
        EventKind::Modify(_) => "modify",
        EventKind::Remove(_) => "remove",
        _ => "other",
    }
}

#[tauri::command]
pub async fn code_watch_dir(app: AppHandle, root: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || watch_dir_blocking(app, root))
        .await
        .map_err(|error| error.to_string())?
}

fn watch_dir_blocking(app: AppHandle, root: String) -> Result<String, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err("Root is not a folder.".to_owned());
    }
    let watcher_id = Uuid::new_v4().to_string();
    let emit_id = watcher_id.clone();
    let emit_root = root_path.to_string_lossy().into_owned();
    let emit_app = app.clone();
    let ignore_root = root_path.clone();

    let mut watcher: RecommendedWatcher =
        notify::recommended_watcher(move |result: notify::Result<Event>| {
            let Ok(event) = result else { return };
            let kind = kind_label(&event.kind);
            if kind == "other" {
                return;
            }
            let paths: Vec<String> = event
                .paths
                .into_iter()
                .filter(|path| !should_ignore(path, &ignore_root))
                .map(|path| path.to_string_lossy().into_owned())
                .collect();
            if paths.is_empty() {
                return;
            }
            let _ = emit_app.emit(
                "misty://code-file-event",
                CodeFileEvent {
                    watcher_id: emit_id.clone(),
                    root: emit_root.clone(),
                    paths,
                    kind: kind.to_owned(),
                },
            );
        })
        .map_err(|error| error.to_string())?;

    watcher
        .configure(Config::default().with_poll_interval(Duration::from_secs(4)))
        .map_err(|error| error.to_string())?;
    watcher
        .watch(&root_path, RecursiveMode::Recursive)
        .map_err(|error| error.to_string())?;

    watchers()
        .lock()
        .map_err(|_| "Watcher registry unavailable.".to_owned())?
        .insert(watcher_id.clone(), watcher);
    Ok(watcher_id)
}

#[tauri::command]
pub async fn code_stop_watch(watcher_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || stop_watch_blocking(watcher_id))
        .await
        .map_err(|error| error.to_string())?
}

fn stop_watch_blocking(watcher_id: String) -> Result<(), String> {
    if let Ok(mut registry) = watchers().lock() {
        registry.remove(&watcher_id);
    }
    Ok(())
}

fn should_ignore(path: &Path, root: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return false;
    };
    relative.components().any(|component| {
        let name = component.as_os_str().to_string_lossy();
        matches!(
            name.as_ref(),
            ".git"
                | "node_modules"
                | ".next"
                | "dist"
                | "target"
                | "build"
                | ".venv"
                | "__pycache__"
                | ".turbo"
                | ".pnpm-store"
        )
    })
}
