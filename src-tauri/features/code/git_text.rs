//! A file's text as Git last committed it, for the Code page's change marks and reviews: the
//! editor compares what it shows with this to mark added, changed and removed lines.

use std::path::Path;

/// Larger than this isn't shown with change marks; the editor would spend its time diffing.
const MOST_BYTES: usize = 2 * 1024 * 1024;

/// The file at `HEAD`, or `None` when it isn't in a repository, isn't committed yet (all of it is
/// new), or isn't text.
#[tauri::command]
pub async fn code_git_head_text(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    path: String,
) -> Result<Option<String>, String> {
    crate::project::person_window(&webview)?;
    let file = crate::project::linked_path(&app, &account, &path).await?;
    tokio::task::spawn_blocking(move || Ok(head_text(&file)))
        .await
        .map_err(|error| error.to_string())?
}

fn head_text(file: &Path) -> Option<String> {
    let folder = file.parent()?;
    let repo = git2::Repository::discover(folder).ok()?;
    // Found from the file's real folder, so the work tree's path is real too, and may lie above
    // the linked folder, where the file gate wouldn't let it be resolved again.
    let relative = file.strip_prefix(repo.workdir()?).ok()?;
    let tree = repo.head().ok()?.peel_to_tree().ok()?;
    let entry = tree.get_path(relative).ok()?;
    let blob = repo.find_blob(entry.id()).ok()?;
    if blob.is_binary() || blob.size() > MOST_BYTES {
        return None;
    }
    String::from_utf8(blob.content().to_vec()).ok()
}
