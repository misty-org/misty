// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! The file tree's Git colors and repository badges.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use super::{commit_file, Scratch};
use std::collections::HashMap;
use std::path::Path;

use git2::Repository;

use super::super::tree::*;

fn tree_level(path: &Path, files: &[&str], directories: &[&str]) -> GitTreeLevel {
    GitTreeLevel {
        path: path.to_string_lossy().into_owned(),
        files: files.iter().map(|name| name.to_string()).collect(),
        directories: directories.iter().map(|name| name.to_string()).collect(),
    }
}

#[test]
fn single_level_colors_keep_untracked_directories_collapsed() {
    let scratch = Scratch::new();
    let repo = Repository::init(&scratch.0).unwrap();
    commit_file(&repo, "tracked.txt", "clean\n");
    let untracked = scratch.0.join("untracked");
    std::fs::create_dir(&untracked).unwrap();
    std::fs::write(untracked.join("new.txt"), "new\n").unwrap();
    let root_colors = file_tree_colors(scratch.0.to_str().unwrap(), &["untracked".to_string()]);
    assert_eq!(root_colors.get("untracked"), Some(&"untracked"));
    let child_colors = file_tree_colors(untracked.to_str().unwrap(), &["new.txt".to_string()]);
    assert!(child_colors.is_empty());
}

#[test]
fn tree_batch_scans_each_repository_once_and_refreshes_without_ttl() {
    let scratch = Scratch::new();
    let repo = Repository::init(&scratch.0).unwrap();
    std::fs::create_dir_all(scratch.0.join("sub/deep")).unwrap();
    commit_file(&repo, "sub/tracked.txt", "clean\n");
    std::fs::write(scratch.0.join("sub/tracked.txt"), "dirty\n").unwrap();
    std::fs::write(scratch.0.join("sub/deep/new.txt"), "new\n").unwrap();
    let levels = || {
        vec![
            tree_level(&scratch.0, &["sub"], &["sub"]),
            tree_level(&scratch.0.join("sub"), &["tracked.txt", "deep"], &["deep"]),
            tree_level(&scratch.0.join("sub/deep"), &["new.txt"], &[]),
        ]
    };
    let mut snapshots = TreeSnapshots::new(true);
    let result = tree_status_blocking(levels(), &mut snapshots);
    assert_eq!(snapshots.scans, 1);
    assert_eq!(result.repositories.len(), 1);
    assert_eq!(result.repositories[0].changed, 1);
    assert_eq!(result.repositories[0].untracked, 1);
    assert_eq!(
        result.file_colors[&scratch.0.to_string_lossy().into_owned()]["sub"],
        "modified"
    );
    assert_eq!(
        result.file_colors[&scratch.0.join("sub/deep").to_string_lossy().into_owned()]["new.txt"],
        "untracked"
    );

    std::fs::write(scratch.0.join("sub/tracked.txt"), "clean\n").unwrap();
    std::fs::remove_file(scratch.0.join("sub/deep/new.txt")).unwrap();
    let mut snapshots = TreeSnapshots::new(true);
    let refreshed = tree_status_blocking(levels(), &mut snapshots);
    assert_eq!(snapshots.scans, 1);
    assert_eq!(refreshed.repositories[0].changed, 0);
    assert_eq!(refreshed.repositories[0].untracked, 0);
    assert!(refreshed.file_colors.values().all(HashMap::is_empty));
}

