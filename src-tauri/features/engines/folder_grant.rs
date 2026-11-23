//! A folder an engine was refused, granted from the chat: the chat names the path the engine
//! wanted, and native code works out the folder, asks the person in a system dialog nothing in a
//! window can answer, and makes that folder one of their projects. The renderer never decides.
//!
//! Adapted from desktop-cc-gui's directory grants (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! See NOTICE.

use std::path::{Component, Path, PathBuf};

use tauri::State;

use super::commands::space_key;
use super::store;
use crate::agents::shared_folders::check_root;
use crate::app::runtime::MistyRuntime;
use crate::project::person_window;

pub(crate) fn grant_dir_for(path: &str) -> Result<PathBuf, String> {
    let asked = Path::new(path.trim());
    if !asked.is_absolute()
        || asked
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err("That path can't be granted as a folder.".into());
    }
    let looks_like_file = asked
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            name.rsplit_once('.').is_some_and(|(stem, ending)| {
                !stem.is_empty() && !ending.is_empty() && ending.len() <= 12
            })
        });
    let folder = if looks_like_file {
        asked.parent().unwrap_or(asked)
    } else {
        asked
    };
    Ok(folder.components().collect())
}

#[tauri::command]
pub fn space_folder_grant_scope(webview: tauri::Webview, path: String) -> Result<String, String> {
    person_window(&webview)?;
    Ok(grant_dir_for(&path)?.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn space_folder_grant(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    space: String,
    path: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    person_window(&webview)?;
    let space = space_key(&space)?;
    let folder = grant_dir_for(&path)?;
    let protected = [state.environment.misty_dir()];
    let home = dirs::home_dir();
    check_root(&folder, &protected, home.as_deref())?;
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(format!(
            "Your agents will be able to read and change files in \u{201c}{}\u{201d}. \
             You can forget it from your projects at any time.",
            folder.display()
        ))
        .title("Allow folder")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Allow folder".to_owned(),
            "Cancel".to_owned(),
        ))
        .show(move |answer| {
            let _ = send.send(answer);
        });
    if !receive.await.unwrap_or(false) {
        return Ok(None);
    }
    file_access::allow_linked_folder(&folder);
    let real = file_access::fs::create_dir_all(&folder)
        .and_then(|()| file_access::fs::canonicalize(&folder))
        .map_err(|error| {
            file_access::revoke_linked_folder(&folder);
            error.to_string()
        })?;
    if real != folder {
        file_access::revoke_linked_folder(&folder);
        check_root(&real, &protected, home.as_deref())?;
        file_access::allow_linked_folder(&real);
    }
    let text = real.to_string_lossy().to_string();
    let (db, kept) = (state.environment.store(), text.clone());
    let _ = space;
    tokio::task::spawn_blocking(move || store::add_project(&db, &account, &kept))
        .await
        .map_err(|error| error.to_string())??;
    if let Some(engines) = super::support::state() {
        if let Err(error) = engines.db.add_granted_root(&text) {
            eprintln!("[folder grant] engines won't see {text} yet: {error}");
        }
    }
    Ok(Some(text))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn a_file_grants_its_folder_and_a_folder_itself() {
        assert_eq!(
            grant_dir_for("/Users/me/notes/plan.md").unwrap(),
            PathBuf::from("/Users/me/notes")
        );
        assert_eq!(
            grant_dir_for("/Users/me/notes").unwrap(),
            PathBuf::from("/Users/me/notes")
        );
        assert_eq!(
            grant_dir_for("/Users/me/notes/").unwrap(),
            PathBuf::from("/Users/me/notes")
        );
        assert_eq!(
            grant_dir_for("/Users/me/.config").unwrap(),
            PathBuf::from("/Users/me/.config")
        );
    }

    #[test]
    fn relative_and_climbing_paths_are_refused() {
        for path in ["notes/plan.md", "/Users/me/../other", "", "~/notes"] {
            assert!(grant_dir_for(path).is_err(), "{path}");
        }
    }
}
