// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! Pull, push, branches and switching between them.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use super::{commit_file, Scratch};
use std::path::Path;

use git2::Repository;

use super::super::repo::*;
use super::clone_lf;

fn pull(path: &Path) -> Result<(), String> {
    tauri::async_runtime::block_on(super::super::pull(path))
}

#[test]
fn pull_conflict_preserves_head_index_and_worktree() {
    if crate::engines::resolve::find_program("git").is_none() {
        return;
    }
    for staged in [false, true] {
        let scratch = Scratch::new();
        let origin_path = scratch.0.join("origin");
        let origin = Repository::init(&origin_path).unwrap();
        commit_file(&origin, "shared.txt", "base\n");
        let local_path = scratch.0.join("local");
        let local = clone_lf(&origin_path, &local_path);
        let old_head = local.head().unwrap().target().unwrap();
        std::fs::write(local_path.join("shared.txt"), "local\n").unwrap();
        if staged {
            let mut index = local.index().unwrap();
            index.add_path(Path::new("shared.txt")).unwrap();
            index.write().unwrap();
        }
        let old_index = local.index().unwrap().write_tree().unwrap();
        commit_file(&origin, "shared.txt", "remote\n");
        let error = pull(&local_path).unwrap_err();
        assert_eq!(local.head().unwrap().target(), Some(old_head), "{error}");
        assert_eq!(local.index().unwrap().write_tree().unwrap(), old_index);
        assert_eq!(
            std::fs::read_to_string(local_path.join("shared.txt")).unwrap(),
            "local\n"
        );
        assert!(error.contains("shared.txt"), "{error}");
    }
}

#[test]
fn pull_fast_forward_preserves_unrelated_local_changes() {
    if crate::engines::resolve::find_program("git").is_none() {
        return;
    }
    let scratch = Scratch::new();
    let origin_path = scratch.0.join("origin");
    let origin = Repository::init(&origin_path).unwrap();
    commit_file(&origin, "shared.txt", "base\n");
    commit_file(&origin, "local.txt", "base\n");
    let local_path = scratch.0.join("local");
    let local = clone_lf(&origin_path, &local_path);
    std::fs::write(local_path.join("local.txt"), "staged\n").unwrap();
    let mut index = local.index().unwrap();
    index.add_path(Path::new("local.txt")).unwrap();
    index.write().unwrap();
    let staged_blob = index.get_path(Path::new("local.txt"), 0).unwrap().id;
    std::fs::write(local_path.join("local.txt"), "unstaged\n").unwrap();
    std::fs::write(local_path.join("new.txt"), "untracked\n").unwrap();
    commit_file(&origin, "shared.txt", "remote\n");
    pull(&local_path).unwrap();
    assert_eq!(
        local.head().unwrap().target(),
        origin.head().unwrap().target()
    );
    let read = |name: &str| std::fs::read_to_string(local_path.join(name)).unwrap();
    assert_eq!(read("shared.txt"), "remote\n");
    assert_eq!(read("local.txt"), "unstaged\n");
    assert_eq!(read("new.txt"), "untracked\n");
    assert_eq!(
        local
            .index()
            .unwrap()
            .get_path(Path::new("local.txt"), 0)
            .unwrap()
            .id,
        staged_blob
    );
    // Up to date now: a second pull changes nothing.
    pull(&local_path).unwrap();
}

#[test]
fn push_sets_the_upstream_of_a_new_branch() {
    if crate::engines::resolve::find_program("git").is_none() {
        return;
    }
    let scratch = Scratch::new();
    let origin_path = scratch.0.join("origin.git");
    Repository::init_bare(&origin_path).unwrap();
    let local_path = scratch.0.join("local");
    let local = Repository::init(&local_path).unwrap();
    commit_file(&local, "a.txt", "a\n");
    local
        .remote("origin", origin_path.to_str().unwrap())
        .unwrap();
    tauri::async_runtime::block_on(super::super::push(&local_path)).unwrap();
    let branch = current_branch_name(&local).unwrap();
    let pushed = Repository::open_bare(&origin_path)
        .unwrap()
        .find_reference(&format!("refs/heads/{branch}"))
        .unwrap()
        .target();
    assert_eq!(pushed, local.head().unwrap().target());
    let status = git_status_blocking(&local_path).unwrap();
    assert_eq!((status.ahead, status.behind), (Some(0), Some(0)));
}

