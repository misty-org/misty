//! Live code sessions: Space members edit one branch of a repository together. The shared truth is
//! a Yjs doc on the Space's server; this side only does what a window can't do itself, always in
//! a folder the account linked:
//!
//! - who a repository is (`code_live_repo`): the key every member's clone shares, its HEAD, the
//!   remote's default branch, whether a commit is on the remote and how far main has moved;
//! - each member's own worktree of the session branch, beside the repository like
//!   `project/worktrees` places them and linked to the Space (`code_live_worktree_*`);
//! - a file as it was at the session's base commit, writing the shared text into the worktree,
//!   and watching the worktree for edits made outside Misty (`code_live_base_file`,
//!   `code_live_write`, `code_live_watch`, `code_live_unwatch`);
//! - ending: one commit per person with libgit2, merging main in, landing on main in the
//!   person's checkout, pushing and opening a pull request (`code_live_commit` and the rest).
//!
//! The person's own checkout is only ever read, except by `code_live_land`, which they ask for.

mod files;
mod finish;
mod git;
mod land;
mod worktree;

pub use files::*;
pub use finish::*;
pub use git::*;
pub use land::*;
pub use worktree::*;

use std::path::{Component, Path, PathBuf};

/// Every session branch lives under this prefix, so a command can't be pointed at any other.
const BRANCH_PREFIX: &str = "misty/live/";

/// A session branch named by a window: `misty/live/` and a short slug of plain characters.
fn session_branch(branch: &str) -> Result<&str, String> {
    let slug = branch
        .strip_prefix(BRANCH_PREFIX)
        .ok_or("That isn't a live session's branch.")?;
    let plain = !slug.is_empty()
        && slug.len() <= 80
        && !slug.starts_with('-')
        && slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if plain {
        Ok(branch)
    } else {
        Err("That isn't a live session's branch.".into())
    }
}

/// A full commit id: 40 hex characters, or 64 in a SHA-256 repository.
fn commit_id(text: &str) -> Result<git2::Oid, String> {
    let text = text.trim();
    let hex = (text.len() == 40 || text.len() == 64) && text.chars().all(|c| c.is_ascii_hexdigit());
    if !hex {
        return Err("That isn't a commit.".into());
    }
    git2::Oid::from_str(text).map_err(|_| "That isn't a commit.".to_string())
}

/// A file named by the window, relative to the repository with `/` between names, which must
/// stay inside it and out of Git's own folder.
fn repo_file(path: &str) -> Result<PathBuf, String> {
    let outside = || "That file isn't in this repository.".to_string();
    if path.is_empty() || path.starts_with('-') || path.contains('\0') || path.contains('\\') {
        return Err(outside());
    }
    let relative = Path::new(path);
    let mut parts = 0;
    for part in relative.components() {
        match part {
            Component::Normal(name) if name != ".git" => parts += 1,
            _ => return Err(outside()),
        }
    }
    if parts == 0 {
        return Err(outside());
    }
    Ok(relative.to_path_buf())
}

/// The same rule as the Space folder commands: a Space key, or the personal one when empty.
fn space_key(space: &str) -> Result<String, String> {
    let key = space.trim();
    if key.len() > 200 || key.chars().any(char::is_control) {
        return Err("That Space can't have folders.".into());
    }
    Ok(if key.is_empty() {
        "personal".into()
    } else {
        key.to_string()
    })
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_only_session_branches() {
        assert!(session_branch("misty/live/sort-fix-3a2b").is_ok());
        assert!(session_branch(crate::known_names::DEFAULT_BRANCH).is_err());
        assert!(session_branch("misty/live/").is_err());
        assert!(session_branch("misty/live/../main").is_err());
        assert!(session_branch("misty/live/-x").is_err());
    }

    #[test]
    fn keeps_files_inside_the_repository() {
        assert!(repo_file("src/sort.ts").is_ok());
        assert!(repo_file("../secrets").is_err());
        assert!(repo_file("/etc/passwd").is_err());
        assert!(repo_file(".git/config").is_err());
        assert!(repo_file("a/./b").is_ok());
        assert!(repo_file("").is_err());
    }

    #[test]
    fn reads_only_full_commit_ids() {
        assert!(commit_id(&"a".repeat(40)).is_ok());
        assert!(commit_id("abc123").is_err());
        assert!(commit_id(&"g".repeat(40)).is_err());
    }
}
