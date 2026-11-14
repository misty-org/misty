// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//
// The changes panel: what Git says changed in a linked folder, each file's diff, staging,
// discarding, branches, and committing, pushing and pulling. Reads and index writes go through
// libgit2 (`git/repo.rs`, `git/tree.rs`); commit, push and the fetch of a pull run the person's
// own `git`, so their config, hooks, signing and credential helpers all apply.
//
// Every command checks the calling window and that the folder lies in one the account linked;
// one that changes files also checks that the whole repository does, and every file it names
// stays inside the repository.

mod local;
mod multirun;
mod pull_request;
mod remote;
mod repo;
#[cfg(test)]
mod tests_ported;
mod tree;

use std::path::{Path, PathBuf};

pub use local::*;
pub use multirun::FileChange;
pub(crate) use multirun::{changes_since, run};
pub use pull_request::*;
pub use remote::*;

use super::{linked_path, person_window};

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

async fn folder_of(
    app: &tauri::AppHandle,
    webview: &tauri::Webview,
    account: &str,
    folder: &str,
) -> Result<PathBuf, String> {
    person_window(webview)?;
    linked_path(app, account, folder).await
}

/// The top of the repository holding `folder`, for a command that changes files: the whole
/// repository has to lie in a linked folder, not only the part the panel shows.
async fn repository_of(
    app: &tauri::AppHandle,
    webview: &tauri::Webview,
    account: &str,
    folder: &str,
) -> Result<PathBuf, String> {
    let folder = folder_of(app, webview, account, folder).await?;
    let top = blocking(move || repo::work_folder(&folder)).await?;
    let top = top.to_string_lossy().to_string();
    linked_path(app, account, &top)
        .await
        .map_err(|_| "This repository reaches outside the linked folder.".to_string())
}

/// A file named by the panel, which must stay inside the folder.
fn inside(file: &str) -> Result<&str, String> {
    let path = Path::new(file);
    let escapes = path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir));
    if escapes || file.starts_with('-') || file.is_empty() {
        return Err("That file isn't in this folder.".into());
    }
    Ok(file)
}

fn inside_all(files: &[String]) -> Result<(), String> {
    files.iter().try_for_each(|file| inside(file).map(|_| ()))
}

/// A branch name typed or picked in the panel. Git refuses bad names itself; this keeps one from
/// ever being read as an option.
fn branch_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty() || name.starts_with('-') {
        return Err("That isn't a branch name.".into());
    }
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_a_file_outside_the_folder() {
        assert!(inside("src/main.rs").is_ok());
        assert!(inside("../secrets").is_err());
        assert!(inside("/etc/passwd").is_err());
        assert!(inside("--output=x").is_err());
    }
}
