#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

#[cfg(unix)]
use std::collections::HashSet;
use std::path::Path;

use super::walk::{included_files, scan, sha256_file};

fn write(root: &Path, path: &str, text: &str) {
    let file = root.join(path);
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(file, text).unwrap();
}

fn fixture() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, ".gitignore", "*.zqskip\nzqlogs/\n");
    write(root, ".mistyignore", "zqprivate.txt\n!zqkeep.zqskip\n");
    write(root, "zqa.txt", "a");
    write(root, "zqkeep.zqskip", "kept by .mistyignore");
    write(root, "zqother.zqskip", "left out by .gitignore");
    write(root, "zqlogs/zqrun.txt", "left out by .gitignore");
    write(root, "zqprivate.txt", "left out by .mistyignore");
    write(root, ".zqdotfile", "dotfiles count");
    write(root, "zqsub/zqb.txt", "b");
    write(
        root,
        "zqsub/zqprivate.txt",
        "left out too: the rule has no slash",
    );
    write(root, ".git/config", "[core]");
    dir
}

#[test]
fn walker_applies_gitignore_then_mistyignore() {
    let dir = fixture();
    let root = std::fs::canonicalize(dir.path()).unwrap();
    let files: Vec<String> = included_files(&root)
        .unwrap()
        .into_iter()
        .map(|file| file.path)
        .collect();
    assert_eq!(
        files,
        [
            ".gitignore",
            ".mistyignore",
            ".zqdotfile",
            "zqa.txt",
            "zqkeep.zqskip",
            "zqsub/zqb.txt",
        ]
    );
}

#[test]
fn scan_lists_what_rules_leave_out_without_git() {
    let dir = fixture();
    let root = std::fs::canonicalize(dir.path()).unwrap();
    let found = scan(&root);
    let included: Vec<&str> = found
        .included
        .iter()
        .map(|file| file.path.as_str())
        .collect();
    assert!(included.contains(&"zqkeep.zqskip"));
    assert!(included.contains(&".zqdotfile"));
    assert_eq!(
        found.excluded,
        [
            "zqlogs/",
            "zqother.zqskip",
            "zqprivate.txt",
            "zqsub/zqprivate.txt"
        ]
    );
    assert!(!found.truncated);
    let everything = included
        .iter()
        .copied()
        .chain(found.excluded.iter().map(String::as_str));
    assert!(everything
        .into_iter()
        .all(|path| !path.starts_with(".git/")));
}

#[cfg(unix)]
#[test]
fn walker_follows_no_links() {
    let dir = fixture();
    let root = std::fs::canonicalize(dir.path()).unwrap();
    let outside = tempfile::tempdir().unwrap();
    write(outside.path(), "zqsecret.txt", "outside");
    std::os::unix::fs::symlink(outside.path(), root.join("zqlinked")).unwrap();
    std::os::unix::fs::symlink(outside.path().join("zqsecret.txt"), root.join("zqlink.txt"))
        .unwrap();
    let files: HashSet<String> = included_files(&root)
        .unwrap()
        .into_iter()
        .map(|file| file.path)
        .collect();
    assert!(!files.iter().any(|path| path.starts_with("zqlink")));
}

#[test]
fn hashes_a_file_in_chunks() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "zqhello.txt", "hello");
    let mut seen = 0;
    let (sha, size) = sha256_file(&dir.path().join("zqhello.txt"), |count| seen += count).unwrap();
    assert_eq!(
        sha,
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
    assert_eq!((size, seen), (5, 5));
}
