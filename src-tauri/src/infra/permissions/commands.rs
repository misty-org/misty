//! What Settings and the save dialogs call. Windows can read and change these, never by themselves
//! adding a path: a path only becomes reachable from a native dialog's own answer.
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Webview};
use tauri_plugin_dialog::DialogExt;

use super::{downloads, store, Permission};
use crate::infra::{file_access, profile_windows};

const DOWNLOADS_ID: &str = "grant-downloads";

fn require_person_window(webview: &Webview) -> Result<(), String> {
    if profile_windows::is_person_window(webview.label()) {
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

/// Everything Settings › Agents › Access shows: each permission, then the Downloads grant.
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
            on: super::is_on(&app, permission),
        })
        .collect();
    rows.push(SandboxPermissionRow {
        id: DOWNLOADS_ID,
        label: "Downloads folder",
        on: downloads::downloads_granted(&app),
    });
    Ok(rows)
}

/// A switch in Settings. The Downloads grant can only be revoked here: it's given by the prompt on
/// the first download, so saying yes to it has one place.
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
        downloads::revoke_downloads_folder(&app);
        return Ok(());
    }
    let permission = Permission::from_id(&id).ok_or("Unknown permission.")?;
    store::write(&app, permission.scope(), on);
    permission.apply_to_gate(on);
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct SaveFileFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

/// Asks where to save with the system's dialog and grants that one file. The dialog runs here, not
/// in the window, so the window can't name a path of its own. `None` when the person cancels.
#[tauri::command]
pub async fn sandbox_pick_save_file(
    app: AppHandle,
    title: Option<String>,
    default_name: String,
    filters: Vec<SaveFileFilter>,
) -> Result<Option<String>, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let mut dialog = app.dialog().file().set_file_name(&default_name);
    if let Some(title) = title {
        dialog = dialog.set_title(title);
    }
    for filter in &filters {
        let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
        dialog = dialog.add_filter(&filter.name, &extensions);
    }
    dialog.save_file(move |file| {
        let _ = send.send(file);
    });
    let Some(file) = receive.await.ok().flatten() else {
        return Ok(None);
    };
    let path: PathBuf = file
        .into_path()
        .map_err(|_| "Choose a location on this computer.".to_owned())?;
    file_access::allow_picked_file(&path, file_access::Access::Write);
    Ok(Some(path.to_string_lossy().into_owned()))
}
