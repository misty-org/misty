//! Gives an agent a folder its engine's own history shows a past chat in, so that chat can be
//! continued there. Past chats are listed from every folder (`history/past_folders.rs`), but a
//! listed folder grants nothing: the page names the folder, native code checks that the history
//! really holds a chat from it and that it's a folder an agent may have, and the person agrees in
//! a system dialog nothing in a window can answer. Only then is it the agent's.

use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use tauri::State;

use super::commands::{blocking, person_window};
use super::support::db::Db;
use super::support::EngineState;
use crate::agents::shared_folders::check_root;
use crate::app::runtime::MistyRuntime;

/// The folder a page named, as written: absolute, with no `..` to climb out of it.
pub(crate) fn named_folder(path: &str) -> Result<PathBuf, String> {
    let named = Path::new(path.trim());
    if !named.is_absolute()
        || named
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err("That folder can't be given to an agent.".into());
    }
    Ok(named.components().collect())
}

/// Whether the engines' history holds a chat from exactly this folder.
pub(crate) fn has_past_chat(db: &Db, folder: &Path) -> Result<bool, String> {
    let text = folder.to_string_lossy();
    let spellings = [text.to_string(), format!("{}/", text.trim_end_matches('/'))];
    let conn = db.read();
    for spelling in spellings {
        let found = conn
            .query_row(
                "SELECT 1 FROM cli_sessions WHERE workspace_path = ?1 LIMIT 1",
                [&spelling],
                |_| Ok(()),
            )
            .is_ok();
        if found {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Asks the person, natively, to give `agent` the folder a past chat ran in, and gives it if they
/// agree. Returns the folder given, or nothing if they declined.
#[tauri::command]
pub async fn agent_folder_from_history(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    engines: State<'_, EngineState>,
    account: String,
    agent: String,
    path: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    person_window(&webview)?;
    if agent.trim().is_empty() {
        return Err("Choose an agent for this folder.".into());
    }
    let folder = named_folder(&path)?;
    let (db, asked) = (Arc::clone(&engines.db), folder.clone());
    if !blocking(move || has_past_chat(&db, &asked)).await? {
        return Err("Misty has no past chats from that folder.".into());
    }
    let protected = [state.environment.misty_dir()];
    let home = dirs::home_dir();
    check_root(&folder, &protected, home.as_deref())?;
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(format!(
            "The agent will be able to read and change files in \u{201c}{}\u{201d}, where your \
             past chats ran, and will work there from now on.",
            folder.display()
        ))
        .title("Give folder to agent")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Give folder".to_owned(),
            "Cancel".to_owned(),
        ))
        .show(move |answer| {
            let _ = send.send(answer);
        });
    if !receive.await.unwrap_or(false) {
        return Ok(None);
    }
    // The person agreed, which is what lets Misty reach it.
    file_access::allow_linked_folder(&folder);
    let real = match file_access::fs::canonicalize(&folder) {
        Ok(real) if file_access::fs::is_dir(&real) => real,
        _ => {
            file_access::revoke_linked_folder(&folder);
            return Err("That folder isn't on this computer anymore.".into());
        }
    };
    if real != folder {
        file_access::revoke_linked_folder(&folder);
        // A link may lead somewhere the checks above never saw.
        check_root(&real, &protected, home.as_deref())?;
        file_access::allow_linked_folder(&real);
    }
    let db = state.environment.store();
    let kept = real.clone();
    blocking(move || super::agent_folder::give(&db, &account, &agent, &kept)).await?;
    Ok(Some(real.to_string_lossy().into_owned()))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn agent_folder_from_history_takes_only_plain_absolute_folders() {
        assert_eq!(
            named_folder(" /Users/me/app/ ").unwrap(),
            PathBuf::from("/Users/me/app")
        );
        for path in ["", "app", "~/app", "/Users/me/../other"] {
            assert!(named_folder(path).is_err(), "{path}");
        }
    }

    #[test]
    fn agent_folder_from_history_needs_a_past_chat_there() {
        let root =
            std::env::temp_dir().join(format!("misty-history-grant-{}", uuid::Uuid::new_v4()));
        file_access::fs::create_dir_all(&root).unwrap();
        let db = Db::open_at(&root.join("app.db")).unwrap();
        db.0.lock()
            .execute(
                "INSERT INTO cli_sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms)
                 VALUES('codex', 's', '/Users/me/app', '/f.jsonl', 1, 1)",
                [],
            )
            .unwrap();
        assert!(has_past_chat(&db, Path::new("/Users/me/app")).unwrap());
        assert!(!has_past_chat(&db, Path::new("/Users/me")).unwrap());
        assert!(!has_past_chat(&db, Path::new("/Users/me/app/src")).unwrap());
        let _ = file_access::fs::remove_dir_all(&root);
    }
}