#[test]
fn tree_batch_preserves_nested_repositories_and_non_repository_levels() {
    let scratch = Scratch::new();
    let outer = scratch.0.join("outer");
    let inner = outer.join("inner");
    let plain = scratch.0.join("plain");
    std::fs::create_dir(&plain).unwrap();
    let repo = Repository::init(&outer).unwrap();
    commit_file(&repo, "tracked.txt", "clean\n");
    let nested = Repository::init(&inner).unwrap();
    commit_file(&nested, "nested.txt", "clean\n");
    std::fs::write(inner.join("nested.txt"), "dirty\n").unwrap();
    let mut snapshots = TreeSnapshots::new(true);
    let result = tree_status_blocking(
        vec![
            tree_level(&scratch.0, &["outer", "plain"], &["outer", "plain"]),
            tree_level(&outer, &["inner", "tracked.txt"], &["inner"]),
            tree_level(&inner, &["nested.txt"], &[]),
            tree_level(&plain, &["unknown.txt"], &[]),
        ],
        &mut snapshots,
    );
    assert_eq!(snapshots.scans, 2);
    assert_eq!(result.repositories.len(), 2);
    let key = |path: &Path| path.to_string_lossy().into_owned();
    assert_eq!(result.file_colors[&key(&scratch.0)]["outer"], "repository");
    assert_eq!(result.file_colors[&key(&outer)]["inner"], "repository");
    assert_eq!(result.file_colors[&key(&inner)]["nested.txt"], "modified");
    assert!(result.file_colors[&key(&plain)].is_empty());
    assert!(!result.file_colors[&key(&scratch.0)].contains_key("plain"));
}

#[test]
fn ordinary_subdirectory_of_a_repo_is_not_a_repository() {
    let scratch = Scratch::new();
    let repo = Repository::init(&scratch.0).unwrap();
    commit_file(&repo, "tracked.txt", "clean\n");
    let plain = scratch.0.join("plain");
    std::fs::create_dir(&plain).unwrap();
    assert!(exact_repository_summary(&plain).is_none());
    assert!(exact_repository_summary(&scratch.0).is_some());
}

#[test]
fn summary_counts_changes_and_untracked_once() {
    let scratch = Scratch::new();
    let nested = scratch.0.join("nested");
    let repo = Repository::init(&nested).unwrap();
    commit_file(&repo, "tracked.txt", "clean\n");
    // Modified in the index and again in the folder: one file.
    std::fs::write(nested.join("tracked.txt"), "staged\n").unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("tracked.txt")).unwrap();
    index.write().unwrap();
    std::fs::write(nested.join("tracked.txt"), "changed again\n").unwrap();
    std::fs::write(nested.join("untracked.txt"), "new\n").unwrap();
    let summary = exact_repository_summary(&nested).unwrap();
    assert_eq!(summary.branch, repo.head().unwrap().shorthand().unwrap());
    assert_eq!(summary.changed, 1);
    assert_eq!(summary.untracked, 1);
}

#[test]
fn batch_keeps_only_exact_roots_and_clean_status() {
    let scratch = Scratch::new();
    let repo_root = scratch.0.join("repo");
    let repo = Repository::init(&repo_root).unwrap();
    commit_file(&repo, "tracked.txt", "clean\n");
    let plain = scratch.0.join("plain");
    std::fs::create_dir(&plain).unwrap();
    let summaries = repository_summaries_blocking(vec![
        plain.to_string_lossy().into_owned(),
        repo_root.to_string_lossy().into_owned(),
    ]);
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].path, repo_root.to_string_lossy().into_owned());
    assert_eq!((summaries[0].changed, summaries[0].untracked), (0, 0));
}

#[test]
fn file_colors_distinguish_untracked_from_modified() {
    let scratch = Scratch::new();
    let repo_root = scratch.0.join("repo");
    let repo = Repository::init(&repo_root).unwrap();
    commit_file(&repo, "clean.txt", "clean\n");
    commit_file(&repo, "modified.txt", "clean\n");
    std::fs::write(repo_root.join("modified.txt"), "dirty\n").unwrap();
    std::fs::write(repo_root.join("untracked.txt"), "new\n").unwrap();
    let colors = file_tree_colors(
        &repo_root.to_string_lossy(),
        &[
            "clean.txt".to_string(),
            "modified.txt".to_string(),
            "untracked.txt".to_string(),
        ],
    );
    assert_eq!(colors.get("clean.txt"), None, "colors={colors:?}");
    assert_eq!(colors.get("modified.txt"), Some(&"modified"));
    assert_eq!(colors.get("untracked.txt"), Some(&"untracked"));
}

