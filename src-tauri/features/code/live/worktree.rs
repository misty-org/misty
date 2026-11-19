//! Each member's own worktree of a session branch, at the session's base commit. It goes where
//! `project/worktrees` puts worktrees, `<repo>-worktrees/<branch as a folder name>` beside the
//! repository, worked out here and never taken from a window, and is linked to the Space so the
//! file gate and `linked_path` accept it. The person's own checkout is never touched.

use std::path::{Path, PathBuf};

use tauri::Manager;

use super::git::{git, git_words, main_checkout, open_repo};
use super::{blocking, commit_id, session_branch, space_key};
use crate::app::runtime::MistyRuntime;
use crate::project::worktrees::{parse_worktree_porcelain, sanitize_dir_name};
use crate::project::{linked_path, person_window};

/// The folder that holds a repository's worktrees, beside it.
fn worktrees_root(repo: &Path) -> Result<PathBuf, String> {
    let parent = repo
        .parent()
        .ok_or("This folder has no folder around it for worktrees.")?;
    let name = repo
        .file_name()
        .ok_or("This folder has no name.")?
        .to_string_lossy();
    Ok(parent.join(format!("{name}-worktrees")))
}

/// The main checkout of a linked folder's repository, with its worktrees folder reachable.
async fn linked_repository(
    app: &tauri::AppHandle,
    webview: &tauri::Webview,
    account: &str,
    folder: &str,
) -> Result<PathBuf, String> {
    person_window(webview)?;
    let folder = linked_path(app, account, folder).await?;
    let repo = blocking(move || main_checkout(&folder)).await?;
    // Worked out from a folder the person linked, as `project/worktrees` does.
    if let Ok(root) = worktrees_root(&repo) {
        file_access::allow_linked_folder(&root);
    }
    Ok(repo)
}

