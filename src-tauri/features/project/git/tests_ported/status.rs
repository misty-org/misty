// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! Status, line counts, ahead and behind, init, and opening a repository.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use super::{commit_file, Scratch};
use std::path::Path;

use git2::Repository;

use super::super::repo::*;
use super::super::tree::exact_repository_summary;

#[test]
fn untracked_line_count_rejects_over_budget_single_line() {
    let scratch = Scratch::new();
    let repo = Repository::init(&scratch.0).unwrap();
    std::fs::write(scratch.0.join("long.txt"), vec![b'x'; 1024 * 1024 + 1]).unwrap();
    assert_eq!(count_untracked_lines(&repo, "long.txt"), None);
}

#[test]
fn untracked_line_count_accepts_exact_byte_budget() {
    let scratch = Scratch::new();
    let repo = Repository::init(&scratch.0).unwrap();
    let mut content = vec![b'x'; 1024 * 1024];
    std::fs::write(scratch.0.join("exact.txt"), &content).unwrap();
    assert_eq!(count_untracked_lines(&repo, "exact.txt"), Some((1, 0)));
    *content.last_mut().unwrap() = b'\n';
    std::fs::write(scratch.0.join("exact.txt"), content).unwrap();
    assert_eq!(count_untracked_lines(&repo, "exact.txt"), Some((1, 0)));
}

#[test]
fn untracked_line_count_preserves_text_and_newline_semantics() {
    let scratch = Scratch::new();
    let repo = Repository::init(&scratch.0).unwrap();
    for (content, expected) in [
        ("", 0),
        ("中文🙂", 1),
        ("first\nsecond", 2),
        ("first\nsecond\n", 2),
        ("\n", 1),
        ("\n\n", 2),
        ("one\r\ntwo\r\n", 2),
    ] {
        std::fs::write(scratch.0.join("text.txt"), content).unwrap();
        assert_eq!(
            count_untracked_lines(&repo, "text.txt"),
            Some((expected, 0)),
            "{content:?}"
        );
    }
}

#[test]
fn untracked_line_count_rejects_binary_even_after_first_chunk() {
    let scratch = Scratch::new();
    let repo = Repository::init(&scratch.0).unwrap();
    let mut content = vec![b'x'; 20 * 1024];
    content.push(0);
    std::fs::write(scratch.0.join("binary.dat"), content).unwrap();
    assert_eq!(count_untracked_lines(&repo, "binary.dat"), None);
}

#[test]
fn untracked_line_count_does_not_report_a_truncated_line_total() {
    let scratch = Scratch::new();
    let repo = Repository::init(&scratch.0).unwrap();
    for (content, expected) in [
        ("\n".repeat(100_000), Some((100_000, 0))),
        ("\n".repeat(100_001), None),
        (format!("{}tail", "\n".repeat(100_000)), None),
    ] {
        std::fs::write(scratch.0.join("lines.txt"), content).unwrap();
        assert_eq!(count_untracked_lines(&repo, "lines.txt"), expected);
    }
}

#[cfg(unix)]
#[test]
fn untracked_line_count_rejects_non_regular_targets() {
    let scratch = Scratch::new();
    let repo = Repository::init(&scratch.0).unwrap();
    std::os::unix::fs::symlink("/dev/null", scratch.0.join("device")).unwrap();
    assert_eq!(count_untracked_lines(&repo, "device"), None);
    std::fs::create_dir(scratch.0.join("directory")).unwrap();
    assert_eq!(count_untracked_lines(&repo, "directory"), None);
}

#[test]
fn untracked_line_count_stops_when_file_grows_during_read() {
    use std::io::{Read, Write};

    struct GrowingFile {
        reader: std::fs::File,
        writer: Option<std::fs::File>,
        bytes_read: usize,
    }

    impl Read for GrowingFile {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            let read = self.reader.read(buffer)?;
            self.bytes_read += read;
            if let Some(mut writer) = self.writer.take() {
                writer.write_all(&vec![b'x'; 1024 * 1024])?;
            }
            Ok(read)
        }
    }

    let scratch = Scratch::new();
    let path = scratch.0.join("growing.txt");
    std::fs::write(&path, vec![b'x'; 16 * 1024]).unwrap();
    let mut reader = GrowingFile {
        reader: std::fs::File::open(&path).unwrap(),
        writer: Some(
            std::fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .unwrap(),
        ),
        bytes_read: 0,
    };
    assert_eq!(count_untracked_reader(&mut reader), None);
    assert_eq!(reader.bytes_read, 1024 * 1024 + 1);
    assert!(std::fs::metadata(path).unwrap().len() > 1024 * 1024);
}

