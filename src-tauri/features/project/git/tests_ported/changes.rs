// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! Diffs, image diffs, index writes and discarding.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use super::{commit_file, Scratch};
use std::path::Path;

use git2::Repository;

use super::super::repo::*;

#[test]
fn diff_includes_untracked_file_content() {
    let scratch = Scratch::new();
    Repository::init(&scratch.0).unwrap();
    std::fs::write(scratch.0.join("new.txt"), "hello\n").unwrap();
    let unstaged = git_diff_blocking(&scratch.0, "new.txt", false).unwrap();
    assert!(unstaged.contains("+hello"), "unstaged patch: {unstaged}");
    let staged = git_diff_blocking(&scratch.0, "new.txt", true).unwrap();
    assert!(
        !staged.contains("+hello"),
        "staged leaked untracked: {staged}"
    );
}

#[test]
fn binary_untracked_file_shows_marker_not_content() {
    let scratch = Scratch::new();
    Repository::init(&scratch.0).unwrap();
    let mut data = vec![0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0xff, 0xfe];
    data.extend(std::iter::repeat_n(0u8, 64));
    std::fs::write(scratch.0.join("bin.dat"), &data).unwrap();
    let text = git_diff_blocking(&scratch.0, "bin.dat", false).unwrap();
    assert!(
        text.contains("Binary files /dev/null and b/bin.dat differ"),
        "binary patch: {text}"
    );
}

#[test]
fn image_diff_returns_both_sides_for_worktree_changes() {
    let scratch = Scratch::new();
    let repo = Repository::init(&scratch.0).unwrap();
    commit_file(&repo, "logo.png", "v1");
    std::fs::write(scratch.0.join("logo.png"), "v2").unwrap();
    let diff = git_diff_images_blocking(&scratch.0, "logo.png", false).unwrap();
    assert_eq!(diff.old.as_deref(), Some("data:image/png;base64,djE="));
    assert_eq!(diff.new.as_deref(), Some("data:image/png;base64,djI="));
}

#[test]
fn image_diff_marks_added_and_deleted_sides() {
    let scratch = Scratch::new();
    let path = &scratch.0;
    let repo = Repository::init(path).unwrap();
    commit_file(&repo, "keep.txt", "keep\n");
    std::fs::write(path.join("added.webp"), "webp").unwrap();

    let untracked = git_diff_images_blocking(path, "added.webp", false).unwrap();
    assert!(untracked.old.is_none());
    assert!(untracked.new.is_some());

    git_stage_blocking(path, &["added.webp".to_string()]).unwrap();
    let added = git_diff_images_blocking(path, "added.webp", true).unwrap();
    assert!(added.old.is_none(), "an added image has no HEAD side");
    assert!(added
        .new
        .as_deref()
        .unwrap()
        .starts_with("data:image/webp;base64,"));

    commit_file(&repo, "added.webp", "webp");
    std::fs::remove_file(path.join("added.webp")).unwrap();
    git_stage_blocking(path, &["added.webp".to_string()]).unwrap();
    let deleted = git_diff_images_blocking(path, "added.webp", true).unwrap();
    assert!(
        deleted.old.is_some(),
        "a staged deletion keeps its HEAD side"
    );
    assert!(deleted.new.is_none(), "a staged deletion has no index side");
}

#[test]
fn image_diff_rejects_oversized_assets_and_non_images() {
    let scratch = Scratch::new();
    let path = &scratch.0;
    let repo = Repository::init(path).unwrap();
    commit_file(&repo, "keep.txt", "keep\n");
    std::fs::write(path.join("big.png"), vec![0u8; MAX_IMAGE_BYTES + 1]).unwrap();
    let error = git_diff_images_blocking(path, "big.png", false).unwrap_err();
    assert!(error.contains("5MB"), "size limit reported: {error}");
    assert!(git_diff_images_blocking(path, "keep.txt", false).is_err());
}

#[test]
fn diff_is_capped_with_explicit_truncation_marker() {
    let scratch = Scratch::new();
    Repository::init(&scratch.0).unwrap();
    let line = "x".repeat(1024);
    let mut content = String::new();
    while content.len() <= MAX_DIFF_PATCH_BYTES {
        content.push_str(&line);
        content.push('\n');
    }
    std::fs::write(scratch.0.join("big.log"), &content).unwrap();
    let text = git_diff_blocking(&scratch.0, "big.log", false).unwrap();
    assert!(text.contains(DIFF_TRUNCATED_MARKER));
    assert!(text.len() <= MAX_DIFF_PATCH_BYTES + DIFF_TRUNCATED_MARKER.len() + 1);
}

