//! Ending a session, in the starter's worktree: one commit per person, made with libgit2 and
//! authored as them; merging the remote's default branch in; landing the branch on main in the
//! person's own checkout (only when it is clean and on main); pushing; opening a pull request.
//!
//! Commits are built from the texts the window sends, never from the files on disk, so an edit
//! landing in the worktree mid-way can't slip into the wrong person's commit.

use serde::{Deserialize, Serialize};

use super::files::live_worktree;
use super::git::{git, git_words};
use super::{blocking, commit_id, repo_file, session_branch};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedFile {
    pub path: String,
    /// The file's whole text in this commit; none removes it.
    pub text: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitPerson {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedCommit {
    pub message: String,
    /// Who wrote it; the committer's own Git identity when unknown.
    pub author: Option<CommitPerson>,
    pub files: Vec<PlannedFile>,
}

pub(super) fn words(error: git2::Error) -> String {
    error.message().trim().to_string()
}

pub(super) fn committer(repo: &git2::Repository) -> Result<git2::Signature<'static>, String> {
    repo.signature().map_err(|_| {
        "Git doesn't know who you are yet. Set user.name and user.email in your Git config, then end the session again."
            .to_string()
    })
}

pub(super) fn branch_of(repo: &git2::Repository) -> Result<String, String> {
    let branch = repo
        .head()
        .ok()
        .filter(|head| head.is_branch())
        .and_then(|head| head.shorthand().map(str::to_string))
        .unwrap_or_default();
    session_branch(&branch)?;
    Ok(branch)
}

/// Writes one file's text into an index, keeping the mode it had (an executable stays one).
fn put_file(
    repo: &git2::Repository,
    index: &mut git2::Index,
    parent: &git2::Tree<'_>,
    file: &PlannedFile,
) -> Result<(), String> {
    let path = repo_file(&file.path)?;
    let Some(text) = &file.text else {
        let _ = index.remove_path(&path);
        return Ok(());
    };
    let mode = parent
        .get_path(&path)
        .ok()
        .map(|entry| entry.filemode() as u32)
        .filter(|mode| *mode == 0o100644 || *mode == 0o100755)
        .unwrap_or(0o100644);
    let id = repo.blob(text.as_bytes()).map_err(words)?;
    let _ = index.conflict_remove(&path);
    index
        .add(&git2::IndexEntry {
            ctime: git2::IndexTime::new(0, 0),
            mtime: git2::IndexTime::new(0, 0),
            dev: 0,
            ino: 0,
            mode,
            uid: 0,
            gid: 0,
            file_size: text.len() as u32,
            id,
            flags: 0,
            flags_extended: 0,
            path: file.path.as_bytes().to_vec(),
        })
        .map_err(words)
}

/// Points the worktree's own index at `tree`, so its status matches the branch again. Its files
/// already hold the shared text.
fn settle_index(repo: &git2::Repository, tree: &git2::Tree<'_>) -> Result<(), String> {
    let mut index = repo.index().map_err(words)?;
    index.read_tree(tree).map_err(words)?;
    index.write().map_err(words)
}

/// Puts the session branch back on its base commit, dropping commits an ending that didn't
/// finish made, so the next one builds them again from the shared text. Files are untouched.
#[tauri::command]
pub async fn code_live_reset(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    base_commit: String,
) -> Result<(), String> {
    let top = live_worktree(&app, &webview, &account, &folder).await?;
    let base = commit_id(&base_commit)?;
    blocking(move || {
        let repo = git2::Repository::open(&top).map_err(words)?;
        let branch = branch_of(&repo)?;
        let commit = repo
            .find_commit(base)
            .map_err(|_| "The session's starting commit isn't in this copy.".to_string())?;
        repo.find_reference(&format!("refs/heads/{branch}"))
            .and_then(|mut reference| reference.set_target(base, "live session: start over"))
            .map_err(words)?;
        // Bound first: as a temporary in the last expression it would outlive `repo`.
        let tree = commit.tree().map_err(words)?;
        settle_index(&repo, &tree)
    })
    .await
}

/// Makes the planned commits on the session branch, one after another from its base commit,
/// each authored as its person and committed as the person ending the session. A commit that
/// changes nothing is left out. Returns the new commits' ids.
#[tauri::command]
pub async fn code_live_commit(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    base_commit: String,
    commits: Vec<PlannedCommit>,
) -> Result<Vec<String>, String> {
    let top = live_worktree(&app, &webview, &account, &folder).await?;
    let base = commit_id(&base_commit)?;
    blocking(move || {
        let repo = git2::Repository::open(&top).map_err(words)?;
        branch_of(&repo)?;
        let committer = committer(&repo)?;
        let mut parent = repo
            .head()
            .and_then(|head| head.peel_to_commit())
            .map_err(words)?;
        if parent.id() != base {
            return Err("The session branch moved. End the session again.".into());
        }
        let mut made = Vec::new();
        for planned in &commits {
            let parent_tree = parent.tree().map_err(words)?;
            let mut index = git2::Index::new().map_err(words)?;
            index.read_tree(&parent_tree).map_err(words)?;
            for file in &planned.files {
                put_file(&repo, &mut index, &parent_tree, file)?;
            }
            let tree_id = index.write_tree_to(&repo).map_err(words)?;
            if tree_id == parent_tree.id() {
                continue;
            }
            let tree = repo.find_tree(tree_id).map_err(words)?;
            let author = match &planned.author {
                Some(person) => git2::Signature::now(&person.name, &person.email)
                    .unwrap_or_else(|_| committer.clone()),
                None => committer.clone(),
            };
            let id = repo
                .commit(
                    Some("HEAD"),
                    &author,
                    &committer,
                    &planned.message,
                    &tree,
                    &[&parent],
                )
                .map_err(words)?;
            made.push(id.to_string());
            parent = repo.find_commit(id).map_err(words)?;
        }
        settle_index(&repo, &parent.tree().map_err(words)?)?;
        Ok(made)
    })
    .await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFile {
    pub path: String,
    /// The file with Git's conflict markers, ours labelled "live session" and theirs the default branch.
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum MergeOutcome {
    Merged { head: String },
    Conflicts { files: Vec<ConflictFile> },
}

fn blob_text(repo: &git2::Repository, entry: &git2::IndexEntry) -> String {
    repo.find_blob(entry.id)
        .map(|blob| String::from_utf8_lossy(blob.content()).into_owned())
        .unwrap_or_default()
}

/// Merges the remote's default branch into the session branch, in memory. Files that conflicted
/// in an earlier try and were settled in the session take their text from `resolved`. Conflicts
/// left over come back with Git's markers and nothing moves; otherwise the merge commit is made.
#[tauri::command]
pub async fn code_live_merge(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    default_branch: String,
    resolved: Vec<PlannedFile>,
) -> Result<MergeOutcome, String> {
    let top = live_worktree(&app, &webview, &account, &folder).await?;
    let default = default_branch.trim().to_string();
    if default.is_empty() || default.starts_with('-') {
        return Err("That isn't a branch name.".into());
    }
    let out = git(&top, &["fetch", "--quiet", "origin", &default], 120).await?;
    if !out.success {
        return Err(git_words(&out.stderr));
    }
    blocking(move || {
        let repo = git2::Repository::open(&top).map_err(words)?;
        let branch = branch_of(&repo)?;
        let ours = repo
            .head()
            .and_then(|head| head.peel_to_commit())
            .map_err(words)?;
        let theirs = repo
            .find_reference(&format!("refs/remotes/origin/{default}"))
            .and_then(|reference| reference.peel_to_commit())
            .map_err(|_| format!("Origin has no branch {default}."))?;
        if ours.id() == theirs.id()
            || repo
                .graph_descendant_of(ours.id(), theirs.id())
                .map_err(words)?
        {
            return Ok(MergeOutcome::Merged {
                head: ours.id().to_string(),
            });
        }
        let ours_tree = ours.tree().map_err(words)?;
        let mut index = repo.merge_commits(&ours, &theirs, None).map_err(words)?;
        let mut files = Vec::new();
        if index.has_conflicts() {
            let conflicts: Vec<git2::IndexConflict> = index
                .conflicts()
                .map_err(words)?
                .collect::<Result<_, _>>()
                .map_err(words)?;
            for conflict in conflicts {
                let Some(any) = conflict
                    .our
                    .as_ref()
                    .or(conflict.their.as_ref())
                    .or(conflict.ancestor.as_ref())
                else {
                    continue;
                };
                let path = String::from_utf8_lossy(&any.path).into_owned();
                if let Some(file) = resolved.iter().find(|file| file.path == path) {
                    put_file(&repo, &mut index, &ours_tree, file)?;
                    continue;
                }
                let text = match (&conflict.ancestor, &conflict.our, &conflict.their) {
                    (Some(ancestor), Some(our), Some(their)) => {
                        let mut options = git2::MergeFileOptions::new();
                        options
                            .our_label("live session")
                            .their_label(crate::known_names::DEFAULT_BRANCH);
                        repo.merge_file_from_index(ancestor, our, their, Some(&mut options))
                            .map(|merged| String::from_utf8_lossy(merged.content()).into_owned())
                            .map_err(words)?
                    }
                    // One side removed the file: the side that kept it is what's left to settle.
                    (_, Some(our), None) => blob_text(&repo, our),
                    (_, None, Some(their)) => blob_text(&repo, their),
                    _ => String::new(),
                };
                files.push(ConflictFile { path, text });
            }
        }
        if !files.is_empty() {
            return Ok(MergeOutcome::Conflicts { files });
        }
        let merged_tree = repo
            .find_tree(index.write_tree_to(&repo).map_err(words)?)
            .map_err(words)?;
        // Settled files are the session's text, conflicted again or not.
        let mut settled = git2::Index::new().map_err(words)?;
        settled.read_tree(&merged_tree).map_err(words)?;
        for file in &resolved {
            put_file(&repo, &mut settled, &merged_tree, file)?;
        }
        let tree = repo
            .find_tree(settled.write_tree_to(&repo).map_err(words)?)
            .map_err(words)?;
        let committer = committer(&repo)?;
        let message = format!("Merge {default} into {branch}");
        let id = repo
            .commit(
                Some("HEAD"),
                &committer,
                &committer,
                &message,
                &tree,
                &[&ours, &theirs],
            )
            .map_err(words)?;
        settle_index(&repo, &tree)?;
        Ok(MergeOutcome::Merged {
            head: id.to_string(),
        })
    })
    .await
}
