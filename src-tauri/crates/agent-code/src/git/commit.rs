//! Committing a project's changes.
use std::path::Path;

use git2::{IndexAddOption, Signature};
use serde::Deserialize;
use serde_json::{json, Value};

use super::{changed_paths, git_error, head_commit, open, Identity};
use crate::{beneath, CodeError};

/// Larger files are never committed; GitHub refuses files over 100 MB.
const MAX_COMMIT_FILE: u64 = 50 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitRequest {
    pub message: String,
    /// Paths (files or folders) to commit; omit for every change.
    #[serde(default)]
    pub paths: Option<Vec<String>>,
    /// Set by Misty from the connected account, never by the agent.
    #[serde(default)]
    pub author: Option<Identity>,
}

fn selected(path: &str, wanted: &[std::path::PathBuf]) -> bool {
    let path = Path::new(path);
    wanted.is_empty() || wanted.iter().any(|want| path == want || path.starts_with(want))
}

/// Stages the chosen changes and commits them. Secret files and very large
/// files are never committed; they're named in the result instead.
pub fn commit(root: &Path, request: CommitRequest) -> Result<Value, CodeError> {
    let author = request
        .author
        .as_ref()
        .ok_or_else(|| CodeError::Unavailable("The commit author isn't set up.".into()))?;
    let (name, email) = author.checked()?;
    let message = request.message.trim();
    if message.is_empty() {
        return Err(CodeError::fix("Write a commit message that says what changed."));
    }
    if message.len() > 10_000 {
        return Err(CodeError::fix("That commit message is too long."));
    }
    let wanted = request
        .paths
        .unwrap_or_default()
        .iter()
        .map(|path| beneath::clean_relative(path))
        .collect::<Result<Vec<_>, _>>()?;
    let repo = open(root)?;
    let mut index = repo.index().map_err(|error| git_error("read the index", error))?;
    let mut staged = 0usize;
    let mut refused: Vec<Value> = Vec::new();
    for (path, status) in changed_paths(&repo)? {
        if !selected(&path, &wanted) {
            continue;
        }
        let relative = Path::new(&path);
        if let Some(reason) = beneath::protected(relative) {
            refused.push(json!({ "path": path, "reason": reason }));
            continue;
        }
        let deleted = status.intersects(git2::Status::WT_DELETED);
        if deleted {
            index.remove_path(relative).map_err(|error| git_error("stage a deletion", error))?;
            staged += 1;
            continue;
        }
        let size = std::fs::symlink_metadata(root.join(relative)).map(|meta| meta.len()).unwrap_or(0);
        if size > MAX_COMMIT_FILE {
            refused.push(json!({ "path": path, "reason": "Over 50 MB; GitHub can't hold files this large." }));
            continue;
        }
        index
            .add_all([relative], IndexAddOption::DEFAULT, None)
            .map_err(|error| git_error("stage a change", error))?;
        staged += 1;
    }
    if staged == 0 {
        return Err(CodeError::fix(if refused.is_empty() {
            "There's nothing to commit."
        } else {
            "Nothing could be committed: the only changes are files Misty never commits."
        }));
    }
    index.write().map_err(|error| git_error("save the index", error))?;
    let tree_id = index.write_tree().map_err(|error| git_error("record the files", error))?;
    let tree = repo.find_tree(tree_id).map_err(|error| git_error("record the files", error))?;
    let parent = head_commit(&repo);
    if parent.as_ref().is_some_and(|parent| parent.tree_id() == tree_id) {
        return Err(CodeError::fix("There's nothing to commit."));
    }
    let signature = Signature::now(name, email).map_err(|error| git_error("sign the commit", error))?;
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    let oid = repo
        .commit(Some("HEAD"), &signature, &signature, &format!("{message}\n"), &tree, &parents)
        .map_err(|error| git_error("commit", error))?;
    Ok(json!({
        "sha": oid.to_string(),
        "summary": message.lines().next().unwrap_or_default(),
        "files": staged,
        "refused": refused,
    }))
}
