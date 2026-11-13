// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//
// The changes panel's Git, against real repositories made in a scratch folder.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use std::path::{Path, PathBuf};

use git2::Repository;

/// A scratch folder named `misty-*` in the temp folder, which the file gate always reaches.
pub(super) struct Scratch(pub(super) PathBuf);

impl Scratch {
    pub(super) fn new() -> Self {
        let path = std::env::temp_dir().join(format!("misty-git-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        Self(std::fs::canonicalize(path).unwrap())
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub(super) fn commit_file(repo: &Repository, relative: &str, content: &str) {
    let workdir = repo.workdir().unwrap();
    if let Some(parent) = workdir.join(relative).parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(workdir.join(relative), content).unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new(relative)).unwrap();
    index.write().unwrap();
    let tree_id = index.write_tree().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    let signature = git2::Signature::now("test", "test@example.com").unwrap();
    let parent = repo.head().ok().and_then(|head| head.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    repo.commit(
        Some("HEAD"),
        &signature,
        &signature,
        "init",
        &tree,
        &parents,
    )
    .unwrap();
}

/// A clone with `core.autocrlf` pinned off before its checkout, so a global `autocrlf=true`
/// can't make an untouched file read as changed.
pub(super) fn clone_lf(origin: &Path, into: &Path) -> Repository {
    let mut builder = git2::build::RepoBuilder::new();
    builder.with_checkout(git2::build::CheckoutBuilder::new());
    let repo = builder.clone(origin.to_str().unwrap(), into).unwrap();
    repo.config()
        .unwrap()
        .set_bool("core.autocrlf", false)
        .unwrap();
    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.force();
    repo.checkout_head(Some(&mut checkout)).unwrap();
    repo
}

mod branches;
mod changes;
mod status;
mod tree;
