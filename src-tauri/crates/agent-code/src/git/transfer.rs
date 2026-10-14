//! Moving commits between a project and GitHub through GitHub's API via
//! Composio (docs/plans/agent-git-projects.md, route B). Git's own transfer
//! protocol needs a token on the computer, which Composio never hands out.
//!
//! Pushing sends each new blob, tree and commit with exactly its local
//! content, so GitHub computes the same hashes and history matches on both
//! sides. Fetching rebuilds commits from GitHub's description of them; GitHub
//! reports times in UTC and trims messages, so each commit is rebuilt with
//! every real timezone offset until its hash matches the one GitHub reports.
//! A match proves the rebuilt commit is byte for byte the original.
use std::{collections::HashSet, path::Path};

use base64::Engine;
use git2::{ObjectType, Oid, Repository, Sort};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{current_branch, git_error, open, time, tracking, GitHubRepo};
use crate::CodeError;

/// Files larger than this don't fit through GitHub's API via Composio.
const MAX_BLOB: usize = 20 * 1024 * 1024;
/// Objects one push or fetch may move.
const MAX_OBJECTS: usize = 20_000;
/// Blob bytes one `read_blobs` call returns, so transfers go in batches.
const MAX_BATCH_BYTES: usize = 8 * 1024 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Person {
    pub name: String,
    pub email: String,
    /// ISO 8601: with the original offset when pushing, UTC from GitHub.
    pub date: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommitData {
    pub sha: String,
    pub tree: String,
    pub parents: Vec<String>,
    pub author: Person,
    pub committer: Person,
    pub message: String,
    /// An armored signature (gpgsig), when the commit is signed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    /// GitHub's exact signed payload, when it reports one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TreeEntry {
    /// The entry's name inside its tree (no slashes).
    pub path: String,
    pub mode: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub sha: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TreeData {
    pub sha: String,
    pub entries: Vec<TreeEntry>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BlobRef {
    pub sha: String,
    pub size: usize,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PushPlan {
    pub github: GitHubRepo,
    pub branch: String,
    pub head: String,
    pub up_to_date: bool,
    /// Oldest first; each commit's trees and blobs come before it.
    pub commits: Vec<CommitData>,
    /// Children before parents.
    pub trees: Vec<TreeData>,
    pub blobs: Vec<BlobRef>,
}

fn oid(text: &str) -> Result<Oid, CodeError> {
    Oid::from_str(text.trim()).map_err(|_| CodeError::fix(format!("{text} isn't a commit hash.")))
}

fn mode_text(mode: i32) -> String {
    format!("{mode:06o}")
}

fn person(signature: &git2::Signature) -> Result<Person, CodeError> {
    let (Ok(name), Ok(email)) = (signature.name(), signature.email()) else {
        return Err(CodeError::fix("A commit's author isn't valid UTF-8, so GitHub's API can't recreate it."));
    };
    Ok(Person {
        name: name.to_owned(),
        email: email.to_owned(),
        date: time::iso(signature.when().seconds(), signature.when().offset_minutes()),
    })
}

/// What a push to GitHub must send for the current branch, given where the
/// branch is on GitHub (`remote_head`, or None for a new branch).
pub fn push_plan(root: &Path, remote_head: Option<&str>) -> Result<PushPlan, CodeError> {
    let repo = open(root)?;
    let github = super::origin(&repo)
        .ok_or_else(|| CodeError::fix("This project isn't on GitHub yet. Publish it first."))?;
    let branch = current_branch(&repo)?;
    let head = super::head_commit(&repo).ok_or_else(|| CodeError::fix("Make a first commit before pushing."))?;
    let remote = remote_head.map(oid).transpose()?;
    if let Some(remote) = remote {
        if remote == head.id() {
            return Ok(PushPlan { github, branch, head: head.id().to_string(), up_to_date: true, commits: vec![], trees: vec![], blobs: vec![] });
        }
        if repo.find_commit(remote).is_err() || !repo.graph_descendant_of(head.id(), remote).unwrap_or(false) {
            return Err(CodeError::fix(format!(
                "GitHub has commits on {branch} that this project doesn't. Pull first, then push."
            )));
        }
    }
    // Objects GitHub already has: everything in the commit it's on.
    let mut known: HashSet<Oid> = HashSet::new();
    if let Some(remote) = remote {
        if let Ok(tree) = repo.find_commit(remote).and_then(|commit| commit.tree()) {
            collect_tree(&repo, &tree, &mut known)?;
        }
    }
    let mut walk = repo.revwalk().map_err(|error| git_error("list commits", error))?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::REVERSE).ok();
    walk.push(head.id()).map_err(|error| git_error("list commits", error))?;
    if let Some(remote) = remote {
        walk.hide(remote).ok();
    }
    let mut plan = PushPlan { github, branch, head: head.id().to_string(), up_to_date: false, commits: vec![], trees: vec![], blobs: vec![] };
    for id in walk {
        let id = id.map_err(|error| git_error("list commits", error))?;
        let commit = repo.find_commit(id).map_err(|error| git_error("read a commit", error))?;
        let header = String::from_utf8_lossy(commit.raw_header_bytes()).into_owned();
        if header.lines().any(|line| !line.starts_with(' ') && !["tree ", "parent ", "author ", "committer ", "gpgsig "].iter().any(|key| line.starts_with(key))) {
            return Err(CodeError::fix(format!(
                "Commit {} has headers GitHub's API can't recreate (such as a non-UTF-8 encoding).",
                &id.to_string()[..7]
            )));
        }
        let message = commit
            .message_raw()
            .ok()
            .ok_or_else(|| CodeError::fix("A commit message isn't valid UTF-8, so GitHub's API can't recreate it."))?;
        let tree = commit.tree().map_err(|error| git_error("read a commit", error))?;
        add_tree(&repo, &tree, &mut known, &mut plan)?;
        let signature = commit
            .header_field_bytes("gpgsig")
            .ok()
            .and_then(|bytes| bytes.as_str().ok().map(str::to_owned));
        plan.commits.push(CommitData {
            sha: id.to_string(),
            tree: tree.id().to_string(),
            parents: commit.parent_ids().map(|parent| parent.to_string()).collect(),
            author: person(&commit.author())?,
            committer: person(&commit.committer())?,
            message: message.to_owned(),
            signature,
            payload: None,
        });
        if plan.trees.len() + plan.blobs.len() + plan.commits.len() > MAX_OBJECTS {
            return Err(CodeError::fix("That push is too large to send through GitHub's API at once."));
        }
    }
    Ok(plan)
}

fn collect_tree(repo: &Repository, tree: &git2::Tree, known: &mut HashSet<Oid>) -> Result<(), CodeError> {
    if !known.insert(tree.id()) {
        return Ok(());
    }
    for entry in tree.iter() {
        if entry.kind() == Some(ObjectType::Tree) {
            let child = repo.find_tree(entry.id()).map_err(|error| git_error("read a folder", error))?;
            collect_tree(repo, &child, known)?;
        } else {
            known.insert(entry.id());
        }
    }
    Ok(())
}

fn add_tree(repo: &Repository, tree: &git2::Tree, known: &mut HashSet<Oid>, plan: &mut PushPlan) -> Result<(), CodeError> {
    if known.contains(&tree.id()) {
        return Ok(());
    }
    let mut entries = Vec::new();
    for entry in tree.iter() {
        let name = entry
            .name()
            .ok()
            .ok_or_else(|| CodeError::fix("A file name isn't valid UTF-8, so GitHub's API can't recreate it."))?
            .to_owned();
        let kind = match entry.kind() {
            Some(ObjectType::Tree) => {
                let child = repo.find_tree(entry.id()).map_err(|error| git_error("read a folder", error))?;
                add_tree(repo, &child, known, plan)?;
                "tree"
            }
            Some(ObjectType::Blob) => {
                if known.insert(entry.id()) {
                    let size = repo.find_blob(entry.id()).map(|blob| blob.size()).unwrap_or(0);
                    if size > MAX_BLOB {
                        return Err(CodeError::fix(format!("{name} is over 20 MB, too large to push through GitHub's API.")));
                    }
                    plan.blobs.push(BlobRef { sha: entry.id().to_string(), size });
                }
                "blob"
            }
            Some(ObjectType::Commit) => "commit",
            _ => continue,
        };
        entries.push(TreeEntry { path: name, mode: mode_text(entry.filemode()), kind: kind.into(), sha: entry.id().to_string() });
    }
    known.insert(tree.id());
    plan.trees.push(TreeData { sha: tree.id().to_string(), entries });
    Ok(())
}

/// Blob contents for a push, base64, in batches of at most 8 MB.
pub fn read_blobs(root: &Path, shas: &[String]) -> Result<Value, CodeError> {
    let repo = open(root)?;
    let mut out = Vec::new();
    let mut bytes = 0usize;
    for sha in shas {
        let blob = repo.find_blob(oid(sha)?).map_err(|error| git_error("read a file", error))?;
        if bytes > 0 && bytes + blob.size() > MAX_BATCH_BYTES {
            break;
        }
        bytes += blob.size();
        out.push(json!({ "sha": sha, "content": base64::engine::general_purpose::STANDARD.encode(blob.content()) }));
    }
    Ok(json!({ "blobs": out }))
}

/// After GitHub accepted a push: remembers where the branch is on GitHub.
pub fn record_push(root: &Path, branch: &str, sha: &str) -> Result<(), CodeError> {
    let repo = open(root)?;
    let target = oid(sha)?;
    repo.reference(&format!("refs/remotes/origin/{branch}"), target, true, "push through GitHub's API")
        .map_err(|error| git_error("record the push", error))?;
    let mut config = repo.config().map_err(|error| git_error("record the push", error))?;
    config.set_str(&format!("branch.{branch}.remote"), "origin").ok();
    config.set_str(&format!("branch.{branch}.merge"), &format!("refs/heads/{branch}")).ok();
    Ok(())
}

/// Which of these objects the project doesn't have yet.
pub fn missing(root: &Path, shas: &[String]) -> Result<Vec<String>, CodeError> {
    let repo = open(root)?;
    let odb = repo.odb().map_err(|error| git_error("read objects", error))?;
    Ok(shas
        .iter()
        .filter(|sha| Oid::from_str(sha).map_or(true, |id| !odb.exists(id)))
        .cloned()
        .collect())
}

#[derive(Deserialize, Debug)]
pub struct BlobData {
    pub sha: String,
    /// Base64.
    pub content: String,
}

#[derive(Deserialize, Debug, Default)]
pub struct FetchedObjects {
    #[serde(default)]
    pub blobs: Vec<BlobData>,
    #[serde(default)]
    pub trees: Vec<TreeData>,
    #[serde(default)]
    pub commits: Vec<CommitData>,
}

/// Git's tree entry order: by name, with folders compared as if they ended in "/".
fn tree_bytes(entries: &[TreeEntry]) -> Result<Vec<u8>, CodeError> {
    let mut sorted: Vec<&TreeEntry> = entries.iter().collect();
    let key = |entry: &TreeEntry| {
        let mut name = entry.path.as_bytes().to_vec();
        if entry.kind == "tree" {
            name.push(b'/');
        }
        name
    };
    sorted.sort_by_key(|entry| key(entry));
    let mut out = Vec::new();
    for entry in sorted {
        if entry.path.is_empty() || entry.path.contains(['/', '\0']) {
            return Err(CodeError::fix("GitHub described a folder entry Git can't store."));
        }
        let mode = entry.mode.trim_start_matches('0');
        if !matches!(mode, "40000" | "100644" | "100755" | "120000" | "160000") {
            return Err(CodeError::fix("GitHub described a file mode Git doesn't use."));
        }
        out.extend_from_slice(mode.as_bytes());
        out.push(b' ');
        out.extend_from_slice(entry.path.as_bytes());
        out.push(0);
        out.extend_from_slice(oid(&entry.sha)?.as_bytes());
    }
    Ok(out)
}

/// Every timezone offset in use, in minutes, nearest the common ones first.
fn offsets() -> Vec<i32> {
    let mut all: Vec<i32> = (-48..=56).map(|quarter| quarter * 15).collect();
    all.sort_by_key(|offset| (offset % 60 != 0, offset.abs()));
    all
}

fn signature_header(signature: &str) -> String {
    let mut header = String::from("gpgsig");
    for (index, line) in signature.trim_end_matches('\n').split('\n').enumerate() {
        header.push_str(if index == 0 { " " } else { "\n " });
        header.push_str(line);
    }
    header.push('\n');
    header
}

/// The exact bytes of a commit GitHub described, or None when no timezone
/// and message ending reproduce its hash.
pub fn rebuild_commit(commit: &CommitData) -> Option<Vec<u8>> {
    let expected = Oid::from_str(&commit.sha).ok()?;
    if let (Some(payload), Some(signature)) = (&commit.payload, &commit.signature) {
        let (headers, message) = payload.split_once("\n\n")?;
        let raw = format!("{headers}\n{}\n{message}", signature_header(signature));
        let bytes = raw.into_bytes();
        if Oid::hash_object(ObjectType::Commit, &bytes).ok()? == expected {
            return Some(bytes);
        }
    }
    let author_time = time::parse_iso(&commit.author.date)?;
    let committer_time = time::parse_iso(&commit.committer.date)?;
    let mut head = format!("tree {}\n", commit.tree);
    for parent in &commit.parents {
        head.push_str(&format!("parent {parent}\n"));
    }
    let signed = commit.signature.as_deref().map(signature_header).unwrap_or_default();
    let base = commit.message.trim_end_matches('\n');
    let messages = [format!("{base}\n"), base.to_owned(), format!("{base}\n\n"), commit.message.clone()];
    let line = |role: &str, who: &Person, seconds: i64, offset: i32| {
        format!("{role} {} <{}> {seconds} {}\n", who.name, who.email, time::git_offset(offset))
    };
    let try_build = |author_offset: i32, committer_offset: i32, message: &str| {
        let raw = format!(
            "{head}{}{}{signed}\n{message}",
            line("author", &commit.author, author_time, author_offset),
            line("committer", &commit.committer, committer_time, committer_offset),
        );
        let bytes = raw.into_bytes();
        (Oid::hash_object(ObjectType::Commit, &bytes).ok() == Some(expected)).then_some(bytes)
    };
    let zones = offsets();
    for message in &messages {
        for offset in &zones {
            if let Some(bytes) = try_build(*offset, *offset, message) {
                return Some(bytes);
            }
        }
    }
    for message in &messages {
        for author_offset in &zones {
            for committer_offset in &zones {
                if let Some(bytes) = try_build(*author_offset, *committer_offset, message) {
                    return Some(bytes);
                }
            }
        }
    }
    None
}

/// Writes objects fetched from GitHub, checking every hash. Commits that
/// can't be reproduced exactly are listed and not written.
pub fn write_objects(root: &Path, objects: FetchedObjects) -> Result<Value, CodeError> {
    let repo = open(root)?;
    let odb = repo.odb().map_err(|error| git_error("write objects", error))?;
    let write = |kind: ObjectType, bytes: &[u8], expected: &str| -> Result<(), CodeError> {
        let written = odb.write(kind, bytes).map_err(|error| git_error("write objects", error))?;
        if written != oid(expected)? {
            return Err(CodeError::fix(format!("GitHub's copy of {expected} didn't match its hash.")));
        }
        Ok(())
    };
    for blob in &objects.blobs {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(blob.content.replace(['\n', '\r'], ""))
            .map_err(|_| CodeError::fix("GitHub sent a file Misty couldn't decode."))?;
        write(ObjectType::Blob, &bytes, &blob.sha)?;
    }
    for tree in &objects.trees {
        write(ObjectType::Tree, &tree_bytes(&tree.entries)?, &tree.sha)?;
    }
    let mut unmatched = Vec::new();
    for commit in &objects.commits {
        match rebuild_commit(commit) {
            Some(bytes) => write(ObjectType::Commit, &bytes, &commit.sha)?,
            None => unmatched.push(commit.sha.clone()),
        }
    }
    Ok(json!({
        "written": objects.blobs.len() + objects.trees.len() + objects.commits.len() - unmatched.len(),
        "unmatched": unmatched,
    }))
}

fn add_shallow(repo: &Repository, boundary: &[String]) -> Result<(), CodeError> {
    if boundary.is_empty() {
        return Ok(());
    }
    let path = repo.path().join("shallow");
    let mut lines: Vec<String> = std::fs::read_to_string(&path)
        .unwrap_or_default()
        .lines()
        .map(str::to_owned)
        .collect();
    for sha in boundary {
        oid(sha)?;
        if !lines.contains(sha) {
            lines.push(sha.clone());
        }
    }
    lines.sort();
    std::fs::write(&path, format!("{}\n", lines.join("\n"))).map_err(|error| crate::io_fix("record history depth", error))
}

/// After a fetch: records where `branch` is on GitHub and brings the local
/// branch up to it when that's a fast-forward and nothing would be lost.
/// `boundary` lists fetched commits whose parents weren't fetched.
pub fn update_branch(root: &Path, branch: &str, remote_sha: &str, boundary: &[String]) -> Result<Value, CodeError> {
    let repo = open(root)?;
    let target = oid(remote_sha)?;
    let commit = repo
        .find_commit(target)
        .map_err(|_| CodeError::fix("The commit from GitHub isn't in the project; fetch it first."))?;
    add_shallow(&repo, boundary)?;
    repo.reference(&format!("refs/remotes/origin/{branch}"), target, true, "fetch through GitHub's API")
        .map_err(|error| git_error("record GitHub's branch", error))?;
    let local_ref = format!("refs/heads/{branch}");
    let local = repo.refname_to_id(&local_ref).ok();
    let current = current_branch(&repo).ok();
    let state = match local {
        Some(local) if local == target => "up_to_date",
        Some(local) if repo.graph_descendant_of(local, target).unwrap_or(false) => "ahead",
        Some(local) if !repo.graph_descendant_of(target, local).unwrap_or(false) => "diverged",
        _ => {
            if current.as_deref() == Some(branch) {
                let unborn = local.is_none();
                if !unborn && !super::changed_paths(&repo)?.is_empty() {
                    return Ok(json!({ "state": "blocked", "reason": "uncommitted changes" }));
                }
                let mut checkout = git2::build::CheckoutBuilder::new();
                if unborn {
                    checkout.force();
                } else {
                    checkout.safe();
                }
                repo.checkout_tree(commit.as_object(), Some(&mut checkout))
                    .map_err(|error| git_error("update the files", error))?;
            }
            repo.reference(&local_ref, target, true, "fast-forward from GitHub")
                .map_err(|error| git_error("move the branch", error))?;
            if current.is_none() || current.as_deref() == Some(branch) {
                repo.set_head(&local_ref).map_err(|error| git_error("move the branch", error))?;
            }
            record_push(root, branch, remote_sha)?;
            "updated"
        }
    };
    Ok(json!({ "state": state }))
}

/// The order commits were described in doesn't matter for writing, but
/// boundary detection needs to know which parents are missing.
pub fn boundary(commits: &[CommitData], have: impl Fn(&str) -> bool) -> Vec<String> {
    let fetched: HashSet<&str> = commits.iter().map(|commit| commit.sha.as_str()).collect();
    commits
        .iter()
        .filter(|commit| commit.parents.iter().any(|parent| !fetched.contains(parent.as_str()) && !have(parent)))
        .map(|commit| commit.sha.clone())
        .collect()
}

/// Whether the project has this commit.
pub fn has_commit(root: &Path, sha: &str) -> bool {
    open(root)
        .ok()
        .and_then(|repo| Oid::from_str(sha).ok().map(|id| repo.find_commit(id).is_ok()))
        .unwrap_or(false)
}

/// For a branch never fetched: whether GitHub's branch is known locally.
pub fn tracked(root: &Path, branch: &str) -> Option<String> {
    let repo = open(root).ok()?;
    tracking(&repo, branch).map(|id| id.to_string())
}
