use std::{
    ffi::OsStr,
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};

use super::checked::CheckedDir;
use super::place::{clone_or_copy_new, keep_both_names, rename_keep_both, rename_new};
use super::walk::{copy_tree_checked, remove_tree_checked, tree_size_checked, WalkFor};
use super::{allow_disk, grant_lock, normalize_asked, revoke_disk, sys};
use crate::Access;

fn scratch() -> (tempfile::TempDir, PathBuf) {
    let directory = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(directory.path()).unwrap();
    (directory, root)
}

fn home() -> PathBuf {
    dirs::home_dir().expect("a home folder")
}

#[test]
fn dot_dot_and_relative_paths_are_refused() {
    let (_directory, root) = scratch();
    fs::create_dir_all(root.join("a")).unwrap();
    assert!(normalize_asked(&root.join("a/../a")).is_err());
    assert!(normalize_asked(Path::new("relative/folder")).is_err());
    assert_eq!(normalize_asked(&root.join("./a")).unwrap(), root.join("a"));
    assert!(CheckedDir::open(&root.join("a/../a"), Access::Read).is_err());
}

#[cfg(unix)]
#[test]
fn links_are_never_followed_from_a_handle() {
    let (_directory, root) = scratch();
    fs::create_dir_all(root.join("real")).unwrap();
    fs::write(root.join("real/file.txt"), b"x").unwrap();
    std::os::unix::fs::symlink(root.join("real"), root.join("link")).unwrap();
    std::os::unix::fs::symlink(root.join("real/file.txt"), root.join("file-link")).unwrap();
    let dir = CheckedDir::open(&root, Access::Write).unwrap();
    assert_eq!(
        dir.child(OsStr::new("link"), Access::Read)
            .unwrap_err()
            .kind(),
        ErrorKind::PermissionDenied
    );
    assert!(dir.open_file(OsStr::new("file-link")).is_err());
    assert!(dir.child(OsStr::new(".."), Access::Read).is_err());
    assert!(dir.open_file(OsStr::new("real/file.txt")).is_err());
    assert!(sys::Dir::open_real(&root.join("link")).is_err());
}

#[cfg(unix)]
#[test]
fn a_folder_swapped_for_a_link_keeps_its_handle_on_the_real_folder() {
    let (_directory, root) = scratch();
    fs::create_dir_all(root.join("a")).unwrap();
    fs::create_dir_all(root.join("outside")).unwrap();
    let dir = CheckedDir::open(&root.join("a"), Access::Write).unwrap();
    fs::rename(root.join("a"), root.join("b")).unwrap();
    std::os::unix::fs::symlink(root.join("outside"), root.join("a")).unwrap();
    dir.create_file(OsStr::new("note.txt")).unwrap();
    assert!(root.join("b/note.txt").exists());
    assert!(!root.join("outside/note.txt").exists());
}

#[test]
fn rename_new_never_replaces() {
    let (_directory, root) = scratch();
    fs::write(root.join("a.txt"), b"a").unwrap();
    fs::write(root.join("b.txt"), b"b").unwrap();
    let dir = CheckedDir::open(&root, Access::Write).unwrap();
    let error = rename_new(&dir, OsStr::new("a.txt"), &dir, OsStr::new("b.txt")).unwrap_err();
    assert_eq!(error.kind(), ErrorKind::AlreadyExists);
    assert_eq!(fs::read(root.join("a.txt")).unwrap(), b"a");
    assert_eq!(fs::read(root.join("b.txt")).unwrap(), b"b");
    let used = rename_keep_both(&dir, OsStr::new("a.txt"), &dir, OsStr::new("b.txt")).unwrap();
    assert_eq!(used, OsStr::new("b 2.txt"));
    assert_eq!(fs::read(root.join("b 2.txt")).unwrap(), b"a");
    let copied = clone_or_copy_new(&dir, OsStr::new("b.txt"), &dir, OsStr::new("b 2.txt"));
    assert_eq!(copied.unwrap_err().kind(), ErrorKind::AlreadyExists);
    assert_eq!(
        clone_or_copy_new(&dir, OsStr::new("b.txt"), &dir, OsStr::new("c.txt")).unwrap(),
        1
    );
    assert_eq!(fs::read(root.join("c.txt")).unwrap(), b"b");
}

#[test]
fn keep_both_numbers_names_as_finder_does() {
    let first = |name: &str| keep_both_names(name).next().unwrap();
    assert_eq!(first("photo.jpg"), "photo 2.jpg");
    assert_eq!(first("notes 2.txt"), "notes 3.txt");
    assert_eq!(first("archive"), "archive 2");
    assert_eq!(first("Report 10.pdf"), "Report 11.pdf");
    assert_eq!(first("Take 1.mov"), "Take 1 2.mov");
    assert_eq!(
        keep_both_names("photo.jpg").take(3).collect::<Vec<_>>(),
        ["photo 2.jpg", "photo 3.jpg", "photo 4.jpg"]
    );
}