#[cfg(unix)]
#[test]
fn untracked_line_count_rejects_fifo_without_opening_it() {
    use std::os::unix::ffi::OsStrExt;

    let scratch = Scratch::new();
    let repo = Repository::init(&scratch.0).unwrap();
    let path = std::ffi::CString::new(scratch.0.join("pipe").as_os_str().as_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(path.as_ptr(), 0o600) }, 0);
    assert_eq!(count_untracked_lines(&repo, "pipe"), None);
}

#[test]
fn untracked_line_count_leaves_optional_stats_unknown_when_skipped() {
    let scratch = Scratch::new();
    Repository::init(&scratch.0).unwrap();
    std::fs::write(scratch.0.join("large.txt"), vec![b'x'; 1024 * 1024 + 1]).unwrap();
    std::fs::write(scratch.0.join("binary.dat"), b"binary\0data").unwrap();
    std::fs::write(scratch.0.join("empty.txt"), b"").unwrap();
    let status = git_status_blocking(&scratch.0).unwrap();
    assert_eq!(status.untracked.len(), 3);
    for entry in status.untracked {
        let expected = (entry.path == "empty.txt").then_some(0);
        assert_eq!(entry.additions, expected, "{}", entry.path);
        assert_eq!(entry.deletions, expected, "{}", entry.path);
    }
}

#[test]
fn status_ignores_skip_worktree_paths() {
    let scratch = Scratch::new();
    let repo = Repository::init(&scratch.0).unwrap();
    commit_file(&repo, "sparse.txt", "index only\n");
    // A sparse checkout: tracked in the index, marked skip-worktree, absent from the folder.
    std::fs::remove_file(scratch.0.join("sparse.txt")).unwrap();
    let mut index = repo.index().unwrap();
    let mut entry = index.get_path(Path::new("sparse.txt"), 0).unwrap();
    entry.flags_extended |= INDEX_ENTRY_SKIP_WORKTREE;
    index.add(&entry).unwrap();
    index.write().unwrap();

    let status = git_status_blocking(&scratch.0).unwrap();
    assert!(status.staged.is_empty(), "status={status:?}");
    assert!(status.unstaged.is_empty(), "status={status:?}");
    assert!(status.untracked.is_empty(), "status={status:?}");
    // The tree's summary reads the same snapshot.
    assert_eq!(exact_repository_summary(&scratch.0).unwrap().changed, 0);
}

#[test]
fn status_still_reports_a_real_worktree_deletion() {
    let scratch = Scratch::new();
    let repo = Repository::init(&scratch.0).unwrap();
    commit_file(&repo, "gone.txt", "deleted for real\n");
    std::fs::remove_file(scratch.0.join("gone.txt")).unwrap();
    let status = git_status_blocking(&scratch.0).unwrap();
    assert_eq!(status.unstaged.len(), 1, "status={status:?}");
    assert_eq!(status.unstaged[0].path, "gone.txt");
    assert_eq!(status.unstaged[0].deletions, Some(1));
}

#[test]
fn status_reports_ahead_behind_vs_upstream() {
    let scratch = Scratch::new();
    let origin_path = scratch.0.join("origin");
    let origin = Repository::init(&origin_path).unwrap();
    commit_file(&origin, "a.txt", "a\n");
    let local_path = scratch.0.join("local");
    let local = Repository::clone(origin_path.to_str().unwrap(), &local_path).unwrap();
    commit_file(&local, "b.txt", "b\n");
    commit_file(&origin, "c.txt", "c\n");
    local
        .find_remote("origin")
        .unwrap()
        .fetch(&["refs/heads/*:refs/remotes/origin/*"], None, None)
        .unwrap();
    let status = git_status_blocking(&local_path).unwrap();
    assert_eq!(status.ahead, Some(1), "status={status:?}");
    assert_eq!(status.behind, Some(1), "status={status:?}");
}