/// Two clicks in the panel (stage while an unstage is still running) overlap; libgit2 would
/// fail the second with "the index is locked". Both must land.
#[test]
fn overlapping_index_writes_on_one_repo_both_land() {
    let scratch = Scratch::new();
    let repo = Repository::init(&scratch.0).unwrap();
    {
        // A larger index widens the read-modify-write window.
        let mut index = repo.index().unwrap();
        for i in 0..2000 {
            let relative = format!("f{i}.txt");
            std::fs::write(scratch.0.join(&relative), format!("{i}\n")).unwrap();
            index.add_path(Path::new(&relative)).unwrap();
        }
        index.write().unwrap();
    }
    commit_file(&repo, "a.txt", "base\n");
    commit_file(&repo, "b.txt", "base\n");
    let path = scratch.0.clone();
    for round in 0..10 {
        std::fs::write(scratch.0.join("a.txt"), format!("a{round}\n")).unwrap();
        std::fs::write(scratch.0.join("b.txt"), format!("b{round}\n")).unwrap();
        let start = std::sync::Arc::new(std::sync::Barrier::new(2));
        let stage = |file: &'static str| {
            let path = path.clone();
            let start = std::sync::Arc::clone(&start);
            std::thread::spawn(move || {
                start.wait();
                git_stage_blocking(&path, &[file.to_string()])
            })
        };
        let (a, b) = (stage("a.txt"), stage("b.txt"));
        a.join().unwrap().expect("staging a.txt");
        b.join().unwrap().expect("staging b.txt");
        let index = Repository::open(&scratch.0).unwrap().index().unwrap();
        let head = repo.head().unwrap().peel_to_tree().unwrap();
        for file in ["a.txt", "b.txt"] {
            assert_ne!(
                index.get_path(Path::new(file), 0).unwrap().id,
                head.get_path(Path::new(file)).unwrap().id(),
                "{file} staged in round {round}"
            );
        }
        git_unstage_blocking(&path, &["a.txt".to_string(), "b.txt".to_string()]).unwrap();
    }
}

#[test]
fn discard_restores_worktree_from_index_preserving_staged_hunks() {
    for (autocrlf, expected) in [(false, "staged\n"), (true, "staged\r\n")] {
        let scratch = Scratch::new();
        let repo = Repository::init(&scratch.0).unwrap();
        repo.config()
            .unwrap()
            .set_bool("core.autocrlf", autocrlf)
            .unwrap();
        repo.config().unwrap().set_str("core.eol", "lf").unwrap();
        commit_file(&repo, "a.txt", "base\n");
        std::fs::write(scratch.0.join("a.txt"), "staged\n").unwrap();
        {
            let mut index = repo.index().unwrap();
            index.add_path(Path::new("a.txt")).unwrap();
            index.write().unwrap();
        }
        let staged_blob = repo
            .index()
            .unwrap()
            .get_path(Path::new("a.txt"), 0)
            .unwrap()
            .id;
        std::fs::write(scratch.0.join("a.txt"), "unstaged\n").unwrap();
        git_discard_blocking(&scratch.0, &["a.txt".to_string()]).unwrap();
        assert_eq!(
            std::fs::read_to_string(scratch.0.join("a.txt")).unwrap(),
            expected
        );
        assert_eq!(
            repo.index()
                .unwrap()
                .get_path(Path::new("a.txt"), 0)
                .unwrap()
                .id,
            staged_blob
        );
        assert_eq!(repo.find_blob(staged_blob).unwrap().content(), b"staged\n");
    }
}

#[test]
fn discard_restores_unstaged_deletion() {
    for (autocrlf, expected) in [(false, "keep\n"), (true, "keep\r\n")] {
        let scratch = Scratch::new();
        let repo = Repository::init(&scratch.0).unwrap();
        repo.config()
            .unwrap()
            .set_bool("core.autocrlf", autocrlf)
            .unwrap();
        repo.config().unwrap().set_str("core.eol", "lf").unwrap();
        commit_file(&repo, "a.txt", "keep\n");
        let staged_tree = repo.index().unwrap().write_tree().unwrap();
        std::fs::remove_file(scratch.0.join("a.txt")).unwrap();
        git_discard_blocking(&scratch.0, &["a.txt".to_string()]).unwrap();
        assert_eq!(
            std::fs::read_to_string(scratch.0.join("a.txt")).unwrap(),
            expected
        );
        assert_eq!(repo.index().unwrap().write_tree().unwrap(), staged_tree);
    }
}

#[test]
fn discard_keeps_staged_new_file_content() {
    for (autocrlf, expected) in [(false, "fresh\n"), (true, "fresh\r\n")] {
        let scratch = Scratch::new();
        let repo = Repository::init(&scratch.0).unwrap();
        repo.config()
            .unwrap()
            .set_bool("core.autocrlf", autocrlf)
            .unwrap();
        repo.config().unwrap().set_str("core.eol", "lf").unwrap();
        commit_file(&repo, "base.txt", "base\n");
        std::fs::write(scratch.0.join("new.txt"), "fresh\n").unwrap();
        {
            let mut index = repo.index().unwrap();
            index.add_path(Path::new("new.txt")).unwrap();
            index.write().unwrap();
        }
        let staged_tree = repo.index().unwrap().write_tree().unwrap();
        git_discard_blocking(&scratch.0, &["new.txt".to_string()]).unwrap();
        assert_eq!(
            std::fs::read_to_string(scratch.0.join("new.txt")).unwrap(),
            expected
        );
        assert_eq!(repo.index().unwrap().write_tree().unwrap(), staged_tree);
    }
}

#[test]
fn discard_removes_untracked_file() {
    let scratch = Scratch::new();
    let repo = Repository::init(&scratch.0).unwrap();
    commit_file(&repo, "a.txt", "a\n");
    std::fs::create_dir_all(scratch.0.join("sub")).unwrap();
    std::fs::write(scratch.0.join("sub/new.txt"), "x\n").unwrap();
    git_discard_blocking(&scratch.0, &["sub/new.txt".to_string()]).unwrap();
    assert!(!scratch.0.join("sub/new.txt").exists());
    assert_eq!(
        std::fs::read_to_string(scratch.0.join("a.txt")).unwrap(),
        "a\n"
    );
}
