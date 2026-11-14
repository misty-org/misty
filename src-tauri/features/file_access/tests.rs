// Most of these paths are Unix paths, so the Windows build uses fewer of the imports.
#![cfg_attr(windows, allow(unused_imports))]
use std::{fs as std_fs, io::ErrorKind, path::PathBuf};

use super::fs;
use super::{policy::Policy, policy::Shape, Access, Reach};

/// A policy with `.misty` under a scratch folder as its only rule. The process-wide policy allows
/// the whole temp folder in tests, for fixtures, so refusals are tested on this one.
fn scratch() -> (tempfile::TempDir, PathBuf, Policy) {
    let directory = tempfile::tempdir().unwrap();
    let root = std_fs::canonicalize(directory.path()).unwrap();
    let misty = root.join(".misty");
    std_fs::create_dir_all(&misty).unwrap();
    let mut policy = Policy::default();
    policy.add(Reach::MistyHome, &misty, Shape::Folder, Access::Write);
    (directory, root, policy)
}

#[test]
fn allows_misty_home_for_reading_and_writing() {
    let (_directory, root, policy) = scratch();
    let file = root.join(".misty/store.db");
    assert!(policy.allows_path(&file, Access::Read));
    assert!(policy.allows_path(&file, Access::Write));
    assert!(policy.allows_path(&root.join(".misty/new/deep/file"), Access::Write));
}

#[test]
fn refuses_a_path_outside() {
    let (_directory, root, policy) = scratch();
    std_fs::write(root.join("private"), "x").unwrap();
    assert!(!policy.allows_path(&root.join("private"), Access::Read));
    assert!(!policy.allows_path(&root, Access::Read));
}

#[test]
fn refuses_dot_dot_escapes() {
    let (_directory, root, policy) = scratch();
    std_fs::write(root.join("private"), "x").unwrap();
    assert!(!policy.allows_path(&root.join(".misty/../private"), Access::Read));
    assert!(!policy.allows_path(&root.join(".misty/missing/../../private"), Access::Write));
    assert!(!policy.allows_path(&root.join(".misty/a/b/../../../new"), Access::Write));
    assert!(policy.allows_path(&root.join(".misty/a/../stays-inside"), Access::Write));
}

#[test]
fn refuses_a_sibling_starting_with_an_allowed_name() {
    let (_directory, root, policy) = scratch();
    std_fs::create_dir_all(root.join(".misty-evil")).unwrap();
    assert!(!policy.allows_path(&root.join(".misty-evil"), Access::Read));
    assert!(!policy.allows_path(&root.join(".misty-evil/file"), Access::Write));
}

#[cfg(unix)]
#[test]
fn refuses_links_pointing_outside() {
    use std::os::unix::fs::symlink;
    let (_directory, root, policy) = scratch();
    let misty = root.join(".misty");
    std_fs::create_dir_all(root.join("outside")).unwrap();
    std_fs::write(root.join("outside/secret"), "x").unwrap();
    symlink(root.join("outside/secret"), misty.join("to-file")).unwrap();
    symlink(root.join("outside"), misty.join("to-folder")).unwrap();
    symlink(root.join("outside/not-yet"), misty.join("dangling")).unwrap();
    symlink("../outside/not-yet", misty.join("dangling-relative")).unwrap();
    symlink(misty.join("loop-b"), misty.join("loop-a")).unwrap();
    symlink(misty.join("loop-a"), misty.join("loop-b")).unwrap();
    for path in ["to-file", "to-folder/secret", "to-folder/new", "dangling"] {
        assert!(
            !policy.allows_path(&misty.join(path), Access::Write),
            "{path}"
        );
        assert!(
            !policy.allows_path(&misty.join(path), Access::Read),
            "{path}"
        );
    }
    assert!(!policy.allows_path(&misty.join("dangling-relative"), Access::Write));
    assert!(!policy.allows_path(&misty.join("loop-a"), Access::Write));
}

#[test]
fn allows_a_folder_only_after_its_grant_and_only_for_its_access() {
    let (_directory, root, mut policy) = scratch();
    let folder = root.join("Papers");
    std_fs::create_dir_all(&folder).unwrap();
    let file = folder.join("notes.txt");
    assert!(!policy.allows_path(&file, Access::Read));
    policy.add(Reach::SharedFolder, &folder, Shape::Folder, Access::Read);
    assert!(policy.allows_path(&file, Access::Read));
    assert!(!policy.allows_path(&file, Access::Write));
    policy.add(Reach::SharedFolder, &folder, Shape::Folder, Access::Write);
    assert!(policy.allows_path(&file, Access::Write));
    policy.add(Reach::SharedFolder, &folder, Shape::Folder, Access::Read);
    assert!(!policy.allows_path(&file, Access::Write));
}

#[test]
fn revoking_takes_the_access_away() {
    let (_directory, root, mut policy) = scratch();
    let folder = root.join("Downloads");
    std_fs::create_dir_all(&folder).unwrap();
    policy.add(
        Reach::DownloadsFolder,
        &folder,
        Shape::Folder,
        Access::Write,
    );
    assert!(policy.allows_path(&folder.join("a.zip"), Access::Write));
    policy.remove_all(Reach::DownloadsFolder);
    assert!(!policy.allows_path(&folder.join("a.zip"), Access::Write));
    assert!(!policy.allows_path(&folder.join("a.zip"), Access::Read));
    policy.add(Reach::SharedFolder, &folder, Shape::Folder, Access::Read);
    policy.remove(Reach::SharedFolder, &folder);
    assert!(!policy.allows_path(&folder, Access::Read));
}

