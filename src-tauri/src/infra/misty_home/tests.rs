use super::*;

fn temp(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "misty-home-{label}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn creates_a_fresh_home_with_the_current_layout() {
    let base = temp("fresh");
    let root = base.join(".misty");
    let report = ensure_at(&root, &Trash::Folder(base.join("Trash"))).unwrap();

    for relative in layout().directories {
        assert!(root.join(&relative).is_dir(), "{relative}");
    }
    assert_eq!(manifest_version(&root), layout().layout_version);
    assert!(report.retired.is_empty());
    let _ = fs::remove_dir_all(base);
}

#[test]
fn keeps_user_data_and_moves_only_retired_paths_to_trash() {
    let base = temp("upgrade");
    let root = base.join(".misty");
    let trash = base.join("Trash");
    fs::create_dir_all(root.join("plugins/public")).unwrap();
    fs::create_dir_all(root.join(".local/data")).unwrap();
    fs::create_dir_all(root.join("config")).unwrap();
    fs::write(root.join(".local/data/keep.txt"), "kept").unwrap();
    fs::write(root.join("config/settings.json"), "{}").unwrap();
    fs::write(
        root.join("home.json"),
        r#"{"format":"misty-home","layoutVersion":1}"#,
    )
    .unwrap();

    let report = ensure_at(&root, &Trash::Folder(trash.clone())).unwrap();

    assert_eq!(report.retired, vec!["plugins".to_owned()]);
    assert!(!root.join("plugins").exists());
    assert!(root.join(".local/data/keep.txt").is_file());
    assert!(root.join("config/settings.json").is_file());
    let moved = fs::read_dir(&trash)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    assert!(moved.join("plugins/public").is_dir());
    let _ = fs::remove_dir_all(base);
}

#[test]
fn is_idempotent_and_leaves_current_homes_alone() {
    let base = temp("repeat");
    let root = base.join(".misty");
    let trash = base.join("Trash");
    ensure_at(&root, &Trash::Folder(trash.clone())).unwrap();
    // A path that looks retired but appears after the upgrade is not touched.
    fs::create_dir_all(root.join("notes")).unwrap();

    let report = ensure_at(&root, &Trash::Folder(trash.clone())).unwrap();

    assert!(report.created.is_empty());
    assert!(report.retired.is_empty());
    assert!(root.join("notes").is_dir());
    assert!(!trash.exists());
    let _ = fs::remove_dir_all(base);
}

#[test]
fn recreates_folders_removed_since_the_last_launch() {
    let base = temp("recreate");
    let root = base.join(".misty");
    ensure_at(&root, &Trash::Folder(base.join("Trash"))).unwrap();
    fs::remove_dir_all(root.join("profiles")).unwrap();

    let report = ensure_at(&root, &Trash::Folder(base.join("Trash"))).unwrap();

    assert!(report.created.contains(&"profiles".to_owned()));
    assert!(root.join("profiles").is_dir());
    let _ = fs::remove_dir_all(base);
}
