use std::time::Duration;

use serde::{Deserialize, Serialize};
use space_drive::{
    DriveEntry, DriveStatus, EntryPage, ItemId, SpaceId, TrashBy, TrashEntry, Version,
};
use tauri::{AppHandle, Webview};

use super::{drive, error_text, SpaceRef};
use crate::project::person_window;

fn space_of(space_id: &str) -> Result<SpaceId, String> {
    if space_id.is_empty() || space_id.len() > 128 {
        return Err("That isn't a Space.".into());
    }
    Ok(SpaceId(space_id.to_owned()))
}

fn item_of(item_id: &str) -> Result<ItemId, String> {
    if !ItemId::is_valid(item_id) {
        return Err("That isn't an item of the drive.".into());
    }
    Ok(ItemId(item_id.to_owned()))
}

fn node_id(space: &SpaceId, path: &str) -> Result<ItemId, String> {
    drive()?
        .node_at(space, path)
        .map_err(error_text)?
        .map(|node| node.id)
        .ok_or_else(|| "It isn't there any more.".to_string())
}

#[tauri::command]
pub async fn drive_sync_spaces(
    app: AppHandle,
    webview: Webview,
    server: String,
    account_id: String,
    spaces: Vec<SpaceRef>,
    person_name: Option<String>,
) -> Result<Vec<DriveStatus>, String> {
    person_window(&webview)?;
    super::sync_spaces(&app, &server, &account_id, spaces, person_name)
}

#[tauri::command]
pub async fn drive_realtime_event(
    webview: Webview,
    space_id: String,
    r#type: String,
    payload: serde_json::Value,
    created_at: Option<String>,
) -> Result<(), String> {
    person_window(&webview)?;
    if !r#type.starts_with("drive.") {
        return Ok(());
    }
    let space = space_of(&space_id)?;
    let age = created_at
        .and_then(|at| chrono::DateTime::parse_from_rfc3339(&at).ok())
        .map(|at| {
            let elapsed = chrono::Utc::now().signed_duration_since(at.with_timezone(&chrono::Utc));
            Duration::from_millis(elapsed.num_milliseconds().max(0) as u64)
        });
    let drive = drive()?;
    drive.realtime(&space, &r#type, &payload, age).await;
    Ok(())
}

#[tauri::command]
pub async fn drive_status(webview: Webview) -> Result<Vec<DriveStatus>, String> {
    person_window(&webview)?;
    Ok(super::all_statuses())
}

