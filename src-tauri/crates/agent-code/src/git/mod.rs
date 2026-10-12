//! Git for projects (docs/plans/agent-git-projects.md), run by Misty through
//! libgit2. libgit2 never runs hooks, `core.fsmonitor`, filter drivers or any
//! other command a repository configures, so working on an untrusted
//! repository runs nothing. Sandboxed commands still can't write `.git`.
//!
//! There is no network code here: commits move to and from GitHub through its
//! API via Composio (`transfer`), with hashes kept identical on both sides.
use std::path::Path;

use git2::{BranchType, Oid, Repository, RepositoryOpenFlags, StatusOptions};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{beneath, diff, CodeError};

mod commit;
pub mod time;
pub mod transfer;

pub use commit::{commit, CommitRequest};

/// Who a commit is by: the connected GitHub account, or the Misty account
/// before GitHub is connected. Chosen by Misty, never by the agent.
#[derive(Deserialize, Clone, Debug)]
pub struct Identity {
    pub name: String,
    pub email: String,
}

impl Identity {
    pub(crate) fn checked(&self) -> Result<(&str, &str), CodeError> {
        let name = self.name.trim();
        let email = self.email.trim();
        let bad = |text: &str| text.is_empty() || text.len() > 200 || text.contains(['<', '>', '\n', '\r', '\0']);
        if bad(name) || bad(email) {
            return Err(CodeError::Unavailable("The commit author isn't set up.".into()));
        }
        Ok((name, email))
    }
}

pub(crate) fn git_error(action: &str, error: git2::Error) -> CodeError {
    CodeError::Fix(format!("Could not {action}: {}.", error.message().trim_end_matches('.')))
}

/// Whether a project folder is a Git repository of its own.
pub fn is_repository(root: &Path) -> bool {
    root.join(".git").is_dir()
}

/// Opens the project's own repository, never one in a parent folder, and
/// refuses a repository whose working folder is somewhere else.
pub fn open(root: &Path) -> Result<Repository, CodeError> {
    if !is_repository(root) {
        return Err(CodeError::fix(
            "This project isn't a Git repository yet. The person can turn on Git for it in Misty.",
        ));
    }
    let repo = Repository::open_ext(root, RepositoryOpenFlags::NO_SEARCH, std::iter::empty::<&std::ffi::OsStr>())
        .map_err(|error| git_error("open the repository", error))?;
    let workdir = repo
        .workdir()
        .and_then(|dir| dir.canonicalize().ok())
        .ok_or_else(|| CodeError::fix("The repository has no working folder."))?;
    if workdir != root {
        return Err(CodeError::Scope("The repository's working folder is outside the project.".into()));
    }
    Ok(repo)
}

const STARTER_GITIGNORE: &str = "# Added by Misty\nnode_modules/\ndist/\nbuild/\n.env\n.env.*\n!.env.example\n.DS_Store\n";

/// Turns a project folder into a repository on branch `main`, with a starter
/// `.gitignore` when it has none.
pub fn init(root: &Path) -> Result<Value, CodeError> {
    if is_repository(root) {
        return status(root);
    }
    let mut options = git2::RepositoryInitOptions::new();
    options.initial_head("main").no_reinit(true);
    Repository::init_opts(root, &options).map_err(|error| git_error("create the repository", error))?;
    let root_dir = beneath::open_root(root).map_err(|error| CodeError::Scope(error.to_string()))?;
    if !root.join(".gitignore").exists() {
        beneath::write_file(&root_dir, Path::new(".gitignore"), STARTER_GITIGNORE.as_bytes())
            .map_err(|error| crate::io_fix("write .gitignore", error))?;
    }
    status(root)
}

/// Readies an empty folder to receive a clone of `github`: a repository whose
/// `origin` is that repository and whose HEAD names its default branch.
pub fn prepare_clone(root: &Path, github: &GitHubRepo, branch: &str) -> Result<(), CodeError> {
    if !valid_branch(branch) {
        return Err(CodeError::fix("GitHub named a branch Misty can't use."));
    }
    let empty = std::fs::read_dir(root)
        .map(|mut entries| entries.next().is_none())
        .unwrap_or(false);
    if !empty || is_repository(root) {
        return Err(CodeError::fix("Clone into a new, empty folder."));
    }
    let mut options = git2::RepositoryInitOptions::new();
    options.initial_head(branch).no_reinit(true);
    Repository::init_opts(root, &options).map_err(|error| git_error("create the repository", error))?;
    set_origin(root, github)
}

/// `owner` and `name` of a GitHub repository, from an `origin` URL.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct GitHubRepo {
    pub owner: String,
    pub name: String,
}