#[test]
fn status_omits_ahead_behind_without_upstream() {
    let scratch = Scratch::new();
    let repo_path = scratch.0.join("plain");
    let repo = Repository::init(&repo_path).unwrap();
    commit_file(&repo, "a.txt", "a\n");
    let status = git_status_blocking(&repo_path).unwrap();
    assert_eq!((status.ahead, status.behind), (None, None));
}

#[test]
fn init_turns_a_plain_directory_into_a_repository() {
    let scratch = Scratch::new();
    std::fs::write(scratch.0.join("a.txt"), "a\n").unwrap();
    assert_eq!(git_status_blocking(&scratch.0).unwrap_err(), "NOT_A_REPO");
    init_repository(&scratch.0).unwrap();
    let status = git_status_blocking(&scratch.0).unwrap();
    let untracked: Vec<_> = status.untracked.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(untracked, vec!["a.txt"]);
}

#[test]
fn status_names_the_unborn_branch_of_a_fresh_repository() {
    let scratch = Scratch::new();
    let repo = Repository::init(&scratch.0).unwrap();
    let expected = repo
        .find_reference("HEAD")
        .unwrap()
        .symbolic_target()
        .and_then(|target| target.strip_prefix("refs/heads/"))
        .unwrap()
        .to_string();
    let status = git_status_blocking(&scratch.0).unwrap();
    assert_eq!(status.branch, expected);
    assert_ne!(status.branch, "HEAD");
}

#[test]
fn init_inside_an_existing_repository_leaves_it_alone() {
    let scratch = Scratch::new();
    Repository::init(&scratch.0).unwrap();
    let nested = scratch.0.join("sub");
    std::fs::create_dir_all(&nested).unwrap();
    init_repository(&nested).unwrap();
    // A stale answer must not nest a second repository that hides the outer one's changes.
    assert!(!nested.join(".git").exists());
}

#[test]
fn init_never_creates_a_missing_directory() {
    let scratch = Scratch::new();
    let missing = scratch.0.join("gone");
    assert!(init_repository(&missing).is_err());
    assert!(!missing.exists());
}

#[test]
fn open_repo_error_mapping_keeps_real_causes() {
    assert_eq!(
        map_open_repo_error(git2::Error::new(
            git2::ErrorCode::NotFound,
            git2::ErrorClass::Repository,
            "could not find repository"
        )),
        "NOT_A_REPO"
    );
    // libgit2's ownership check: GIT_EOWNER, judged by its code, not its wording.
    assert_eq!(
        map_open_repo_error(git2::Error::new(
            git2::ErrorCode::Owner,
            git2::ErrorClass::Config,
            "repository path 'C:/x' is owned by someone else"
        )),
        "GIT_UNSAFE_REPO:repository path 'C:/x' is owned by someone else"
    );
    // Without the code, the wording still classifies it.
    assert!(map_open_repo_error(git2::Error::new(
        git2::ErrorCode::GenericError,
        git2::ErrorClass::Os,
        "repository path 'C:/x' is not owned by current user"
    ))
    .starts_with("GIT_UNSAFE_REPO:"));
    assert!(map_open_repo_error(git2::Error::new(
        git2::ErrorCode::GenericError,
        git2::ErrorClass::Os,
        "path too long"
    ))
    .starts_with("GIT_OPEN_FAILED:"));
}

#[test]
fn open_repo_non_repo_is_not_a_repo() {
    let scratch = Scratch::new();
    match open_repo(&scratch.0) {
        Err(error) => assert_eq!(error, "NOT_A_REPO"),
        Ok(_) => panic!("a plain folder opened as a repository"),
    }
}

/// A path with spaces and non-Latin names is still a repository.
#[test]
fn open_repo_supports_unicode_paths() {
    let scratch = Scratch::new();
    let path = scratch.0.join("中文 目录");
    let repo = Repository::init(&path).unwrap();
    commit_file(&repo, "a.txt", "a\n");
    assert!(open_repo(&path).unwrap().workdir().is_some());
}

#[test]
fn image_kinds_and_types() {
    assert!(is_image(Path::new("a/b.PNG")));
    assert!(!is_image(Path::new("a/b.txt")));
    assert_eq!(image_mime(Path::new("x.jpeg")), "image/jpeg");
    assert_eq!(image_mime(Path::new("x.svg")), "image/svg+xml");
}