#[test]
fn branches_list_locals_then_remote_tracking_skipping_origin_head() {
    let scratch = Scratch::new();
    let origin_path = scratch.0.join("origin");
    let origin = Repository::init(&origin_path).unwrap();
    commit_file(&origin, "a.txt", "a\n");
    let head = origin.head().unwrap().peel_to_commit().unwrap();
    origin.branch("v1.0.9", &head, false).unwrap();
    let local_path = scratch.0.join("local");
    let local = Repository::clone(origin_path.to_str().unwrap(), &local_path).unwrap();
    let remote_head = format!(
        "refs/remotes/origin/{}",
        origin.head().unwrap().shorthand().unwrap()
    );
    local
        .reference_symbolic("refs/remotes/origin/HEAD", &remote_head, true, "test")
        .unwrap();
    let branches = git_branches_blocking(&local_path).unwrap();
    let names: Vec<&str> = branches.iter().map(|b| b.name.as_str()).collect();
    assert!(names.contains(&"origin/v1.0.9"), "names={names:?}");
    assert!(!names.contains(&"origin/HEAD"), "names={names:?}");
    let local_count = branches.iter().filter(|b| !b.is_remote).count();
    assert!(local_count > 0, "names={names:?}");
    assert!(branches[..local_count].iter().all(|b| !b.is_remote));
    assert!(branches[local_count..].iter().all(|b| b.is_remote));
}

#[test]
fn checkout_remote_branch_creates_local_tracking_branch() {
    let scratch = Scratch::new();
    let origin_path = scratch.0.join("origin");
    let origin = Repository::init(&origin_path).unwrap();
    commit_file(&origin, "a.txt", "a\n");
    let head = origin.head().unwrap().peel_to_commit().unwrap();
    origin.branch("v1.0.9", &head, false).unwrap();
    let local_path = scratch.0.join("local");
    let local = Repository::clone(origin_path.to_str().unwrap(), &local_path).unwrap();
    git_checkout_blocking(&local_path, "origin/v1.0.9").unwrap();
    let head_ref = local.head().unwrap();
    assert_eq!(head_ref.shorthand(), Some("v1.0.9"));
    assert_eq!(head_ref.target(), Some(head.id()));
    let branch = local
        .find_branch("v1.0.9", git2::BranchType::Local)
        .unwrap();
    assert_eq!(
        branch.upstream().unwrap().name().unwrap(),
        Some("origin/v1.0.9")
    );
    let status = git_status_blocking(&local_path).unwrap();
    assert_eq!((status.ahead, status.behind), (Some(0), Some(0)));
}

#[test]
fn checkout_remote_branch_keeps_existing_local_branch() {
    let scratch = Scratch::new();
    let origin_path = scratch.0.join("origin");
    let origin = Repository::init(&origin_path).unwrap();
    commit_file(&origin, "a.txt", "a\n");
    let base = origin.head().unwrap().peel_to_commit().unwrap();
    origin.branch("feature", &base, false).unwrap();
    let local_path = scratch.0.join("local");
    let local = Repository::clone(origin_path.to_str().unwrap(), &local_path).unwrap();
    // The local `feature` has a commit the remote lacks; switching must never reset it.
    local
        .branch(
            "feature",
            &local.head().unwrap().peel_to_commit().unwrap(),
            false,
        )
        .unwrap();
    local.set_head("refs/heads/feature").unwrap();
    commit_file(&local, "local.txt", "local\n");
    let local_tip = local.head().unwrap().target().unwrap();
    assert_ne!(local_tip, base.id());
    git_checkout_blocking(&local_path, "origin/feature").unwrap();
    assert_eq!(local.head().unwrap().target(), Some(local_tip));
    assert!(local_path.join("local.txt").exists());
    let branch = local
        .find_branch("feature", git2::BranchType::Local)
        .unwrap();
    assert!(branch.upstream().is_err());
}

#[test]
fn create_branch_switches_to_it() {
    let scratch = Scratch::new();
    let repo = Repository::init(&scratch.0).unwrap();
    commit_file(&repo, "a.txt", "a\n");
    git_create_branch_blocking(&scratch.0, " topic ").unwrap();
    assert_eq!(repo.head().unwrap().shorthand(), Some("topic"));
    assert!(git_create_branch_blocking(&scratch.0, "  ").is_err());
}
