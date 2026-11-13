//! Each agent's one folder on this computer: every chat with an agent on an outside engine works
//! there, in a Space or not. The person picks it in the system's own folder dialog, or Misty makes
//! a new one under `Documents/Misty`. Only native code decides it, never a page, and it lives in
//! `misty.db` (`agent_folders`), never synced.

use std::path::{Path, PathBuf};

use tauri::State;

use super::commands::blocking;
use super::store;
use crate::agents::shared_folders::check_root;
use crate::app::runtime::MistyRuntime;
use crate::project::person_window;
use database::store::Store;

/// Where new agent folders go: `Documents/Misty`, where someone new can find them.
fn folders_home() -> Result<PathBuf, String> {
    dirs::document_dir()
        .or_else(|| dirs::home_dir().map(|home| home.join("Documents")))
        .map(|documents| documents.join("Misty"))
        .ok_or_else(|| "Misty couldn't find your Documents folder.".to_string())
}

/// An agent's name as a folder name: letters, digits, spaces, `-`, `_` and `.` inside it, nothing
/// that climbs out or hides the folder.
pub(crate) fn folder_name(agent_name: &str) -> String {
    let kept: String = agent_name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.') {
                c
            } else {
                ' '
            }
        })
        .collect();
    let words = kept.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed: String = words
        .trim_matches(|c: char| c == '.' || c == ' ')
        .chars()
        .take(60)
        .collect();
    let trimmed = trimmed.trim_end().to_string();
    if trimmed.is_empty() {
        "Agent".to_string()
    } else {
        trimmed
    }
}

/// The first free folder for `name` under `home`: `name`, then `name 2`, `name 3`, …; an existing
/// empty folder counts as free.
pub(crate) fn free_folder(home: &Path, name: &str, taken: impl Fn(&Path) -> bool) -> PathBuf {
    let empty = |path: &Path| {
        file_access::fs::read_dir(path).is_ok_and(|mut entries| entries.next().is_none())
    };
    let mut number = 1;
    loop {
        let candidate = if number == 1 {
            home.join(name)
        } else {
            home.join(format!("{name} {number}"))
        };
        if !taken(&candidate) && (!candidate.exists() || empty(&candidate)) {
            return candidate;
        }
        number += 1;
    }
}

/// Makes a new folder for the agent under `Documents/Misty` and gives it to the agent.
pub(crate) fn make_for(
    db: &Store,
    account: &str,
    agent: &str,
    agent_name: &str,
) -> Result<PathBuf, String> {
    let home = folders_home()?;
    let owned = store::all_folders(db).unwrap_or_default();
    let folder = free_folder(&home, &folder_name(agent_name), |path| {
        owned.iter().any(|kept| kept == path)
    });
    // Misty is making this folder for the agent, which is what lets it reach the folder.
    file_access::allow_linked_folder(&folder);
    file_access::fs::create_dir_all(&folder)
        .map_err(|error| format!("Misty couldn't make {}: {error}", folder.display()))?;
    give(db, account, agent, &folder)?;
    Ok(folder)
}

/// Records `folder` as the agent's own and lets the file gate and engine history reach it.
fn give(db: &Store, account: &str, agent: &str, folder: &Path) -> Result<(), String> {
    let text = folder.to_string_lossy().into_owned();
    store::set_agent_folder(db, account, agent, &text)?;
    file_access::allow_linked_folder(folder);
    super::folder_linked(&text);
    Ok(())
}

