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
    fs::create_dir_all(root.join("data")).unwrap();
    fs::write(root.join("data/keep.txt"), "kept").unwrap();

    let report = ensure_at(&root, &Trash::Folder(trash.clone())).unwrap();

    assert_eq!(report.retired, vec!["plugins".to_owned()]);
    assert!(!root.join("plugins").exists());
    assert!(root.join("data/keep.txt").is_file());
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

#[test]
fn moves_data_and_sync_out_of_dot_local_with_everything_in_them() {
    let base = temp("move");
    let root = base.join(".misty");
    fs::create_dir_all(root.join(".local/data/workspace-recovery/a")).unwrap();
    fs::create_dir_all(root.join(".local/sync/a")).unwrap();
    for file in ["misty.db", "misty.db-wal", "misty.db-shm"] {
        fs::write(root.join(".local/data").join(file), file).unwrap();
    }
    fs::write(root.join(".local/sync/a/records.sqlite"), "records").unwrap();

    misty_credential_store::move_out_of_dot_local(&root).unwrap();

    for file in ["misty.db", "misty.db-wal", "misty.db-shm"] {
        assert_eq!(fs::read_to_string(root.join("data").join(file)).unwrap(), file);
    }
    assert!(root.join("data/workspace-recovery/a").is_dir());
    assert_eq!(fs::read_to_string(root.join("sync/a/records.sqlite")).unwrap(), "records");
    assert!(!root.join(".local").exists());
    let _ = fs::remove_dir_all(base);
}

#[test]
fn takes_the_place_of_an_empty_folder_but_never_one_in_use() {
    let base = temp("move-conflict");
    let root = base.join(".misty");
    fs::create_dir_all(root.join(".local/data")).unwrap();
    fs::create_dir_all(root.join(".local/sync")).unwrap();
    fs::write(root.join(".local/data/misty.db"), "old").unwrap();
    fs::write(root.join(".local/sync/records"), "old").unwrap();
    fs::create_dir_all(root.join("data")).unwrap();
    fs::write(root.join("data/misty.db"), "new").unwrap();
    fs::create_dir_all(root.join("sync")).unwrap();

    misty_credential_store::move_out_of_dot_local(&root).unwrap();

    assert_eq!(fs::read_to_string(root.join("data/misty.db")).unwrap(), "new");
    assert_eq!(fs::read_to_string(root.join(".local/data/misty.db")).unwrap(), "old");
    assert_eq!(fs::read_to_string(root.join("sync/records")).unwrap(), "old");
    let _ = fs::remove_dir_all(base);
}

#[test]
fn an_upgrade_never_trashes_data_still_in_dot_local() {
    let base = temp("move-kept");
    let root = base.join(".misty");
    let trash = base.join("Trash");
    fs::create_dir_all(root.join(".local/bin")).unwrap();
    fs::create_dir_all(root.join(".local/data")).unwrap();
    fs::write(root.join(".local/data/misty.db"), "old").unwrap();

    ensure_at(&root, &Trash::Folder(trash)).unwrap();

    assert!(!root.join(".local/bin").exists());
    assert_eq!(fs::read_to_string(root.join(".local/data/misty.db")).unwrap(), "old");
    let _ = fs::remove_dir_all(base);
}

#[test]
fn removes_dot_local_once_retiring_leaves_it_empty() {
    let base = temp("move-empty");
    let root = base.join(".misty");
    fs::create_dir_all(root.join(".local/bin")).unwrap();

    ensure_at(&root, &Trash::Folder(base.join("Trash"))).unwrap();

    assert!(!root.join(".local").exists());
    let _ = fs::remove_dir_all(base);
}
