//! The Downloads folder's grant: `grant:downloads` in `settings_state`, asked on the first download.
use std::path::PathBuf;

use tauri::AppHandle;

use super::{ask, store, Asking, Prompt};
use crate::infra::file_access;

const SCOPE: &str = "grant:downloads";

const PROMPT: Prompt = Prompt {
    title: "Save downloads to your Downloads folder?",
    message:
        "Misty will save the files you download there. It never opens or runs a download by itself.",
};

fn downloads_folder() -> Option<PathBuf> {
    dirs::download_dir().filter(|path| path.is_absolute())
}

pub fn downloads_granted(app: &AppHandle) -> bool {
    store::read(app, SCOPE)
}

/// True if the Downloads folder is granted; otherwise asks. A no isn't saved as anything lasting,
/// so the next download asks again. See `permissions::ensure` for what waiting here means.
pub fn ensure_downloads_folder(app: &AppHandle) -> bool {
    if downloads_granted(app) {
        restore_downloads_grant(app);
        return true;
    }
    let Some(_asking) = Asking::start(SCOPE) else {
        return false;
    };
    if !ask(app, &PROMPT) {
        return false;
    }
    store::write(app, SCOPE, true);
    restore_downloads_grant(app);
    true
}

pub async fn ensure_downloads_folder_async(app: &AppHandle) -> bool {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || ensure_downloads_folder(&app))
        .await
        .unwrap_or(false)
}

/// Gives the file gate the folder if it's granted, at startup and after a yes.
pub fn restore_downloads_grant(app: &AppHandle) {
    if downloads_granted(app) {
        if let Some(folder) = downloads_folder() {
            file_access::allow_downloads_folder(&folder);
        }
    }
}

pub(super) fn revoke_downloads_folder(app: &AppHandle) {
    store::write(app, SCOPE, false);
    file_access::revoke_downloads_folder();
}
