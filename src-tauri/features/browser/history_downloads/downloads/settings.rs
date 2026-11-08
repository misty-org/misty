//! Where downloads go: the chosen folder, and whether to ask each time.
use super::*;

pub(in crate::browser) fn browser_download_directory(
    app: &AppHandle,
    agent_download: bool,
) -> Option<PathBuf> {
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

pub(in crate::browser) static ASK_DOWNLOAD_LOCATION: AtomicBool = AtomicBool::new(false);

#[cfg_attr(not(any(target_os = "macos", windows)), allow(dead_code))]
pub(in crate::browser) fn ask_download_location() -> bool {
    ASK_DOWNLOAD_LOCATION.load(Ordering::Relaxed)
}

/// Whether to ask where to save each download.
#[tauri::command]
pub fn browser_set_download_prompt(enabled: bool) {
    ASK_DOWNLOAD_LOCATION.store(enabled, Ordering::Relaxed);
}

pub(in crate::browser) fn user_download_directory() -> &'static Mutex<Option<PathBuf>> {
    static DIRECTORY: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();
    DIRECTORY.get_or_init(Mutex::default)
}

/// `profile_state` refuses `grant:` scopes, so a window can't write this.
const CHOSEN_FOLDER_SCOPE: &str = "grant:download-folder";

fn chosen_folder_record(app: &AppHandle) -> Option<PathBuf> {
    let runtime = app.try_state::<crate::app::runtime::MistyRuntime>()?;
    let connection = runtime.environment.store().connect().ok()?;
    connection
        .query_row(
            "SELECT document FROM settings_state WHERE scope = ?1",
            [CHOSEN_FOLDER_SCOPE],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .map(PathBuf::from)
}

fn save_chosen_folder_record(app: &AppHandle, folder: &Path) -> Result<(), String> {
    let runtime = app
        .try_state::<crate::app::runtime::MistyRuntime>()
        .ok_or("Download settings are unavailable.")?;
    let connection = runtime
        .environment
        .store()
        .connect()
        .map_err(|_| "Download settings are unavailable.".to_owned())?;
    connection
        .execute(
            "INSERT INTO settings_state (scope, revision, document) VALUES (?1, 1, ?2)
             ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, document = excluded.document",
            rusqlite::params![CHOSEN_FOLDER_SCOPE, folder.to_string_lossy()],
        )
        .map_err(|_| "Download settings are unavailable.".to_owned())?;
    Ok(())
}

/// Asks the person for a download folder in the system's dialog and remembers the answer. This is
/// the only way one gets chosen, since a window could otherwise name any folder and be given write
/// access to it. Returns the folder, or nothing if they cancel.
#[tauri::command]
pub async fn browser_choose_download_directory(
    app: AppHandle,
    webview: Webview,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Choose a download folder from your own window.".to_owned());
    }
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choose a download folder")
        .pick_folder(move |folder| {
            let _ = send.send(folder);
        });
    let Some(folder) = receive.await.ok().flatten() else {
        return Ok(None);
    };
    let path = folder
        .into_path()
        .map_err(|_| "Choose a folder on this computer.".to_owned())?;
    let home = dirs::home_dir().ok_or("Choose a folder for downloads.")?;
    let folder = crate::app::trusted_windows::synced_paths::download_directory(&path, &home)
        .ok_or("Choose a folder in your home folder or on an external drive.")?;
    save_chosen_folder_record(&app, &folder)?;
    Ok(Some(folder.to_string_lossy().into_owned()))
}

/// Applies the folder from Browser settings; empty restores the Downloads folder. Anything but the
/// folder the person chose natively keeps the Downloads folder.
#[tauri::command]
pub fn browser_set_download_directory(app: AppHandle, directory: String) -> Result<(), String> {
    let path = PathBuf::from(directory.trim());
    let chosen = if directory.trim().is_empty() {
        None
    } else if path.is_absolute() {
        let home = dirs::home_dir().ok_or("Choose a folder for downloads.")?;
        let safe = crate::app::trusted_windows::synced_paths::download_directory(&path, &home)
            .filter(|folder| chosen_folder_record(&app).as_deref() == Some(folder.as_path()));
        if safe.is_none() {
            file_access::set_chosen_download_folder(None);
            *user_download_directory()
                .lock()
                .map_err(|_| "Download settings are unavailable.".to_owned())? = None;
            return Err("Choose a folder in your home folder or on an external drive.".to_owned());
        }
        safe
    } else {
        return Err("Choose a folder for downloads.".to_owned());
    };
    // The person chose this one, so it counts as granted.
    file_access::set_chosen_download_folder(chosen.as_deref());
    *user_download_directory()
        .lock()
        .map_err(|_| "Download settings are unavailable.".to_owned())? = chosen;
    Ok(())
}
