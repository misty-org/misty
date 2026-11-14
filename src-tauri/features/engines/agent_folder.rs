//! Each agent's one folder on this computer: every chat with an agent on an outside engine works
//! there, in a Space or not. The person picks it in the system's own folder dialog, asked before
//! the agent's first run, or Misty makes a new one under `Documents/Misty` when they ask for one.
//! Only native code decides it, never a page, and it lives in `misty.db` (`agent_folders`), never
//! synced.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, State};

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

/// The first free folder for `name` under `home`: `name`, then `name 2`, `name 3`, …, by `free`.
pub(crate) fn free_folder(home: &Path, name: &str, free: impl Fn(&Path) -> bool) -> PathBuf {
    let mut number = 1;
    loop {
        let candidate = if number == 1 {
            home.join(name)
        } else {
            home.join(format!("{name} {number}"))
        };
        if free(&candidate) {
            return candidate;
        }
        number += 1;
    }
}

/// Whether a folder can become a new agent's: nothing is there yet, or an empty folder is.
fn unused(path: &Path) -> bool {
    !file_access::fs::exists(path)
        || file_access::fs::read_dir(path).is_ok_and(|mut entries| entries.next().is_none())
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
    // Misty is making this folder for the agent, which is what lets it look there. A folder some
    // Space or agent already has is never looked at, so no one else's grant is taken back.
    let folder = free_folder(&home, &folder_name(agent_name), |path| {
        if owned.iter().any(|kept| kept == path) {
            return false;
        }
        file_access::allow_linked_folder(path);
        let free = unused(path);
        if !free {
            file_access::revoke_linked_folder(path);
        }
        free
    });
    file_access::fs::create_dir_all(&folder)
        .map_err(|error| format!("Misty couldn't make {}: {error}", folder.display()))?;
    give(db, account, agent, &folder)?;
    Ok(folder)
}

/// Records `folder` as the agent's own and lets the file gate and engine history reach it.
pub(super) fn give(db: &Store, account: &str, agent: &str, folder: &Path) -> Result<(), String> {
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
    match known_for_run(db, account, agent, named)? {
        Some(folder) => Ok(Some(folder)),
        None if agent.is_empty() => Ok(None),
        None => make_for(db, account, agent, agent_name).map(Some),
    }
}

/// The folder a run works in without making one: a multi-run worktree, the agent's own folder, or
/// the linked folder its chat named, which then becomes the agent's.
fn known_for_run(
    db: &Store,
    account: &str,
    agent: &str,
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
    Ok(None)
}

/// Before an agent's first run, when it has no folder yet, the person picks where it works in the
/// system's own folder dialog, which can make a new folder too. Cancelling stops the run: Misty
/// never picks a folder for them.
pub(crate) async fn ask_before_first_run(
    app: &AppHandle,
    account: &str,
    agent: &str,
    agent_name: &str,
    named: &str,
) -> Result<(), String> {
    if agent.is_empty() {
        return Ok(());
    }
    let db = app.state::<MistyRuntime>().environment.store();
    let known = {
        let (db, account, agent, named) = (
            db.clone(),
            account.to_string(),
            agent.to_string(),
            named.to_string(),
        );
        blocking(move || known_for_run(&db, &account, &agent, &named)).await?
    };
    if known.is_some() {
        return Ok(());
    }
    let name = if agent_name.trim().is_empty() {
        "this agent"
    } else {
        agent_name.trim()
    };
    let Some(path) = pick_folder(app, &format!("Choose where {name} works")).await? else {
        return Err(format!(
            "{name} needs a folder to work in. Send again to choose one."
        ));
    };
    adopt(app, &db, account, agent, path).await?;
    Ok(())
}

/// The system's folder dialog, opening on `Documents`. `None` when the person cancels.
async fn pick_folder(app: &AppHandle, title: &str) -> Result<Option<PathBuf>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (send, receive) = tokio::sync::oneshot::channel();
    let mut dialog = app
        .dialog()
        .file()
        .set_title(title)
        .set_can_create_directories(true);
    if let Some(documents) = dirs::document_dir() {
        dialog = dialog.set_directory(documents);
    }
    dialog.pick_folder(move |folder| {
        let _ = send.send(folder);
    });
    let Some(folder) = receive
        .await
        .map_err(|_| "No folder was chosen.".to_string())?
    else {
        return Ok(None);
    };
    folder
        .into_path()
        .map(Some)
        .map_err(|_| "Choose a folder on this computer.".to_string())
}

/// Gives the agent a folder the person chose in the dialog, once it's one Misty may work in.
async fn adopt(
    app: &AppHandle,
    db: &Store,
    account: &str,
    agent: &str,
    path: PathBuf,
) -> Result<PathBuf, String> {
    let protected = [app.state::<MistyRuntime>().environment.misty_dir()];
    let home = dirs::home_dir();
    check_root(&path, &protected, home.as_deref())?;
    // The person chose it in the system's own dialog, which is what lets Misty reach it.
    file_access::allow_linked_folder(&path);
    let real = file_access::fs::canonicalize(&path).map_err(|error| error.to_string())?;
    if real != path {
        file_access::revoke_linked_folder(&path);
        check_root(&real, &protected, home.as_deref())?;
    }
    let (db, account, agent, kept) = (
        db.clone(),
        account.to_string(),
        agent.to_string(),
        real.clone(),
    );
    blocking(move || give(&db, &account, &agent, &kept)).await?;
    Ok(real)
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
    person_window(&webview)?;
    let Some(path) = pick_folder(&app, "Choose this agent's folder").await? else {
        return Ok(None);
    };
    let db = state.environment.store();
    let real = adopt(&app, &db, &account, &agent, path).await?;
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

/// Every agent's folder for this account, so a Space's folder can lead to the agent working in it.
#[tauri::command]
pub async fn agent_folder_list(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
) -> Result<Vec<serde_json::Value>, String> {
    person_window(&webview)?;
    let db = state.environment.store();
    let rows = blocking(move || store::agent_folders(&db, &account)).await?;
    Ok(rows
        .into_iter()
        .map(|(agent, path)| serde_json::json!({ "agent": agent, "path": path }))
        .collect())
}

/// Gives an agent a folder already linked to one of the account's Spaces. A page can only name a
/// folder the person linked themselves in the system's dialog.
#[tauri::command]
pub async fn agent_folder_use(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    agent: String,
    path: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let db = state.environment.store();
    blocking(move || {
        let folder = PathBuf::from(&path);
        let linked = store::folders_of_account(&db, &account)?
            .iter()
            .any(|kept| Path::new(kept) == folder);
        if !linked || !file_access::fs::is_dir(&folder) {
            return Err("That folder isn't linked to a Space on this computer.".to_string());
        }
        give(&db, &account, &agent, &folder)
    })
    .await
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
        let home =
            std::env::temp_dir().join(format!("misty-agent-folder-{}", uuid::Uuid::new_v4()));
        file_access::fs::create_dir_all(home.join("Writer")).unwrap();
        file_access::fs::write(home.join("Writer").join("notes.md"), "kept").unwrap();
        file_access::fs::create_dir_all(home.join("Empty")).unwrap();
        assert_eq!(free_folder(&home, "Writer", unused), home.join("Writer 2"));
        assert_eq!(free_folder(&home, "Empty", unused), home.join("Empty"));
        let owned = home.join("Empty");
        assert_eq!(
            free_folder(&home, "Empty", |path| path != owned && unused(path)),
            home.join("Empty 2")
        );
        assert_eq!(free_folder(&home, "New", unused), home.join("New"));
        let _ = file_access::fs::remove_dir_all(&home);
    }
}