/// The folder an agent's run works in. A multi-run lane's own worktree wins; otherwise the
/// agent's folder. An agent with none yet takes the linked folder its chat named (how chats
/// worked before agents owned folders) or gets a new one. `None` when the run has no agent.
pub(crate) fn for_run(
    db: &Store,
    account: &str,
    agent: &str,
    agent_name: &str,
    named: &str,
) -> Result<Option<PathBuf>, String> {
    if !named.is_empty() && super::multirun::is_worktree(db, account, Path::new(named)) {
        return Ok(Some(PathBuf::from(named)));
    }
    if agent.is_empty() {
        return Ok(None);
    }
    if let Some(own) = store::agent_folder(db, account, agent) {
        return Ok(Some(PathBuf::from(own)));
    }
    let named_path = Path::new(named);
    if !named.is_empty()
        && store::is_linked(db, account, named_path).unwrap_or(false)
        && file_access::fs::is_dir(named_path)
    {
        give(db, account, agent, named_path)?;
        return Ok(Some(named_path.to_path_buf()));
    }
    make_for(db, account, agent, agent_name).map(Some)
}

/// The agent's folder on this computer, if it has one yet.
#[tauri::command]
pub async fn agent_folder(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    agent: String,
) -> Result<Option<String>, String> {
    person_window(&webview)?;
    let db = state.environment.store();
    blocking(move || Ok(store::agent_folder(&db, &account, &agent))).await
}

/// Lets the person pick the agent's folder in the system's own dialog. `None` when they cancel.
#[tauri::command]
pub async fn agent_folder_choose(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    agent: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    person_window(&webview)?;
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choose this agent's folder")
        .pick_folder(move |folder| {
            let _ = send.send(folder);
        });
    let Some(folder) = receive
        .await
        .map_err(|_| "No folder was chosen.".to_string())?
    else {
        return Ok(None);
    };
    let path = folder
        .into_path()
        .map_err(|_| "Choose a folder on this computer.".to_string())?;
    let protected = [state.environment.misty_dir()];
    let home = dirs::home_dir();
    check_root(&path, &protected, home.as_deref())?;
    // The person chose it in the system's own dialog, which is what lets Misty reach it.
    file_access::allow_linked_folder(&path);
    let real = file_access::fs::canonicalize(&path).map_err(|error| error.to_string())?;
    if real != path {
        file_access::revoke_linked_folder(&path);
        check_root(&real, &protected, home.as_deref())?;
    }
    let db = state.environment.store();
    let kept = real.clone();
    blocking(move || give(&db, &account, &agent, &kept)).await?;
    Ok(Some(real.to_string_lossy().into_owned()))
}

/// Makes a new, empty folder for the agent under `Documents/Misty` and gives it to the agent.
#[tauri::command]
pub async fn agent_folder_new(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    agent: String,
    name: String,
) -> Result<String, String> {
    person_window(&webview)?;
    let db = state.environment.store();
    let folder = blocking(move || make_for(&db, &account, &agent, &name)).await?;
    Ok(folder.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_names_stay_plain() {
        assert_eq!(folder_name("Claude Code"), "Claude Code");
        assert_eq!(folder_name("../../etc"), "etc");
        assert_eq!(folder_name("  .hidden  "), "hidden");
        assert_eq!(folder_name("a/b\\c:d"), "a b c d");
        assert_eq!(folder_name("///"), "Agent");
        assert_eq!(folder_name(&"x".repeat(90)).len(), 60);
    }

    #[test]
    fn a_taken_name_gets_a_number() {
        let home = std::env::temp_dir().join(format!("misty-agent-folder-{}", uuid::Uuid::new_v4()));
        file_access::fs::create_dir_all(home.join("Writer")).unwrap();
        file_access::fs::write(home.join("Writer").join("notes.md"), "kept").unwrap();
        file_access::fs::create_dir_all(home.join("Empty")).unwrap();
        assert_eq!(free_folder(&home, "Writer", |_| false), home.join("Writer 2"));
        assert_eq!(free_folder(&home, "Empty", |_| false), home.join("Empty"));
        let owned = home.join("Empty");
        assert_eq!(
            free_folder(&home, "Empty", |path| path == owned),
            home.join("Empty 2")
        );
        assert_eq!(free_folder(&home, "New", |_| false), home.join("New"));
        let _ = file_access::fs::remove_dir_all(&home);
    }
}
