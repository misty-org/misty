use std::path::{Path, PathBuf};

use file_access::Access;

#[path = "agent_tools.rs"]
pub(crate) mod tools;

pub fn admit(path: &str, access: Access) -> Result<PathBuf, String> {
    let path = super::asked_path(path.trim())?;
    admit_path(&path, access)
}

pub(crate) fn admit_path(path: &Path, access: Access) -> Result<PathBuf, String> {
    if !path.is_absolute() || !file_access::is_local_path(path) {
        return Err("Agents name full paths on this computer's own drives.".into());
    }
    if path
        .components()
        .any(|part| part.as_os_str() == ".misty-agent-trash")
    {
        return Err("Agent trash is the person's to look over. Nothing was done.".into());
    }
    file_access::disk::check_agent(path, access).map_err(|error| super::failed(path, error))?;
    Ok(path.to_path_buf())
}

#[tauri::command]
pub async fn files_grant_revoke(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<(), String> {
    super::person_window(&webview)?;
    super::blocking(move || {
        permissions::revoke_disk_grant(&app);
        crate::files::search::grant_changed();
        Ok(())
    })
    .await
}