fn same_path(a: &Path, b: &Path) -> bool {
    match (
        file_access::fs::canonicalize(a),
        file_access::fs::canonicalize(b),
    ) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

/// The branch Git has checked out in the worktree at `path`, if it lists one there.
async fn listed_branch(repo: &Path, path: &Path) -> Result<Option<Option<String>>, String> {
    let out = git(repo, &["worktree", "list", "--porcelain"], 30).await?;
    if !out.success {
        return Err(git_words(&out.stderr));
    }
    Ok(parse_worktree_porcelain(&out.stdout)
        .into_iter()
        .find(|listed| !listed.is_main && same_path(Path::new(&listed.path), path))
        .map(|listed| listed.branch))
}

/// Makes sure the base commit is in this clone, fetching it from origin when it isn't.
async fn have_commit(repo: &Path, base: git2::Oid) -> Result<(), String> {
    let present = |repo: PathBuf| blocking(move || Ok(open_repo(&repo)?.find_commit(base).is_ok()));
    if present(repo.to_path_buf()).await? {
        return Ok(());
    }
    let sha = base.to_string();
    // Most hosts serve a reachable commit by its id; fetching everything is the fallback.
    let by_id = git(repo, &["fetch", "--quiet", "origin", &sha], 120).await?;
    if !by_id.success {
        let _ = git(repo, &["fetch", "--quiet", "origin"], 180).await?;
    }
    if present(repo.to_path_buf()).await? {
        Ok(())
    } else {
        Err("The session's starting commit isn't on origin, so it can't be fetched. Ask whoever started it to push it.".into())
    }
}

/// Makes a session worktree one of the person's projects, as a folder they picked: the file gate
/// may reach it and `linked_path` accepts it.
async fn link(
    app: &tauri::AppHandle,
    account: &str,
    space: &str,
    target: &Path,
) -> Result<PathBuf, String> {
    let real = file_access::fs::canonicalize(target).map_err(|error| error.to_string())?;
    file_access::allow_linked_folder(&real);
    let db = app.state::<MistyRuntime>().environment.store();
    let _ = space;
    let (account, text) = (account.to_string(), real.to_string_lossy().into_owned());
    blocking(move || crate::engines::store::add_project(&db, &account, &text)).await?;
    Ok(real)
}

/// Makes this person's worktree of a session branch at its base commit, or finds the one made
/// before, and links it to the Space. Returns its folder. A base commit missing from this clone
/// is fetched first.
#[tauri::command]
pub async fn code_live_worktree_create(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    space: String,
    branch: String,
    base_commit: String,
) -> Result<String, String> {
    let repo = linked_repository(&app, &webview, &account, &folder).await?;
    let space = space_key(&space)?;
    let branch = session_branch(&branch)?.to_string();
    let base = commit_id(&base_commit)?;
    let target = worktrees_root(&repo)?.join(sanitize_dir_name(&branch));
    let target_text = target.to_string_lossy().into_owned();

    if file_access::fs::exists(&target) {
        // Joined before: the worktree is still there on the session branch.
        return match listed_branch(&repo, &target).await? {
            Some(Some(listed)) if listed == branch => link(&app, &account, &space, &target)
                .await
                .map(|real| real.to_string_lossy().into_owned()),
            _ => Err(format!(
                "{target_text} already exists and isn't this session's worktree."
            )),
        };
    }
    have_commit(&repo, base).await?;
    let exists = {
        let (repo, branch) = (repo.clone(), branch.clone());
        blocking(move || {
            Ok(open_repo(&repo)?
                .find_branch(&branch, git2::BranchType::Local)
                .is_ok())
        })
        .await?
    };
    let sha = base.to_string();
    let args: Vec<&str> = if exists {
        vec!["worktree", "add", "--", &target_text, &branch]
    } else {
        vec![
            "worktree",
            "add",
            "--no-track",
            "-b",
            &branch,
            "--",
            &target_text,
            &sha,
        ]
    };
    let out = git(&repo, &args, 300).await?;
    if !out.success {
        let _ = git(&repo, &["worktree", "prune"], 30).await;
        return Err(
            if out.stderr.contains("already checked out")
                || out.stderr.contains("already used by worktree")
            {
                format!("{branch} is already checked out in another folder.")
            } else {
                git_words(&out.stderr)
            },
        );
    }
    link(&app, &account, &space, &target)
        .await
        .map(|real| real.to_string_lossy().into_owned())
}

/// Removes this person's worktree of a session, and the session branch with it when asked, then
/// unlinks it from the Space. Only a session worktree in the repository's worktrees folder.
#[tauri::command]
pub async fn code_live_worktree_remove(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    space: String,
    worktree: String,
    delete_branch: bool,
) -> Result<(), String> {
    let repo = linked_repository(&app, &webview, &account, &folder).await?;
    space_key(&space)?;
    let asked = PathBuf::from(&worktree);
    let root = worktrees_root(&repo)?;
    let in_root = asked
        .parent()
        .is_some_and(|parent| same_path(parent, &root));
    let named = asked
        .file_name()
        .is_some_and(|name| name.to_string_lossy().starts_with("misty-live-"));
    if !asked.is_absolute() || !in_root || !named {
        return Err("That isn't a live session's worktree.".into());
    }
    super::files::forget(&asked);
    let canonical = file_access::fs::canonicalize(&asked)
        .map(|real| real.to_string_lossy().into_owned())
        .unwrap_or_else(|_| worktree.clone());
    let branch = match listed_branch(&repo, &asked).await? {
        Some(Some(branch)) => {
            session_branch(&branch)?;
            let out = git(
                &repo,
                &["worktree", "remove", "--force", "--", &worktree],
                60,
            )
            .await?;
            if !out.success {
                return Err(git_words(&out.stderr));
            }
            Some(branch)
        }
        Some(None) => return Err("That isn't a live session's worktree.".into()),
        None => {
            // Git lost track of it; a leftover folder of ours goes too.
            let _ = git(&repo, &["worktree", "prune"], 30).await;
            if file_access::fs::exists(&asked) {
                file_access::fs::remove_dir_all(&asked)
                    .map_err(|error| format!("{worktree} couldn't be removed: {error}"))?;
            }
            None
        }
    };
    if let Some(branch) = branch.filter(|_| delete_branch) {
        // The branch is only this person's copy: the shared work is in the session.
        let out = git(&repo, &["branch", "-D", "--", &branch], 30).await?;
        if !out.success && !out.stderr.contains("not found") {
            return Err(git_words(&out.stderr));
        }
    }
    let db = app.state::<MistyRuntime>().environment.store();
    let still = blocking(move || {
        let mut still = crate::engines::store::remove_project(&db, &account, &worktree)?;
        if canonical != worktree {
            still = crate::engines::store::remove_project(&db, &account, &canonical)?;
        }
        Ok(still)
    })
    .await?;
    if !still {
        file_access::revoke_linked_folder(&asked);
    }
    Ok(())
}