#[test]
fn copying_a_tree_leaves_secrets_behind() {
    let (_directory, root) = scratch();
    let project = root.join("project");
    fs::create_dir_all(project.join(".ssh")).unwrap();
    fs::create_dir_all(project.join("app")).unwrap();
    fs::write(project.join(".ssh/id_ed25519"), b"key").unwrap();
    fs::write(project.join("app/.env"), b"TOKEN=1").unwrap();
    fs::write(project.join("app/main.rs"), b"fn main() {}").unwrap();
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink("main.rs", project.join("app/inside")).unwrap();
        std::os::unix::fs::symlink("/etc/hosts", project.join("app/outside")).unwrap();
        std::os::unix::fs::symlink("../../escape", project.join("app/escape")).unwrap();
    }
    let outcome = copy_tree_checked(
        &project,
        &root,
        OsStr::new("copy"),
        WalkFor::Person,
        &mut |_, _| true,
    )
    .unwrap();
    let copy = root.join("copy");
    assert!(copy.join("app/main.rs").exists());
    assert!(!copy.join(".ssh").exists());
    assert!(!copy.join("app/.env").exists());
    assert!(outcome
        .skipped
        .iter()
        .any(|(path, _)| path.ends_with(".ssh")));
    #[cfg(unix)]
    {
        assert!(fs::symlink_metadata(copy.join("app/inside")).is_ok());
        assert!(fs::symlink_metadata(copy.join("app/outside")).is_err());
        assert!(fs::symlink_metadata(copy.join("app/escape")).is_err());
    }

    let _turn = grant_lock();
    allow_disk();
    let agent = copy_tree_checked(
        &project,
        &root,
        OsStr::new("agent-copy"),
        WalkFor::Agent,
        &mut |_, _| true,
    );
    revoke_disk();
    let agent = agent.unwrap();
    assert!(root.join("agent-copy/app/main.rs").exists());
    assert!(!root.join("agent-copy/.ssh/id_ed25519").exists());
    assert!(!root.join("agent-copy/app/.env").exists());
    assert!(!agent.skipped.is_empty());
}

#[test]
fn copying_a_tree_leaves_keychains_behind() {
    let library = home().join("Library");
    fs::create_dir_all(library.join("Keychains")).unwrap();
    fs::write(library.join("Keychains/login.keychain-db"), b"keys").unwrap();
    fs::write(library.join("notes.txt"), b"notes").unwrap();
    let (_directory, root) = scratch();
    let outcome = copy_tree_checked(
        &library,
        &root,
        OsStr::new("Library"),
        WalkFor::Person,
        &mut |_, _| true,
    );
    if cfg!(target_os = "macos") {
        let outcome = outcome.unwrap();
        assert!(root.join("Library/notes.txt").exists());
        assert!(!root.join("Library/Keychains").exists());
        assert!(outcome
            .skipped
            .iter()
            .any(|(path, _)| path.ends_with("Keychains")));
    }
}

#[test]
fn removing_a_tree_that_holds_a_closed_place_is_refused() {
    let library = home().join("Library");
    fs::create_dir_all(library.join("Keychains")).unwrap();
    fs::write(library.join("Keychains/login.keychain-db"), b"keys").unwrap();
    if cfg!(target_os = "macos") {
        let error = remove_tree_checked(&library, WalkFor::Person, &mut |_| true).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::PermissionDenied);
        assert!(library.join("Keychains/login.keychain-db").exists());
    }
    let misty = crate::paths::misty_root_dir().expect("misty root");
    fs::create_dir_all(&misty).unwrap();
    assert!(remove_tree_checked(&home(), WalkFor::Person, &mut |_| true).is_err());
    assert!(misty.exists());
}

#[test]
fn removing_and_sizing_a_plain_tree_works() {
    let (_directory, root) = scratch();
    let tree = root.join("tree");
    fs::create_dir_all(tree.join("a/b")).unwrap();
    fs::write(tree.join("a/one"), b"12345").unwrap();
    fs::write(tree.join("a/b/two"), b"123").unwrap();
    let (bytes, items) = tree_size_checked(&tree, WalkFor::Person, &|| false).unwrap();
    assert_eq!(bytes, 8);
    assert_eq!(items, 5);
    let mut removed = 0;
    remove_tree_checked(&tree, WalkFor::Person, &mut |_| {
        removed += 1;
        true
    })
    .unwrap();
    assert!(!tree.exists());
    assert_eq!(removed, 5);
}
