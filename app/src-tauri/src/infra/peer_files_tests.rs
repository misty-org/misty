use super::*;

#[test]
fn virtual_paths_round_trip_and_reject_traversal() {
    let path = PeerVirtualPath::format("device_123", "root_123", Path::new("Photos/My File.png"))
        .expect("format");
    let parsed = PeerVirtualPath::parse(&path).expect("parse");
    assert_eq!(parsed.device_id, "device_123");
    assert_eq!(parsed.relative_path, PathBuf::from("Photos/My File.png"));
    assert!(PeerVirtualPath::parse("misty://device/device_123/root_123/%2E%2E/secret").is_err());
    assert!(PeerVirtualPath::parse("misty://device/device_123/root_123/%2Fetc/passwd").is_err());
}

#[test]
fn roots_confine_symlinks_and_ranges() {
    let root = tempfile::tempdir().expect("root");
    let outside = tempfile::tempdir().expect("outside");
    fs::write(root.path().join("hello.txt"), b"hello world").expect("write");
    fs::write(outside.path().join("secret.txt"), b"secret").expect("write outside");
    #[cfg(unix)]
    std::os::unix::fs::symlink(
        outside.path().join("secret.txt"),
        root.path().join("escape.txt"),
    )
    .expect("symlink");

    let registry = PeerRootRegistry::from_candidates(vec![(
        "Test".to_owned(),
        root.path().to_owned(),
        PeerRootKind::System,
    )]);
    let root_id = registry.roots()[0].id.clone();
    let opened = registry
        .open_file(&root_id, Path::new("hello.txt"), None)
        .expect("open");
    assert_eq!(opened.read_range(6, Some(5)).expect("range"), b"world");
    let opened = registry
        .open_file(&root_id, Path::new("hello.txt"), None)
        .expect("open");
    assert!(opened.range_length(12, None).is_err());
    #[cfg(unix)]
    assert!(registry
        .open_file(&root_id, Path::new("escape.txt"), None)
        .is_err());
}

#[test]
fn source_snapshot_prevents_mixed_resume() {
    let root = tempfile::tempdir().expect("root");
    let file_path = root.path().join("changing.txt");
    fs::write(&file_path, b"first").expect("write");
    let registry = PeerRootRegistry::from_candidates(vec![(
        "Test".to_owned(),
        root.path().to_owned(),
        PeerRootKind::System,
    )]);
    let root_id = registry.roots()[0].id.clone();
    let first = registry
        .open_file(&root_id, Path::new("changing.txt"), None)
        .expect("first");
    let snapshot = first.snapshot;
    fs::write(&file_path, b"second version").expect("replace");
    assert!(registry
        .open_file(&root_id, Path::new("changing.txt"), Some(&snapshot))
        .is_err());
}
