use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Webview};

use crate::browser::app_windows;
use file_access;
use permissions::Permission;

const DOWNLOADS_ID: &str = "grant-downloads";

fn require_person_window(webview: &Webview) -> Result<(), String> {
    if app_windows::is_person_window(webview.label()) {
        Ok(())
    } else {
        Err("Only a person's own Misty window can change this.".to_owned())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxPermissionRow {
    pub id: &'static str,
    pub label: &'static str,
    pub on: bool,
}

#[tauri::command]
pub fn sandbox_permissions_list(
    webview: Webview,
    app: AppHandle,
) -> Result<Vec<SandboxPermissionRow>, String> {
    require_person_window(&webview)?;
    let mut rows: Vec<SandboxPermissionRow> = Permission::ALL
        .into_iter()
        .map(|permission| SandboxPermissionRow {
            id: permission.id(),
            label: permission.label(),
            on: permissions::is_on(&app, permission),
        })
        .collect();
    rows.push(SandboxPermissionRow {
        id: DOWNLOADS_ID,
        label: "Downloads folder",
        on: permissions::downloads_granted(&app),
    });
    Ok(rows)
}

#[tauri::command]
pub fn sandbox_permission_set(
    webview: Webview,
    app: AppHandle,
    id: String,
    on: bool,
) -> Result<(), String> {
    require_person_window(&webview)?;
    if id == DOWNLOADS_ID {
        if on {
            return Err("Misty asks about the Downloads folder on your next download.".to_owned());
        }
        permissions::revoke_downloads_folder(&app);
        return Ok(());
    }
    let permission = Permission::from_id(&id).ok_or("Unknown permission.")?;
    permissions::set(&app, permission, on);
    Ok(())
}

fn free_name(folder: &std::path::Path, name: &str) -> PathBuf {
    let wanted = folder.join(name);
    if file_access::fs::metadata(&wanted).is_err() {
        return wanted;
    }
    let (stem, extension) = match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem, format!(".{extension}")),
        _ => (name, String::new()),
    };
    (2..)
        .map(|count| folder.join(format!("{stem} {count}{extension}")))
        .find(|path| file_access::fs::metadata(path).is_err())
        .unwrap_or(wanted)
}

#[tauri::command]
pub async fn sandbox_pick_save_file(
    webview: Webview,
    title: Option<String>,
    default_name: String,
) -> Result<Option<String>, String> {
    let name = std::path::Path::new(&default_name)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .ok_or("Give the file a name.")?;
    let title = title.unwrap_or_else(|| format!("Choose where to save {name}"));
    let pick = crate::files::pick::Pick::folder(&title);
    let Some(folder) = crate::files::pick::pick_one(&webview, pick).await? else {
        return Ok(None);
    };
    let path = free_name(&folder, &name);
    file_access::allow_picked_file(&path, file_access::Access::Write);
    Ok(Some(path.to_string_lossy().into_owned()))
}
