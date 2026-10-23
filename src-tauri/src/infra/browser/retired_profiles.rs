//! Device browser profiles became Spaces. Their website data stores are erased once,
//! on the first launch after: the renderer names the ones its saved state still listed.
use super::*;

/// Present once the retired profiles were erased on this device.
fn marker() -> Option<std::path::PathBuf> {
    let home = super::super::paths::misty_home_dir()?;
    let name = match std::env::var("MISTY_PROFILE") {
        Ok(dev) if !dev.is_empty() => format!("retired-device-profiles-{dev}"),
        _ => "retired-device-profiles".into(),
    };
    Some(home.join(name))
}

fn retired(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        && !crate::infra::space_windows::is_space_store(id)
        && !super::super::browser_sync::vault_uses_store(id)
}

/// Erases the stores of the device profiles this window's saved state listed. Runs
/// once per device; a store a Space or vault uses is never touched.
#[tauri::command]
pub async fn browser_retired_profiles_erase(
    webview: Webview,
    app: AppHandle,
    profile_ids: Vec<String>,
) -> Result<(), String> {
    if !crate::infra::space_windows::is_person_window(webview.label()) || profile_ids.len() > 100 {
        return Err("Only a Space window can erase retired profiles.".into());
    }
    let marker = marker().ok_or("Misty's data folder is unavailable.")?;
    if marker.exists() {
        return Ok(());
    }
    for id in profile_ids.into_iter().filter(|id| retired(id)) {
        if let Err(error) = super::profile_cleanup::remove(app.clone(), id).await {
            eprintln!("Could not erase a retired browser profile: {error}");
        }
    }
    std::fs::write(&marker, b"").map_err(|error| error.to_string())
}
