//! The panels beside a chat that work on a Space's linked project folder: its files, its Git
//! changes and a terminal. Every path a window names is checked against the folders that
//! account linked, so a page can reach nothing else through these.
//!
//! Modelled on desktop-cc-gui's files, git and terminal backends (MIT). See NOTICE.

pub mod files;
pub mod git;
pub mod terminal;

use std::path::PathBuf;

use tauri::Manager;

use crate::app::runtime::MistyRuntime;

pub(crate) fn person_window(webview: &tauri::Webview) -> Result<(), String> {
    if crate::browser::app_windows::is_person_window(webview.label()) {
        Ok(())
    } else {
        Err("Only a profile's window can do this.".into())
    }
}

/// The real path of `path`, if it lies in a folder this account linked to a Space. `..` and
/// links are resolved first, so neither reaches outside.
pub(crate) async fn linked_path(
    app: &tauri::AppHandle,
    account: &str,
    path: &str,
) -> Result<PathBuf, String> {
    let asked = PathBuf::from(path);
    if !asked.is_absolute() {
        return Err("That path isn't in a linked folder.".into());
    }
    let db = app.state::<MistyRuntime>().environment.store();
    let account = account.to_string();
    tokio::task::spawn_blocking(move || {
        // A file that doesn't exist yet is placed by its folder, which must.
        let real = match file_access::fs::canonicalize(&asked) {
            Ok(real) => real,
            Err(_) => {
                let parent = asked
                    .parent()
                    .ok_or("That path isn't in a linked folder.")?;
                let name = asked
                    .file_name()
                    .ok_or("That path isn't in a linked folder.")?;
                file_access::fs::canonicalize(parent)
                    .map_err(|_| "That path isn't in a linked folder.".to_string())?
                    .join(name)
            }
        };
        if crate::engines::store::is_linked(&db, &account, &real)? {
            Ok(real)
        } else {
            Err("That path isn't in a linked folder.".to_string())
        }
    })
    .await
    .map_err(|error| error.to_string())?
}
