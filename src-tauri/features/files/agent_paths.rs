//! What an agent may name on the disk. Every path a `files.*` tool is given passes [`admit`]
//! before anything reads or changes it: an absolute local path, the disk grant on, never Misty's
//! own data, a secret or a keychain, and a change only to what the person's own user owns (the
//! item and the folder it is in), so nothing an agent does ever needs an administrator. The
//! tools themselves are in `agent_tools.rs`, and native code has the final say on every call.
use std::path::{Path, PathBuf};

use file_access::Access;

#[path = "agent_tools.rs"]
pub(crate) mod tools;

/// The path an agent named, checked for what it means to do with it (`Read` to look, `Write` to
/// change), or why it can't.
pub fn admit(path: &str, access: Access) -> Result<PathBuf, String> {
    let path = super::asked_path(path.trim())?;
    admit_path(&path, access)
}

/// The same for a path Misty put together from one already admitted (a folder and a new name).
pub(crate) fn admit_path(path: &Path, access: Access) -> Result<PathBuf, String> {
    if !path.is_absolute() || !file_access::is_local_path(path) {
        return Err("Agents name full paths on this computer's own drives.".into());
    }
    // Agent trash on another drive is the person's to look over, never an agent's to change.
    if path.components().any(|part| part.as_os_str() == ".misty-agent-trash") {
        return Err("Agent trash is the person's to look over. Nothing was done.".into());
    }
    file_access::disk::check_agent(path, access).map_err(|error| super::failed(path, error))?;
    Ok(path.to_path_buf())
}

/// Turns the disk grant off, from Settings › Agents › Access: Files goes back to what the rest of
/// Misty can reach, and every agent loses the disk at once. Turning it on is only ever the native
/// prompt (`files_grant`).
#[tauri::command]
pub fn files_grant_revoke(app: tauri::AppHandle, webview: tauri::Webview) -> Result<(), String> {
    super::person_window(&webview)?;
    permissions::revoke_disk_grant(&app);
    Ok(())
}
