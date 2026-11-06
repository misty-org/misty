use super::*;

#[test]
fn accounts_on_different_servers_have_different_scopes() {
    let a = url::Url::parse("https://a.example/v1").unwrap();
    let b = url::Url::parse("https://b.example/v1").unwrap();
    assert_ne!(
        account_scope(&a, Some("one")),
        account_scope(&b, Some("one"))
    );
    assert_ne!(
        account_scope(&a, Some("one")),
        account_scope(&a, Some("two"))
    );
    assert_eq!(account_scope(&a, None), profile_windows::LOCAL_SCOPE);
    assert_eq!(account_scope(&a, Some("")), profile_windows::LOCAL_SCOPE);
}

#[test]
fn a_database_whose_key_is_gone_is_set_aside_not_deleted() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("records.sqlite");
    std::fs::write(&path, b"sealed").unwrap();
    std::fs::write(format!("{}-wal", path.display()), b"wal").unwrap();
    set_aside(&path).unwrap();
    assert!(!path.exists());
    let kept: Vec<_> = std::fs::read_dir(directory.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(kept.len(), 2);
    assert!(kept.iter().all(|name| name.starts_with("records.lost-")));
}

#[test]
fn hashed_ids_are_stable_and_never_show_the_value() {
    let id = hashed_id("site", "https://a.example");
    assert_eq!(id, hashed_id("site", "https://a.example"));
    assert_ne!(id, hashed_id("download", "https://a.example"));
    assert!(id.starts_with("site:") && !id.contains("a.example"));
    assert_eq!(id.len(), "site:".len() + 32);
}
