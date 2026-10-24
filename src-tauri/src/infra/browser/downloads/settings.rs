//! Where downloads go: the chosen folder, and whether to ask each time.
use super::*;

pub(in crate::infra::browser) fn browser_download_directory(app: &AppHandle, agent_download: bool) -> Option<PathBuf> {
    // Agent outputs are task intermediates for verified upload, not user-managed
    // downloads. Keep them in the app's cache rather than requiring macOS access
    // to the user's protected Downloads folder from a WKDownload callback.
    if agent_download {
        return app
            .path()
            .app_cache_dir()
            .ok()
            .map(|path| path.join("agent-downloads"));
    }

    {
        let chosen = user_download_directory()
            .lock()
            .ok()
            .and_then(|directory| directory.clone());
        chosen.or_else(|| dirs::download_dir().filter(|path| path.is_absolute()))
    }
}

pub(in crate::infra::browser) static ASK_DOWNLOAD_LOCATION: AtomicBool = AtomicBool::new(false);

#[cfg_attr(not(any(target_os = "macos", windows)), allow(dead_code))]
pub(in crate::infra::browser) fn ask_download_location() -> bool {
    ASK_DOWNLOAD_LOCATION.load(Ordering::Relaxed)
}

/// Whether to ask where to save each download.
#[tauri::command]
pub fn browser_set_download_prompt(enabled: bool) {
    ASK_DOWNLOAD_LOCATION.store(enabled, Ordering::Relaxed);
}

pub(in crate::infra::browser) fn user_download_directory() -> &'static Mutex<Option<PathBuf>> {
    static DIRECTORY: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();
    DIRECTORY.get_or_init(Mutex::default)
}

/// The folder chosen in Browser settings; empty restores the Downloads folder.
#[tauri::command]
pub fn browser_set_download_directory(directory: String) -> Result<(), String> {
    let path = PathBuf::from(directory.trim());
    let chosen = if directory.trim().is_empty() {
        None
    } else if path.is_absolute() {
        // The folder syncs with the account's settings, so it is checked here
        // rather than trusted; anything else keeps the Downloads folder.
        let home = dirs::home_dir().ok_or("Choose a folder for downloads.")?;
        let safe = crate::platform::synced_paths::download_directory(&path, &home);
        if safe.is_none() {
            *user_download_directory()
                .lock()
                .map_err(|_| "Download settings are unavailable.".to_owned())? = None;
            return Err("Choose a folder in your home folder or on an external drive.".to_owned());
        }
        safe
    } else {
        return Err("Choose a folder for downloads.".to_owned());
    };
    *user_download_directory()
        .lock()
        .map_err(|_| "Download settings are unavailable.".to_owned())? = chosen;
    Ok(())
}
