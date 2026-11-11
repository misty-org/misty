// What multi-run asks of Git: a worktree and a branch per lane, folding one lane's work back into
// the folder, and removing what it made. It runs the person's own `git` and never pushes.

use std::collections::HashSet;
use std::path::Path;

use crate::project::git::run as git;

/// Whether multi-run can work in `folder`: `ready`, or the one thing in the way.
pub(super) async fn readiness(folder: &Path) -> Result<&'static str, String> {
    if crate::engines::resolve::find_program("git").is_none() {
        return Ok("no_git");
    }
    let Ok(top) = git(folder, None, &["rev-parse", "--show-toplevel"]).await else {
        return Ok("not_repository");
    };
    // A worktree is a copy of the whole repository, so the linked folder has to be all of it.
    let top = file_access::fs::canonicalize(top.trim()).map_err(|error| error.to_string())?;
    if top != folder {
        return Ok("not_top_level");
    }
    if head(folder).await.is_err() {
        return Ok("no_commits");
    }
    Ok("ready")
}

/// The commit a folder is on, as its full id.
pub(super) async fn head(folder: &Path) -> Result<String, String> {
    let commit = git(folder, None, &["rev-parse", "--verify", "HEAD^{commit}"])
        .await?
        .trim()
        .to_string();
    if super::is_commit(&commit) {
        Ok(commit)
    } else {
        Err("Git didn't name the commit this folder is on.".into())
    }
}

/// Makes a worktree of `folder` at `path`, on a new branch that starts at `base`.
pub(super) async fn add(
    folder: &Path,
    path: &Path,
    branch: &str,
    base: &str,
) -> Result<(), String> {
    let path = path.to_str().ok_or("That folder's path can't be used.")?;
    git(folder, None, &["worktree", "add", "-b", branch, path, base])
        .await
        .map(|_| ())
}

/// Removes a worktree and its branch. Neither failing stops the other: one may be gone already.
pub(super) async fn remove(folder: &Path, path: &Path, branch: &str) {
    if let Some(path) = path.to_str() {
        let _ = git(folder, None, &["worktree", "remove", "--force", path]).await;
    }
    let _ = git(folder, None, &["worktree", "prune"]).await;
    let _ = git(folder, None, &["branch", "-D", branch]).await;
}

fn names(listed: &str) -> HashSet<String> {
    listed
        .split('\0')
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect()
}

/// The files both changed, in order, to name them in a refusal.
pub(super) fn overlap(ours: &HashSet<String>, theirs: &HashSet<String>) -> Vec<String> {
    let mut both: Vec<String> = ours.intersection(theirs).cloned().collect();
    both.sort();
    both
}

pub(super) fn overlap_message(files: &[String]) -> String {
    let shown: Vec<&str> = files.iter().take(5).map(String::as_str).collect();
    let more = files.len() - shown.len();
    format!(
        "The folder has uncommitted changes to files this run also changed: {}{}. \
         Commit or stash them, then keep this run again.",
        shown.join(", "),
        if more > 0 {
            format!(" and {more} more")
        } else {
            String::new()
        }
    )
}

/// Folds everything a lane did into `folder`, staged and not committed, for the person to review.
/// The lane's loose changes are committed on its own branch first; `label` is that commit's
/// message. Refuses, changing nothing in `folder`, when the two can't be combined cleanly.
pub(super) async fn keep(
    folder: &Path,
    worktree: &Path,
    base: &str,
    label: &str,
) -> Result<(), String> {
    git(worktree, None, &["add", "-A"]).await?;
    let loose = git(worktree, None, &["status", "--porcelain"]).await?;
    if !loose.trim().is_empty() {
        // A commit only Misty reads, on a branch it removes: it doesn't wait for the person's
        // hooks or signing key, and has a name even where they never told Git theirs.
        git(
            worktree,
            None,
            &[
                "-c",
                "user.name=Misty",
                "-c",
                "user.email=misty@localhost",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "--no-verify",
                "--quiet",
                "-m",
                label,
            ],
        )
        .await?;
    }
    // The agent may have changed branch in its worktree, so its work is wherever it stands now.
    let result = head(worktree).await?;
    let theirs = names(
        &git(
            folder,
            None,
            &["diff", "--name-only", "--no-renames", "-z", base, &result],
        )
        .await?,
    );
    if theirs.is_empty() {
        return Err("This run changed nothing, so there is nothing to keep.".into());
    }
    let staged = git(folder, None, &["diff", "--cached", "--name-only", "-z"]).await?;
    if !names(&staged).is_empty() {
        return Err(
            "The folder has staged changes. Commit or unstage them, then keep this run again."
                .into(),
        );
    }
    let ours = names(
        &git(
            folder,
            None,
            &[
                "ls-files",
                "--modified",
                "--deleted",
                "--others",
                "--exclude-standard",
                "-z",
            ],
        )
        .await?,
    );
    let both = overlap(&ours, &theirs);
    if !both.is_empty() {
        return Err(overlap_message(&both));
    }
    if let Err(error) = git(folder, None, &["merge", "--squash", &result]).await {
        // Git stops half way when the folder moved on and the two disagree. Take that back, so
        // the folder is as it was: nothing was staged before, and its own uncommitted changes
        // touch none of these files. A refusal that staged nothing is left exactly as it is.
        let half_done = git(folder, None, &["diff", "--cached", "--name-only", "-z"]).await;
        if half_done.is_ok_and(|staged| !names(&staged).is_empty()) {
            let _ = git(folder, None, &["reset", "--merge"]).await;
        }
        let detail = error.lines().last().unwrap_or("").trim().to_string();
        return Err(format!(
            "This run's changes conflict with what changed in the folder since it started, \
             so nothing was applied.{}",
            if detail.is_empty() {
                String::new()
            } else {
                format!(" Git said: {detail}")
            }
        ));
    }
    Ok(())
}
