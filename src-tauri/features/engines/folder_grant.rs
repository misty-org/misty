//! A folder an engine was refused, granted from the chat: the chat names the path the engine
//! wanted, and native code works out the folder, asks the person in a system dialog nothing in a
//! window can answer, and links that folder to the Space. The renderer never decides.
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

/// The folder a grant for `path` covers, worked out from the path's text alone: nothing is read
/// before the person agrees. A name with an extension is a file, so its folder is meant. `..`
/// and relative paths are refused rather than guessed.
pub(crate) fn grant_dir_for(path: &str) -> Result<PathBuf, String> {
    let asked = Path::new(path.trim());
    if !asked.is_absolute() || asked.components().any(|part| matches!(part, Component::ParentDir)) {
        return Err("That path can't be granted as a folder.".into());
    }
    let looks_like_file = asked
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.rsplit_once('.').is_some_and(|(stem, ending)| !stem.is_empty() && !ending.is_empty() && ending.len() <= 12));
    let folder = if looks_like_file { asked.parent().unwrap_or(asked) } else { asked };
    Ok(folder.components().collect())
}

/// The folder a grant for `path` would cover, so the chat can show it before anyone answers.
#[tauri::command]
pub fn space_folder_grant_scope(webview: tauri::Webview, path: String) -> Result<String, String> {
    person_window(&webview)?;
    Ok(grant_dir_for(&path)?.to_string_lossy().to_string())
}

/// Asks the person, natively, to let this Space's agents work in the folder `path` is in, and
/// links it to the Space if they agree. Returns the folder linked, or nothing if they declined.
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
            "Agents in this Space will be able to read and change files in \u{201c}{}\u{201d}. \
             You can unlink it from the Space at any time.",
            folder.display()
        ))
        .title("Allow folder")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("Allow folder".to_owned(), "Cancel".to_owned()))
        .show(move |answer| {
            let _ = send.send(answer);
        });
    if !receive.await.unwrap_or(false) {
        return Ok(None);
    }
    // The person agreed, which is what lets Misty reach it. A folder an engine means to write
    // into may not exist yet, and engines skip a folder that's missing.
    file_access::allow_linked_folder(&folder);
    let real = file_access::fs::create_dir_all(&folder)
        .and_then(|()| file_access::fs::canonicalize(&folder))
        .map_err(|error| {
            file_access::revoke_linked_folder(&folder);
            error.to_string()
        })?;
    if real != folder {
        file_access::revoke_linked_folder(&folder);
        // A link may lead somewhere the checks above never saw.
        check_root(&real, &protected, home.as_deref())?;
        file_access::allow_linked_folder(&real);
    }
    let text = real.to_string_lossy().to_string();
    let (db, kept) = (state.environment.store(), text.clone());
    tokio::task::spawn_blocking(move || store::link_folder(&db, &account, &space, &kept))
        .await
        .map_err(|error| error.to_string())??;
    // Engine CLIs get every folder the person granted as an extra directory (`--add-dir` and the
    // like) on their next launch, so the step that was refused can be retried.
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
        assert_eq!(grant_dir_for("/Users/me/notes/plan.md").unwrap(), PathBuf::from("/Users/me/notes"));
        assert_eq!(grant_dir_for("/Users/me/notes").unwrap(), PathBuf::from("/Users/me/notes"));
        assert_eq!(grant_dir_for("/Users/me/notes/").unwrap(), PathBuf::from("/Users/me/notes"));
        assert_eq!(grant_dir_for("/Users/me/.config").unwrap(), PathBuf::from("/Users/me/.config"));
    }

    #[test]
    fn relative_and_climbing_paths_are_refused() {
        for path in ["notes/plan.md", "/Users/me/../other", "", "~/notes"] {
            assert!(grant_dir_for(path).is_err(), "{path}");
        }
    }
}
