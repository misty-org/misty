//! Device browser profiles were retired. Their website data stores are erased once, on the
//! first launch after: the renderer names the ones its saved state still listed.
use crate::browser::*;
use file_access::fs;

/// Present once the retired profiles were erased on this device.
fn marker() -> Option<std::path::PathBuf> {
    Some(file_access::paths::misty_home_dir()?.join("retired-device-profiles"))
}

fn retired(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        && !crate::browser::app_windows::is_profile_store(id)
}

/// Erases the stores of the device profiles this window's saved state listed. Runs
/// once per computer; a store a profile uses is never touched.
#[tauri::command]
pub async fn browser_retired_profiles_erase(
    webview: Webview,
    app: AppHandle,
    profile_ids: Vec<String>,
) -> Result<(), String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) || profile_ids.len() > 100 {
        return Err("Only a profile's window can erase retired profiles.".into());
    }
    let marker = marker().ok_or("Misty's data folder is unavailable.")?;
    if fs::exists(&marker) {
        return Ok(());
    }
    for id in profile_ids.into_iter().filter(|id| retired(id)) {
        if let Err(error) = super::store_cleanup::remove(app.clone(), id).await {
            eprintln!("Could not erase a retired browser profile: {error}");
        }
    }
    fs::write(&marker, b"").map_err(|error| error.to_string())
}