#[test]
fn a_picked_file_grants_that_file_alone() {
    let (_directory, root, mut policy) = scratch();
    let file = root.join("page.html");
    policy.add(Reach::PickedFile, &file, Shape::Exact, Access::Write);
    assert!(policy.allows_path(&file, Access::Write));
    assert!(!policy.allows_path(&root.join("page.html.bak"), Access::Write));
    assert!(!policy.allows_path(&file.join("child"), Access::Write));
    assert!(!policy.allows_path(&root, Access::Read));
}

#[test]
fn names_starting_covers_only_those_entries() {
    let (_directory, root, mut policy) = scratch();
    policy.add(
        Reach::OwnTemp,
        &root,
        Shape::NamesStarting("misty-"),
        Access::Write,
    );
    assert!(policy.allows_path(&root.join("misty-document-1/input.pdf"), Access::Write));
    assert!(!policy.allows_path(&root.join("other/misty-1"), Access::Write));
    assert!(!policy.allows_path(&root, Access::Write));
}

// The process-wide gate, on a path outside the temp folder every test may use.
#[cfg(unix)]
#[test]
fn the_wrappers_refuse_with_permission_denied() {
    let outside = PathBuf::from("/etc/hosts");
    assert_eq!(
        fs::read(&outside).unwrap_err().kind(),
        ErrorKind::PermissionDenied
    );
    assert_eq!(
        fs::File::open(&outside).unwrap_err().kind(),
        ErrorKind::PermissionDenied
    );
    assert_eq!(
        fs::OpenOptions::new()
            .read(true)
            .open(&outside)
            .unwrap_err()
            .kind(),
        ErrorKind::PermissionDenied
    );
    assert_eq!(
        fs::read_dir("/etc").unwrap_err().kind(),
        ErrorKind::PermissionDenied
    );
    assert_eq!(
        fs::copy(&outside, std::env::temp_dir().join("misty-copy"))
            .unwrap_err()
            .kind(),
        ErrorKind::PermissionDenied
    );
    assert_eq!(
        fs::write("/etc/misty-gate-test", b"x").unwrap_err().kind(),
        ErrorKind::PermissionDenied
    );
    assert!(!fs::exists(&outside));
    assert!(fs::open_sqlite("/etc/misty-gate-test.db").is_err());
}

#[cfg(unix)]
#[test]
fn a_link_in_misty_home_reads_nothing_outside_but_can_be_removed() {
    let home = crate::paths::misty_home_dir().unwrap();
    std_fs::create_dir_all(&home).unwrap();
    let link = home.join("gate-test-link");
    let _ = std_fs::remove_file(&link);
    std::os::unix::fs::symlink("/etc/hosts", &link).unwrap();
    assert_eq!(
        fs::read(&link).unwrap_err().kind(),
        ErrorKind::PermissionDenied
    );
    assert_eq!(
        fs::write(&link, b"x").unwrap_err().kind(),
        ErrorKind::PermissionDenied
    );
    assert!(fs::symlink_metadata(&link)
        .unwrap()
        .file_type()
        .is_symlink());
    fs::remove_file(&link).unwrap();
}

#[test]
fn the_wrappers_work_inside() {
    let home = crate::paths::misty_home_dir().unwrap();
    let folder = home.join("gate-test");
    fs::create_dir_all(&folder).unwrap();
    let file = folder.join("file");
    fs::write(&file, b"contents").unwrap();
    assert_eq!(fs::read_to_string(&file).unwrap(), "contents");
    assert!(fs::is_file(&file));
    assert!(fs::is_dir(&folder));
    fs::remove_dir_all(&folder).unwrap();
    assert!(!fs::exists(&file));
}

const GRANTS: &str = include_str!("../../tauri-permissions/grants/grants.toml");

/// The grant behind each place Misty can reach. It's an exhaustive match, so a new place has to say
/// here whether it's one.
fn grants_for(reach: Reach) -> &'static [&'static str] {
    match reach {
        Reach::DownloadsFolder => &["grant-downloads"],
        Reach::SharedFolder => &["grant-shared-folder", "grant-shared-folder-write"],
        Reach::LinkedFolder => &["grant-linked-folder"],
        Reach::PickedFile => &["grant-picked-file"],
        Reach::MistyHome
        | Reach::AppFolders
        | Reach::OwnTemp
        | Reach::AutostartEntry
        | Reach::HostnameFile
        | Reach::RecordedDownload
        | Reach::BenchmarkKeys
        | Reach::EngineConfig
        | Reach::BundledResources
        | Reach::WebsiteData
        | Reach::TestFixtures => &[],
    }
}

#[test]
fn the_list_matches_grants_toml() {
    let declared: std::collections::BTreeSet<&str> = GRANTS
        .lines()
        .filter_map(|line| line.strip_prefix("identifier = \""))
        .map(|name| name.trim_end_matches('"'))
        .collect();
    let listed: std::collections::BTreeSet<&str> = [
        Reach::MistyHome,
        Reach::AppFolders,
        Reach::OwnTemp,
        Reach::AutostartEntry,
        Reach::HostnameFile,
        Reach::DownloadsFolder,
        Reach::RecordedDownload,
        Reach::SharedFolder,
        Reach::LinkedFolder,
        Reach::PickedFile,
        Reach::EngineConfig,
        Reach::BenchmarkKeys,
        Reach::TestFixtures,
    ]
    .into_iter()
    .flat_map(|reach| grants_for(reach).iter().copied())
    .collect();
    assert_eq!(listed, declared);
}