fn valid_github_part(part: &str) -> bool {
    !part.is_empty()
        && part.len() <= 100
        && part != "."
        && part != ".."
        && part.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

pub fn parse_github(url: &str) -> Option<GitHubRepo> {
    let rest = url.trim().strip_prefix("https://github.com/")?;
    let rest = rest.strip_suffix('/').unwrap_or(rest);
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let (owner, name) = rest.split_once('/')?;
    (valid_github_part(owner) && valid_github_part(name)).then(|| GitHubRepo {
        owner: owner.to_owned(),
        name: name.to_owned(),
    })
}

/// The project's GitHub repository, when `origin` is one.
pub fn origin(repo: &Repository) -> Option<GitHubRepo> {
    let remote = repo.find_remote("origin").ok()?;
    parse_github(remote.url().ok()?)
}

/// Points `origin` at a GitHub repository (when publishing or cloning).
pub fn set_origin(root: &Path, target: &GitHubRepo) -> Result<(), CodeError> {
    if !valid_github_part(&target.owner) || !valid_github_part(&target.name) {
        return Err(CodeError::fix("That isn't a GitHub repository name."));
    }
    let repo = open(root)?;
    let url = format!("https://github.com/{}/{}.git", target.owner, target.name);
    if repo.find_remote("origin").is_ok() {
        repo.remote_set_url("origin", &url)
    } else {
        repo.remote("origin", &url).map(|_| ())
    }
    .map_err(|error| git_error("set the GitHub repository", error))
}

/// Remembers GitHub's default branch, which agents push to only when the
/// person allowed it. Kept in the repository's config, which sandboxed
/// commands can't write.
pub fn set_default_branch(root: &Path, branch: &str) -> Result<(), CodeError> {
    if branch.is_empty() {
        return Ok(());
    }
    if !valid_branch(branch) {
        return Err(CodeError::fix("GitHub named a branch Misty can't use."));
    }
    let repo = open(root)?;
    let mut config = repo.config().map_err(|error| git_error("save settings", error))?;
    config
        .set_str("misty.defaultBranch", branch)
        .map_err(|error| git_error("save settings", error))
}

/// GitHub's default branch, as recorded at publish or clone; `main` or
/// `master` before that.
pub fn default_branch(repo: &Repository) -> String {
    repo.config()
        .ok()
        .and_then(|config| config.get_string("misty.defaultBranch").ok())
        .unwrap_or_else(|| {
            if repo.find_branch("master", BranchType::Local).is_ok() && repo.find_branch("main", BranchType::Local).is_err() {
                "master".into()
            } else {
                "main".into()
            }
        })
}

/// The current branch name, also for a branch with no commits yet.
pub fn current_branch(repo: &Repository) -> Result<String, CodeError> {
    let head = repo.find_reference("HEAD").map_err(|error| git_error("read HEAD", error))?;
    let target = head
        .symbolic_target()
        .ok()
        .flatten()
        .ok_or_else(|| CodeError::fix("The project is on a detached commit, not a branch. Switch to a branch first."))?;
    Ok(target.trim_start_matches("refs/heads/").to_owned())
}

pub(crate) fn head_commit(repo: &Repository) -> Option<git2::Commit<'_>> {
    repo.head().ok()?.peel_to_commit().ok()
}

pub(crate) fn tracking(repo: &Repository, branch: &str) -> Option<Oid> {
    repo.refname_to_id(&format!("refs/remotes/origin/{branch}")).ok()
}

fn file_kind(status: git2::Status) -> &'static str {
    if status.is_conflicted() {
        "conflicted"
    } else if status.is_wt_new() && !status.is_index_new() {
        "untracked"
    } else if status.intersects(git2::Status::INDEX_NEW) {
        "added"
    } else if status.intersects(git2::Status::WT_DELETED | git2::Status::INDEX_DELETED) {
        "deleted"
    } else if status.intersects(git2::Status::WT_RENAMED | git2::Status::INDEX_RENAMED) {
        "renamed"
    } else {
        "modified"
    }
}

/// Changed paths in the working folder, Git's ignored files left out.
pub(crate) fn changed_paths(repo: &Repository) -> Result<Vec<(String, git2::Status)>, CodeError> {
    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false)
        .exclude_submodules(true);
    let statuses = repo.statuses(Some(&mut options)).map_err(|error| git_error("read changes", error))?;
    Ok(statuses
        .iter()
        .filter_map(|entry| Some((entry.path().ok()?.to_owned(), entry.status())))
        .collect())
}