#[test]
fn file_colors_are_empty_outside_an_exact_repo() {
    let scratch = Scratch::new();
    let child = scratch.0.join("plain");
    std::fs::create_dir(&child).unwrap();
    assert!(file_tree_colors(&child.to_string_lossy(), &["whatever.txt".to_string()]).is_empty());
}

#[test]
fn folders_inherit_the_dirty_state_of_their_children() {
    let scratch = Scratch::new();
    let repo_root = scratch.0.join("repo");
    let repo = Repository::init(&repo_root).unwrap();
    commit_file(&repo, "clean.txt", "clean\n");
    std::fs::create_dir_all(repo_root.join("sub/deep")).unwrap();
    std::fs::write(repo_root.join("sub/deep/new.txt"), "x\n").unwrap();
    commit_file(&repo, "mixed/tracked.txt", "clean\n");
    std::fs::write(repo_root.join("mixed/tracked.txt"), "dirty\n").unwrap();
    std::fs::write(repo_root.join("mixed/extra.txt"), "new\n").unwrap();
    commit_file(&repo, "edited/file.txt", "clean\n");
    std::fs::write(repo_root.join("edited/file.txt"), "dirty\n").unwrap();
    let colors = file_tree_colors(
        &repo_root.to_string_lossy(),
        &[
            "clean.txt".to_string(),
            "sub".to_string(),
            "mixed".to_string(),
            "edited".to_string(),
        ],
    );
    // Only new files below: new. Anything changed below: changed.
    assert_eq!(colors.get("clean.txt"), None, "colors={colors:?}");
    assert_eq!(colors.get("sub"), Some(&"untracked"));
    assert_eq!(colors.get("mixed"), Some(&"modified"));
    assert_eq!(colors.get("edited"), Some(&"modified"));
}

#[test]
fn colors_work_for_a_subdirectory_listing_inside_a_repo() {
    let scratch = Scratch::new();
    let repo_root = scratch.0.join("repo");
    let repo = Repository::init(&repo_root).unwrap();
    commit_file(&repo, "top.txt", "clean\n");
    commit_file(&repo, "pkg/kept.txt", "clean\n");
    commit_file(&repo, "pkg/inner.txt", "clean\n");
    std::fs::write(repo_root.join("pkg/inner.txt"), "dirty\n").unwrap();
    std::fs::create_dir_all(repo_root.join("pkg/newdir")).unwrap();
    std::fs::write(repo_root.join("pkg/newdir/f.txt"), "x\n").unwrap();
    let colors = file_tree_colors(
        &repo_root.join("pkg").to_string_lossy(),
        &[
            "kept.txt".to_string(),
            "inner.txt".to_string(),
            "newdir".to_string(),
        ],
    );
    assert_eq!(colors.get("kept.txt"), None, "colors={colors:?}");
    assert_eq!(colors.get("inner.txt"), Some(&"modified"));
    assert_eq!(colors.get("newdir"), Some(&"untracked"));
}

#[test]
fn nested_repo_folder_is_marked_as_a_repository() {
    // A tree whose root isn't a repository, with a changed repository two levels down.
    let scratch = Scratch::new();
    let workspace = scratch.0.join("ws");
    let nested = workspace.join("Project").join("inner-repo");
    std::fs::create_dir_all(&nested).unwrap();
    let repo = Repository::init(&nested).unwrap();
    commit_file(&repo, "tracked.txt", "clean\n");
    std::fs::write(nested.join("tracked.txt"), "dirty\n").unwrap();
    std::fs::write(nested.join("fresh.txt"), "new\n").unwrap();
    let colors = file_tree_colors(
        &workspace.join("Project").to_string_lossy(),
        &["inner-repo".to_string()],
    );
    assert_eq!(colors.get("inner-repo"), Some(&"repository"));
}
