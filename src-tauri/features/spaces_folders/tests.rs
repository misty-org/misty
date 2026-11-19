#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use super::download::{checked, RemoteFile};
use super::paths::{id, inside, relative, relative_text, sha256};
use super::walk::{included_files, scan, sha256_file};

fn write(root: &Path, path: &str, text: &str) {
    let file = root.join(path);
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(file, text).unwrap();
}

/// A folder with a `.gitignore`, a `.mistyignore` that adds a rule and takes one back, a dotfile
/// and a `.git` folder. The names are odd on purpose, so a global Git excludes file on the
/// machine running the tests is unlikely to match them.
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
    write(root, "zqsub/zqprivate.txt", "left out too: the rule has no slash");
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
    let included: Vec<&str> = found.included.iter().map(|file| file.path.as_str()).collect();
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
    let everything = included.iter().copied().chain(found.excluded.iter().map(String::as_str));
    assert!(everything.into_iter().all(|path| !path.starts_with(".git/")));
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

#[test]
fn relative_paths_stay_inside() {
    assert_eq!(relative("docs/notes.md").unwrap(), PathBuf::from("docs").join("notes.md"));
    assert_eq!(relative(".env").unwrap(), PathBuf::from(".env"));
    for bad in [
        "",
        "/etc/passwd",
        "../up",
        "docs/../../up",
        "docs/./notes.md",
        "docs//notes.md",
        "docs/",
        "back\\slash",
        ".git/hooks/pre-commit",
        "sub/.GIT/config",
        "nul\0byte",
    ] {
        assert!(relative(bad).is_err(), "{bad:?} should be refused");
    }
    let root = Path::new("/cache/folder");
    assert!(inside(root, "a/b.txt").unwrap().starts_with(root));
}

#[test]
fn relative_text_writes_forward_slashes() {
    let root = Path::new("/root");
    assert_eq!(
        relative_text(root, &root.join("a").join("b.txt")).as_deref(),
        Some("a/b.txt")
    );
    assert_eq!(relative_text(root, root), None);
    assert_eq!(relative_text(root, Path::new("/elsewhere/a")), None);
}

#[test]
fn ids_are_one_folder_name() {
    assert!(id("3f2b9c1e-aaaa-4bbb-8ccc-1234567890ab").is_ok());
    assert!(id("folder_1").is_ok());
    for bad in ["", "..", "a/b", "a\\b", "a.b", &"x".repeat(129)] {
        assert!(id(bad).is_err(), "{bad:?} should be refused");
    }
}

#[test]
fn checksums_are_hex() {
    let good = "A".repeat(64);
    assert_eq!(sha256(&good).unwrap(), "a".repeat(64));
    assert!(sha256("abc").is_err());
    assert!(sha256(&"g".repeat(64)).is_err());
}

fn remote(path: &str) -> RemoteFile {
    RemoteFile {
        path: path.into(),
        sha256: "0".repeat(64),
        size: 1,
        url: "https://storage.example/object".into(),
        headers: Default::default(),
    }
}

#[test]
fn manifest_paths_are_checked() {
    assert!(checked(vec![remote("a.txt"), remote("docs/b.txt")]).is_ok());
    assert!(checked(vec![remote("a.txt"), remote("a.txt")]).is_err());
    assert!(checked(vec![remote("docs"), remote("docs/b.txt")]).is_err());
    assert!(checked(vec![remote("../escape")]).is_err());
    let mut file = remote("a.txt");
    file.url = "file:///etc/passwd".into();
    assert!(checked(vec![file]).is_err());
}
