use std::{ffi::OsStr, fs, io::Read, path::Path};

use super::*;

/// A link to a folder: a symlink on unix, a junction on Windows (which
/// needs no privilege, unlike a Windows symlink).
fn link_folder(target: &Path, link: &Path) {
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, link).unwrap();
    #[cfg(windows)]
    {
        // mklink reads a forward slash as the start of a switch.
        let native = |path: &Path| path.to_string_lossy().replace('/', r"\");
        let made = std::process::Command::new("cmd")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(native(link))
            .arg(native(target))
            .output()
            .unwrap();
        assert!(made.status.success(), "{made:?}");
    }
}

fn setup() -> (tempfile::TempDir, tempfile::TempDir, std::fs::File) {
    let project = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("secret.txt"), "outside").unwrap();
    let root = open_root(project.path()).unwrap();
    (project, outside, root)
}

#[test]
fn files_are_written_read_and_listed_inside_the_project() {
    let (project, _outside, root) = setup();
    assert!(write_file(&root, Path::new("src/app/main.txt"), b"hello").unwrap());
    assert!(!write_file(&root, Path::new("src/app/main.txt"), b"hello again").unwrap());
    let mut text = String::new();
    open_file(&root, Path::new("src/app/main.txt"))
        .unwrap()
        .read_to_string(&mut text)
        .unwrap();
    assert_eq!(text, "hello again");
    let src = open_dir(&root, Path::new("src")).unwrap();
    assert_eq!(list_names(&src).unwrap(), vec![std::ffi::OsString::from("app")]);
    assert!(matches!(entry(&src, OsStr::new("app")).unwrap(), Entry::Directory));
    assert!(matches!(entry(&src, OsStr::new("gone")).unwrap(), Entry::Missing));
    // No temporary file is left behind.
    let app = open_dir(&root, Path::new("src/app")).unwrap();
    assert_eq!(list_names(&app).unwrap().len(), 1);
    assert!(project.path().join("src/app/main.txt").is_file());
}

#[test]
fn links_are_never_followed() {
    let (project, outside, root) = setup();
    link_folder(outside.path(), &project.path().join("link"));
    let error = open_file(&root, Path::new("link/secret.txt")).unwrap_err();
    assert!(is_link_refusal(&error), "{error:?}");
    assert!(open_dir(&root, Path::new("link")).is_err());
    assert!(write_file(&root, Path::new("link/new.txt"), b"x").is_err());
    assert!(!outside.path().join("new.txt").exists());
    let (dir, name) = open_parent(&root, Path::new("link"), false).unwrap();
    assert!(matches!(entry(&dir, name).unwrap(), Entry::Symlink));
    assert!(read_link(&root, Path::new("link")).unwrap().ends_with(
        outside.path().file_name().unwrap()
    ));
    // Writing at the link itself is refused rather than written through.
    assert!(write_file(&root, Path::new("link"), b"x").is_err());
    // Removing the link removes only the link.
    remove(&root, Path::new("link"), false).unwrap();
    assert!(outside.path().join("secret.txt").is_file());
}

#[test]
fn trees_are_removed_without_following_links() {
    let (project, outside, root) = setup();
    write_file(&root, Path::new("build/out/a.txt"), b"a").unwrap();
    link_folder(outside.path(), &project.path().join("build/out/link"));
    remove_tree(&root, Path::new("build")).unwrap();
    assert!(!project.path().join("build").exists());
    assert!(outside.path().join("secret.txt").is_file());
}

#[test]
fn single_removals_check_what_they_remove() {
    let (_project, _outside, root) = setup();
    write_file(&root, Path::new("folder/file.txt"), b"x").unwrap();
    assert!(remove(&root, Path::new("folder"), false).is_err());
    assert!(remove(&root, Path::new("folder"), true).is_err(), "not empty");
    remove(&root, Path::new("folder/file.txt"), false).unwrap();
    remove(&root, Path::new("folder"), true).unwrap();
}

#[test]
fn git_internals_are_guarded_by_identity() {
    let (project, _outside, root) = setup();
    fs::create_dir_all(project.path().join(".git/hooks")).unwrap();
    let error = open_parent(&root, Path::new(".git/hooks/pre-commit"), false).unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
}

#[test]
fn read_only_modes_round_trip() {
    let (project, _outside, root) = setup();
    write_file_mode(&root, Path::new("locked.txt"), b"x", Some(0o444)).unwrap();
    let (dir, name) = open_parent(&root, Path::new("locked.txt"), false).unwrap();
    let Entry::File { mode } = entry(&dir, name).unwrap() else {
        panic!("a file");
    };
    assert_eq!(mode & 0o222, 0);
    let metadata = fs::metadata(project.path().join("locked.txt")).unwrap();
    assert_eq!(super::mode(&metadata) & 0o222, 0);
    // Undo can still replace it, and remove it.
    write_file_mode(&root, Path::new("locked.txt"), b"y", Some(0o644)).unwrap();
    remove(&root, Path::new("locked.txt"), false).unwrap();
}

#[test]
fn paths_stay_relative_to_the_project() {
    for bad in ["../x", "a/../../b"] {
        assert!(clean_relative(bad).is_err(), "{bad}");
    }
    #[cfg(windows)]
    for bad in [r"C:\Windows", r"..\x", r"\\server\share\x", "C:x"] {
        assert!(clean_relative(bad).is_err(), "{bad}");
    }
    // A leading slash is trimmed: the path is read from the project's top.
    assert_eq!(clean_relative("/src/a.ts").unwrap(), Path::new("src/a.ts"));
    assert_eq!(clean_relative("./src/a.ts").unwrap(), Path::new("src/a.ts"));
}