/// Branch, GitHub repository, how far ahead or behind, and changed files.
pub fn status(root: &Path) -> Result<Value, CodeError> {
    let repo = open(root)?;
    let branch = current_branch(&repo).ok();
    let head = head_commit(&repo);
    let remote = origin(&repo);
    let upstream = branch.as_deref().and_then(|name| tracking(&repo, name));
    let (ahead, behind) = match (head.as_ref(), upstream) {
        (Some(head), Some(upstream)) => repo.graph_ahead_behind(head.id(), upstream).unwrap_or((0, 0)),
        (Some(head), None) => {
            let mut walk = repo.revwalk().map_err(|error| git_error("count commits", error))?;
            walk.push(head.id()).ok();
            (walk.count(), 0)
        }
        _ => (0, 0),
    };
    let files: Vec<Value> = changed_paths(&repo)?
        .into_iter()
        .take(diff::MAX_FILES)
        .map(|(path, status)| {
            json!({
                "path": path,
                "kind": file_kind(status),
                "staged": status.intersects(git2::Status::INDEX_NEW | git2::Status::INDEX_MODIFIED | git2::Status::INDEX_DELETED | git2::Status::INDEX_RENAMED),
            })
        })
        .collect();
    Ok(json!({
        "repository": true,
        "branch": branch,
        "head": head.as_ref().map(|commit| commit.id().to_string()),
        "github": remote,
        "published": upstream.is_some(),
        "defaultBranch": default_branch(&repo),
        "ahead": ahead,
        "behind": behind,
        "clean": files.is_empty(),
        "files": files,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogRequest {
    #[serde(default)]
    pub limit: Option<usize>,
}

/// Recent commits on the current branch, newest first.
pub fn log(root: &Path, request: LogRequest) -> Result<Value, CodeError> {
    let repo = open(root)?;
    let Some(head) = head_commit(&repo) else {
        return Ok(json!({ "commits": [] }));
    };
    let pushed = current_branch(&repo).ok().and_then(|branch| tracking(&repo, &branch));
    let mut walk = repo.revwalk().map_err(|error| git_error("read history", error))?;
    walk.push(head.id()).map_err(|error| git_error("read history", error))?;
    let limit = request.limit.unwrap_or(30).clamp(1, 200);
    let mut commits = Vec::new();
    for oid in walk.flatten().take(limit) {
        let Ok(commit) = repo.find_commit(oid) else { continue };
        let author = commit.author();
        let on_github = pushed.is_some_and(|tip| tip == oid || repo.graph_descendant_of(tip, oid).unwrap_or(false));
        commits.push(json!({
            "sha": oid.to_string(),
            "subject": commit.summary().unwrap_or_default(),
            "author": author.name().unwrap_or_default(),
            "date": time::iso(author.when().seconds(), author.when().offset_minutes()),
            "onGitHub": on_github,
        }));
    }
    Ok(json!({ "commits": commits }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchRequest {
    pub name: String,
    #[serde(default)]
    pub create: bool,
}

fn valid_branch(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 120
        && !name.starts_with(['-', '/', '.'])
        && !name.ends_with(['/', '.'])
        && !name.contains("..")
        && !name.contains("//")
        && !name.ends_with(".lock")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '/' | '.'))
}

/// Creates a branch from the current commit, or switches to one. Switching
/// with uncommitted changes is refused rather than risking them.
pub fn branch(root: &Path, request: BranchRequest) -> Result<Value, CodeError> {
    let name = request.name.trim();
    if !valid_branch(name) {
        return Err(CodeError::fix("Use a simple branch name, like add-contact-page."));
    }
    let repo = open(root)?;
    if !changed_paths(&repo)?.is_empty() {
        return Err(CodeError::fix("Commit or undo the uncommitted changes before switching branches."));
    }
    let head = head_commit(&repo).ok_or_else(|| CodeError::fix("Make a first commit before creating branches."))?;
    let exists = repo.find_branch(name, BranchType::Local).is_ok();
    if request.create && !exists {
        repo.branch(name, &head, false).map_err(|error| git_error("create the branch", error))?;
    } else if !exists {
        return Err(CodeError::fix(format!("There's no branch {name}. Set create to make it.")));
    }
    let target = repo
        .revparse_single(&format!("refs/heads/{name}"))
        .map_err(|error| git_error("find the branch", error))?;
    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.safe();
    repo.checkout_tree(&target, Some(&mut checkout))
        .map_err(|error| git_error("switch branches", error))?;
    repo.set_head(&format!("refs/heads/{name}"))
        .map_err(|error| git_error("switch branches", error))?;
    status(root)
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiffRequest {
    /// A commit to show; omit for uncommitted changes.
    #[serde(default)]
    pub commit: Option<String>,
}

fn blob_bytes(repo: &Repository, oid: Oid) -> Option<Vec<u8>> {
    if oid.is_zero() {
        return None;
    }
    repo.find_blob(oid).ok().map(|blob| blob.content().to_vec())
}

/// Uncommitted changes against the last commit, or what one commit changed.
pub fn diff(root: &Path, request: DiffRequest) -> Result<diff::DiffSet, CodeError> {
    let repo = open(root)?;
    let mut builder = diff::Builder::default();
    if let Some(sha) = request.commit.as_deref().filter(|sha| !sha.trim().is_empty()) {
        let commit = repo
            .revparse_single(sha.trim())
            .and_then(|object| object.peel_to_commit())
            .map_err(|_| CodeError::fix(format!("There's no commit {sha}.")))?;
        let parent_tree = commit.parent(0).ok().and_then(|parent| parent.tree().ok());
        let tree = commit.tree().map_err(|error| git_error("read the commit", error))?;
        let changes = repo
            .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)
            .map_err(|error| git_error("compare commits", error))?;
        for delta in changes.deltas() {
            let old = blob_bytes(&repo, delta.old_file().id());
            let new = blob_bytes(&repo, delta.new_file().id());
            let path = delta.new_file().path().or(delta.old_file().path()).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
            let old_path = delta.old_file().path().map(|p| p.to_string_lossy().into_owned());
            // Secret files' contents never reach a diff, even from history.
            if beneath::protected(Path::new(&path)).is_some() {
                continue;
            }
            builder.file(&path, old_path.as_deref(), old.as_deref(), new.as_deref());
        }
        return Ok(builder.finish());
    }
    let head_tree = head_commit(&repo).and_then(|commit| commit.tree().ok());
    let root_dir = beneath::open_root(root).map_err(|error| CodeError::Scope(error.to_string()))?;
    for (path, _) in changed_paths(&repo)? {
        if beneath::protected(Path::new(&path)).is_some() {
            continue;
        }
        let old = head_tree
            .as_ref()
            .and_then(|tree| tree.get_path(Path::new(&path)).ok())
            .and_then(|entry| blob_bytes(&repo, entry.id()));
        let new = read_worktree(&root_dir, &path);
        if old.is_some() || new.is_some() {
            builder.file(&path, None, old.as_deref(), new.as_deref());
        }
    }
    Ok(builder.finish())
}

/// A working-folder file's bytes, never through a symlink; a symlink reads as
/// its target text, as Git stores it.
pub(crate) fn read_worktree(root_dir: &std::fs::File, path: &str) -> Option<Vec<u8>> {
    use std::io::Read;
    let relative = beneath::clean_relative(path).ok()?;
    if beneath::protected(&relative).is_some() {
        return None;
    }
    if let Ok(file) = beneath::open_file(root_dir, &relative) {
        let mut bytes = Vec::new();
        file.take(64 * 1024 * 1024).read_to_end(&mut bytes).ok()?;
        return Some(bytes);
    }
    beneath::read_link(root_dir, &relative)
        .ok()
        .map(|target| target.to_string_lossy().into_owned().into_bytes())
}

/// Where a run started: the branch and its commit, for undo.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Head {
    pub branch: String,
    pub sha: String,
}

pub fn record_head(root: &Path) -> Option<Head> {
    let repo = open(root).ok()?;
    let branch = current_branch(&repo).ok()?;
    let sha = head_commit(&repo)?.id().to_string();
    Some(Head { branch, sha })
}

/// After undo restored a run's files: moves the branch back to where the run
/// started when the run's commits never reached GitHub, and matches the index
/// to the branch. Returns (commits removed, commits already on GitHub).
pub fn rewind(root: &Path, start: &Head) -> Result<(usize, usize), CodeError> {
    let repo = open(root)?;
    let Ok(branch) = current_branch(&repo) else {
        return Ok((0, 0));
    };
    let (Some(head), Ok(start_oid)) = (head_commit(&repo), Oid::from_str(&start.sha)) else {
        return Ok((0, 0));
    };
    if branch != start.branch || head.id() == start_oid || !repo.graph_descendant_of(head.id(), start_oid).unwrap_or(false) {
        return Ok((0, 0));
    }
    let (made, _) = repo.graph_ahead_behind(head.id(), start_oid).unwrap_or((0, 0));
    if let Some(remote) = tracking(&repo, &branch) {
        if remote == head.id() || repo.graph_descendant_of(remote, start_oid).unwrap_or(false) {
            return Ok((0, made));
        }
    }
    let target = repo.find_commit(start_oid).map_err(|error| git_error("rewind", error))?;
    // Mixed: the branch and index move back; the files undo restored stay.
    repo.reset(target.as_object(), git2::ResetType::Mixed, None)
        .map_err(|error| git_error("rewind", error))?;
    Ok((made, 0))
}
