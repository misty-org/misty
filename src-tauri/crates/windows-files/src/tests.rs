use super::*;

#[test]
fn names_are_single_components() {
    for bad in ["", ".", "..", "a\\b", "a/b", "file.txt:secret", "C:"] {
        assert!(component(OsStr::new(bad)).is_err(), "{bad}");
    }
    assert!(component(OsStr::new("ok.txt")).is_ok());
}

#[test]
fn renames_never_overwrite_unless_asked() {
    let folder = tempfile::tempdir().unwrap();
    std::fs::write(folder.path().join("a.txt"), "a").unwrap();
    std::fs::write(folder.path().join("b.txt"), "b").unwrap();
    let dir = open_folder(folder.path()).unwrap();
    let a = open_entry(&dir, OsStr::new("a.txt"), DELETE_ACCESS).unwrap();
    assert!(rename(&a, &dir, OsStr::new("b.txt"), false).is_err());
    assert_eq!(
        std::fs::read_to_string(folder.path().join("b.txt")).unwrap(),
        "b"
    );
    rename(&a, &dir, OsStr::new("c.txt"), false).unwrap();
    assert!(folder.path().join("c.txt").exists());
    rename(&a, &dir, OsStr::new("b.txt"), true).unwrap();
    assert_eq!(
        std::fs::read_to_string(folder.path().join("b.txt")).unwrap(),
        "a"
    );
}

#[test]
fn folders_are_made_listed_and_removed() {
    let folder = tempfile::tempdir().unwrap();
    let dir = open_folder(folder.path()).unwrap();
    let made = open(
        &dir,
        OsStr::new("made"),
        FOLDER_ACCESS | DELETE_ACCESS,
        Disposition::New,
        Expect::Folder,
    )
    .unwrap();
    assert!(open(
        &dir,
        OsStr::new("made"),
        FOLDER_ACCESS,
        Disposition::New,
        Expect::Folder
    )
    .is_err());
    assert_eq!(list_names(&dir).unwrap(), vec![OsString::from("made")]);
    assert_eq!(
        kind_at(&dir, OsStr::new("made")).unwrap(),
        Some(Kind::Folder)
    );
    delete(&made).unwrap();
    drop(made);
    assert_eq!(kind_at(&dir, OsStr::new("made")).unwrap(), None);
}
