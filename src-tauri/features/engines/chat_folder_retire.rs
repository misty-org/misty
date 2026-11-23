use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::app::runtime::MistyRuntime;
use crate::engines::store;

pub(crate) fn retire_agent_folders(app: &AppHandle) {
    let db = app.state::<MistyRuntime>().environment.store();
    let Ok(rows) = store::old_agent_folders(&db) else {
        return;
    };
    if rows.is_empty() {
        return;
    }
    let made_home = dirs::document_dir().map(|documents| documents.join("Misty"));
    let mut made: Vec<PathBuf> = Vec::new();
    let mut owners: Vec<(String, String)> = Vec::new();
    for (account, path) in rows {
        let folder = PathBuf::from(&path);
        if made_home
            .as_ref()
            .is_some_and(|home| folder.starts_with(home))
        {
            if file_access::fs::is_dir(&folder) {
                if !made.contains(&folder) {
                    made.push(folder);
                }
                owners.push((account, path));
            }
        } else {
            let _ = store::add_project(&db, &account, &path);
        }
    }
    if made.is_empty() {
        let _ = store::clear_old_agent_folders(&db);
        return;
    }
    let names = made
        .iter()
        .map(|folder| format!("\u{2022} {}", folder.display()))
        .collect::<Vec<_>>()
        .join("\n");
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
        tokio::time::sleep(std::time::Duration::from_secs(4)).await;
        let (send, receive) = tokio::sync::oneshot::channel();
        app.dialog()
            .message(format!(
                "Chats now work in a project you pick, or in a scratch folder of their own, so \
                 these folders Misty made for agents aren't used any more:\n\n{names}\n\nMove them \
                 to the Trash? You can put them back from the Trash."
            ))
            .title("Folders Misty made for agents")
            .kind(MessageDialogKind::Info)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Move to Trash".to_owned(),
                "Keep them".to_owned(),
            ))
            .show(move |answer| {
                let _ = send.send(answer);
            });
        let trash = receive.await.unwrap_or(false);
        let db = app.state::<MistyRuntime>().environment.store();
        let _ = tokio::task::spawn_blocking(move || {
            if !trash {
                for (account, path) in &owners {
                    if store::add_project(&db, account, path).is_ok() {
                        file_access::allow_linked_folder(Path::new(path));
                    }
                }
            } else {
                for folder in &made {
                    if let Err(error) = crate::project::files::move_to_trash(folder) {
                        eprintln!(
                            "[chat folders] couldn't trash {}: {error}",
                            folder.display()
                        );
                    }
                }
                if let Some(home) = dirs::document_dir().map(|documents| documents.join("Misty")) {
                    let empty = file_access::fs::read_dir(&home)
                        .map(|mut entries| entries.next().is_none())
                        .unwrap_or(false);
                    if empty {
                        let _ = crate::project::files::move_to_trash(&home);
                    }
                }
            }
            let _ = store::clear_old_agent_folders(&db);
        })
        .await;
    });
}