#[tauri::command]
pub async fn drive_set_cache_limit(
    app: AppHandle,
    webview: Webview,
    bytes: Option<u64>,
) -> Result<Option<u64>, String> {
    use tauri::Manager;
    person_window(&webview)?;
    let store = app
        .state::<crate::app::runtime::MistyRuntime>()
        .environment
        .store();
    let limit = tokio::task::spawn_blocking(move || super::device::set_cache_limit(&store, bytes))
        .await
        .map_err(|error| error.to_string())??;
    if let Ok(drive) = drive() {
        drive.set_cache_limit(limit);
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn drive_list(
    webview: Webview,
    space_id: String,
    path: String,
    cursor: Option<String>,
    limit: Option<usize>,
) -> Result<EntryPage, String> {
    person_window(&webview)?;
    let space = space_of(&space_id)?;
    drive()?
        .entries(&space, &path, cursor.as_deref(), limit)
        .map_err(error_text)
}

#[tauri::command]
pub async fn drive_entry(
    webview: Webview,
    space_id: String,
    path: Option<String>,
    item_id: Option<String>,
) -> Result<Option<DriveEntry>, String> {
    person_window(&webview)?;
    let space = space_of(&space_id)?;
    let drive = drive()?;
    match (path, item_id) {
        (_, Some(item_id)) => drive
            .entry_by_id(&space, &item_of(&item_id)?)
            .map_err(error_text),
        (Some(path), None) => drive.entry(&space, &path).map_err(error_text),
        (None, None) => Err("Name a path or an item.".into()),
    }
}

#[tauri::command]
pub async fn drive_read(
    webview: Webview,
    space_id: String,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    person_window(&webview)?;
    let space = space_of(&space_id)?;
    let bytes = drive()?
        .read_bytes(&space, &path)
        .await
        .map_err(error_text)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[derive(Debug, Deserialize)]
pub struct Replace {
    pub item_id: String,
    pub version: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteHead {
    space_id: String,
    folder: String,
    name: String,
    #[serde(default)]
    replace: Option<Replace>,
}

fn bytes_from_json(value: &serde_json::Value) -> Result<Vec<u8>, String> {
    use serde_json::Value;
    let byte = |item: &Value| item.as_u64().and_then(|byte| u8::try_from(byte).ok());
    let bytes: Option<Vec<u8>> = match value {
        Value::Null => Some(Vec::new()),
        Value::Array(items) => items.iter().map(byte).collect(),
        Value::Object(fields) => (0..fields.len())
            .map(|index| fields.get(&index.to_string()).and_then(byte))
            .collect(),
        _ => None,
    };
    bytes.ok_or_else(|| "Expected the file's bytes.".to_owned())
}

#[tauri::command]
pub async fn drive_write(
    webview: Webview,
    request: tauri::ipc::Request<'_>,
) -> Result<DriveEntry, String> {
    person_window(&webview)?;
    let meta = request
        .headers()
        .get("x-misty-request")
        .and_then(|value| value.to_str().ok())
        .ok_or("Missing request metadata")?;
    if meta.len() > 65536 {
        return Err("Request metadata too large".into());
    }
    let meta = percent_encoding::percent_decode_str(meta)
        .decode_utf8()
        .map_err(|_| "Invalid request metadata")?;
    let WriteHead {
        space_id,
        folder,
        name,
        replace,
    } = serde_json::from_str(&meta).map_err(|_| "Invalid request metadata")?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        tauri::ipc::InvokeBody::Json(value) => bytes_from_json(value)?,
    };
    let space = space_of(&space_id)?;
    let replace = match replace {
        Some(replace) => Some((item_of(&replace.item_id)?, Version(replace.version))),
        None => None,
    };
    let drive = drive()?;
    tokio::task::spawn_blocking(move || drive.write_bytes(&space, &folder, &name, &bytes, replace))
        .await
        .map_err(|error| error.to_string())?
        .map_err(error_text)
}

#[tauri::command]
pub async fn drive_open(
    webview: Webview,
    space_id: String,
    path: String,
    editing: bool,
) -> Result<(), String> {
    person_window(&webview)?;
    let space = space_of(&space_id)?;
    let id = node_id(&space, &path)?;
    drive()?
        .open(&space, &id, editing)
        .await
        .map_err(error_text)
}

#[tauri::command]
pub async fn drive_close(
    webview: Webview,
    space_id: String,
    path: String,
    editing: Option<bool>,
) -> Result<(), String> {
    person_window(&webview)?;
    let space = space_of(&space_id)?;
    let id = node_id(&space, &path)?;
    drive()?.close(&space, &id, editing.unwrap_or(false)).await;
    Ok(())
}

#[tauri::command]
pub async fn drive_set_paused(webview: Webview, paused: bool) -> Result<bool, String> {
    person_window(&webview)?;
    let drive = drive()?;
    drive.set_paused(paused);
    Ok(drive.paused())
}

#[tauri::command]
pub async fn drive_paused(webview: Webview) -> Result<bool, String> {
    person_window(&webview)?;
    Ok(drive()?.paused())
}

#[tauri::command]
pub async fn drive_keep_downloaded(
    webview: Webview,
    space_id: String,
    path: String,
    keep: bool,
) -> Result<(), String> {
    person_window(&webview)?;
    let space = space_of(&space_id)?;
    drive()?
        .keep_downloaded(&space, &path, keep)
        .await
        .map_err(error_text)
}

#[tauri::command]
pub async fn drive_remove_download(
    webview: Webview,
    space_id: String,
    path: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let space = space_of(&space_id)?;
    drive()?.remove_download(&space, &path).map_err(error_text)
}

#[tauri::command]
pub async fn drive_trash(webview: Webview, space_id: String, path: String) -> Result<(), String> {
    person_window(&webview)?;
    let space = space_of(&space_id)?;
    let id = node_id(&space, &path)?;
    drive()?
        .trash_now(&space, &id, TrashBy::Person)
        .await
        .map_err(error_text)
}

#[tauri::command]
pub async fn drive_trash_list(
    webview: Webview,
    space_id: String,
) -> Result<Vec<TrashEntry>, String> {
    person_window(&webview)?;
    let space = space_of(&space_id)?;
    let drive = drive()?;
    let mut out = Vec::new();
    let mut after: Option<String> = None;
    for _ in 0..20 {
        let (entries, next) = drive
            .trash_list(&space, after.as_deref(), 200)
            .await
            .map_err(error_text)?;
        out.extend(entries);
        match next {
            Some(next) => after = Some(next),
            None => break,
        }
    }
    Ok(out)
}

#[derive(Debug, Serialize)]
pub struct Restored {
    pub item_id: ItemId,
    pub name: String,
}

#[tauri::command]
pub async fn drive_restore_burst(
    webview: Webview,
    space_id: String,
    burst: String,
) -> Result<u64, String> {
    person_window(&webview)?;
    let space = space_of(&space_id)?;
    drive()?
        .restore_burst(&space, &burst)
        .await
        .map_err(error_text)
}

#[tauri::command]
pub async fn drive_restore(
    app: AppHandle,
    webview: Webview,
    space_id: String,
    item_id: String,
) -> Result<Restored, String> {
    person_window(&webview)?;
    let space = space_of(&space_id)?;
    let id = item_of(&item_id)?;
    let item = drive()?.restore(&space, &id).await.map_err(error_text)?;
    super::forget_agent_trash(&app, &space_id, &item_id);
    Ok(Restored {
        item_id: item.id,
        name: item.name,
    })
}

#[tauri::command]
pub async fn drive_purge(
    app: AppHandle,
    webview: Webview,
    space_id: String,
    item_id: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let space = space_of(&space_id)?;
    let id = item_of(&item_id)?;
    drive()?.purge(&space, &id).await.map_err(error_text)?;
    super::forget_agent_trash(&app, &space_id, &item_id);
    Ok(())
}

#[tauri::command]
pub async fn drive_copy_in(
    webview: Webview,
    space_id: String,
    source: String,
    folder: String,
) -> Result<DriveEntry, String> {
    person_window(&webview)?;
    let space = space_of(&space_id)?;
    let source = crate::spaces_folders::picked_folder(&source)?;
    let drive = drive()?;
    tokio::task::spawn_blocking(move || drive.copy_in(&space, &source, &folder))
        .await
        .map_err(|error| error.to_string())?
        .map(|(entry, _)| entry)
        .map_err(error_text)
}

#[tauri::command]
pub async fn drive_reveal(
    app: AppHandle,
    webview: Webview,
    space_id: String,
    path: Option<String>,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    person_window(&webview)?;
    let space = space_of(&space_id)?;
    let drive = drive()?;
    let mount = drive
        .mount_of(&space)
        .ok_or("That Space's drive isn't on this computer.")?;
    let drive_path = space_drive::names::drive_path(path.as_deref().unwrap_or("/"))?;
    if drive_path == space_drive::names::ROOT {
        return app
            .opener()
            .open_path(mount.path.to_string_lossy().into_owned(), None::<&str>)
            .map_err(|error| error.to_string());
    }
    if drive
        .node_at(&space, &drive_path)
        .map_err(error_text)?
        .is_none()
    {
        return Err("It isn't there any more.".into());
    }
    let local = space_drive::names::local_path(&mount.path, &drive_path);
    app.opener()
        .reveal_item_in_dir(local)
        .map_err(|error| error.to_string())
}
