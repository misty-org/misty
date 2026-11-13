// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
use super::*;

struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("misty-files-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        Self(std::fs::canonicalize(dir).unwrap())
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn copy_names_follow_finder() {
    let file = Path::new("/w/notes.txt");
    assert_eq!(
        copy_destination_name(file, false, 0).unwrap(),
        "notes copy.txt"
    );
    assert_eq!(
        copy_destination_name(file, false, 2).unwrap(),
        "notes copy 2.txt"
    );
    let dir = Path::new("/w/src.v2");
    assert_eq!(copy_destination_name(dir, true, 0).unwrap(), "src.v2 copy");
    assert_eq!(
        copy_destination_name(Path::new("/w/Makefile"), false, 0).unwrap(),
        "Makefile copy"
    );
}

#[test]
fn duplicate_picks_the_next_free_copy_name() {
    let scratch = Scratch::new();
    let file = scratch.0.join("a.txt");
    std::fs::write(&file, "x").unwrap();
    let first = duplicate(&file).unwrap();
    assert!(first.path.ends_with("a copy.txt"));
    let second = duplicate(&file).unwrap();
    assert!(second.path.ends_with("a copy 1.txt"));
    assert_eq!(std::fs::read_to_string(&second.path).unwrap(), "x");
}

#[test]
fn paste_keeps_the_name_when_free_and_copies_folders_whole() {
    let scratch = Scratch::new();
    let source = scratch.0.join("src");
    std::fs::create_dir_all(source.join("inner")).unwrap();
    std::fs::write(source.join("inner/b.rs"), "fn b() {}").unwrap();
    let target = scratch.0.join("dest");
    std::fs::create_dir_all(&target).unwrap();
    let pasted = paste(&source, &target).unwrap();
    assert!(pasted.is_dir);
    assert!(pasted.path.ends_with("dest/src"));
    assert_eq!(
        std::fs::read_to_string(target.join("src/inner/b.rs")).unwrap(),
        "fn b() {}"
    );
    let again = paste(&source, &target).unwrap();
    assert!(again.path.ends_with("src copy"));
    // Nothing staged is left behind.
    assert!(std::fs::read_dir(&target)
        .unwrap()
        .flatten()
        .all(|entry| !entry
            .file_name()
            .to_string_lossy()
            .starts_with(".misty-copying-")));
}

#[test]
fn a_folder_cannot_be_pasted_into_itself() {
    let scratch = Scratch::new();
    let source = scratch.0.join("src");
    std::fs::create_dir_all(source.join("inner")).unwrap();
    assert!(paste(&source, &source.join("inner")).is_err());
}

#[test]
fn a_failed_copy_removes_its_staged_item() {
    let scratch = Scratch::new();
    let source = scratch.0.join("a.txt");
    std::fs::write(&source, "x").unwrap();
    let failed = copy_item_into_dir_with(
        &source,
        false,
        &scratch.0,
        true,
        &mut |_| {},
        &mut |_, to| {
            std::fs::write(to, "partial").unwrap();
            Err("disk full".into())
        },
    );
    assert_eq!(failed.unwrap_err(), "disk full");
    let names: Vec<String> = std::fs::read_dir(&scratch.0)
        .unwrap()
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, ["a.txt"]);
}

#[test]
fn publishing_never_replaces_what_appeared_meanwhile() {
    let scratch = Scratch::new();
    let staged = scratch.0.join("staged");
    let taken = scratch.0.join("taken");
    std::fs::write(&staged, "new").unwrap();
    std::fs::write(&taken, "old").unwrap();
    assert!(publish_copy(&staged, &taken).is_err());
    assert_eq!(std::fs::read_to_string(&taken).unwrap(), "old");
}

#[cfg(unix)]
#[test]
fn an_unsupported_exclusive_rename_falls_back_to_check_then_rename() {
    let scratch = Scratch::new();
    let staged = scratch.0.join("staged");
    std::fs::write(&staged, "new").unwrap();
    let to = scratch.0.join("free");
    publish_copy_with(&staged, &to, |_, _| {
        Err(std::io::Error::from_raw_os_error(libc::ENOTSUP))
    })
    .unwrap();
    assert_eq!(std::fs::read_to_string(&to).unwrap(), "new");
}

#[test]
fn clipboard_paste_reports_each_failure_and_keeps_the_rest() {
    let scratch = Scratch::new();
    let good = scratch.0.join("good.txt");
    std::fs::write(&good, "g").unwrap();
    let target = scratch.0.join("dest");
    std::fs::create_dir_all(&target).unwrap();
    let outcome = copy_clipboard_items_into(
        &[
            good.to_string_lossy().into_owned(),
            scratch.0.join("missing.txt").to_string_lossy().into_owned(),
        ],
        &target,
    );
    assert_eq!(outcome.created.len(), 1);
    assert_eq!(outcome.failed.len(), 1);
    assert!(file_access::fs::exists(target.join("good.txt")));
}
