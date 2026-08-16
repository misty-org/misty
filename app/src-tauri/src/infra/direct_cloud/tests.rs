use super::*;

#[test]
fn onedrive_paths_escape_each_segment() {
    assert_eq!(
        onedrive_item_url("Reports & Plans/Q3 #1.txt"),
        "https://graph.microsoft.com/v1.0/me/drive/root:/Reports%20%26%20Plans/Q3%20%231%2Etxt"
    );
}

#[test]
fn windows_paths_are_not_remote_names() {
    assert!(is_windows_absolute_path(r"C:\Users\Misty\Backup"));
}

#[test]
fn persisted_connections_exclude_session_tokens() {
    let root = std::env::temp_dir().join(format!("misty-cloud-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let path = root.join("connections.json");
    let mut config = RemoteConfig::new();
    config.insert("type".to_owned(), Value::String("drive".to_owned()));
    config.insert(
        "access_token".to_owned(),
        Value::String("temporary".to_owned()),
    );
    config.insert(
        "misty_connection_id".to_owned(),
        Value::String("cloud_123".to_owned()),
    );
    config.insert(
        "misty_connection_source".to_owned(),
        Value::String("connected_account".to_owned()),
    );
    config.insert(
        "misty_connected_account_id".to_owned(),
        Value::String("connection_123".to_owned()),
    );
    persist_connections(&path, &HashMap::from([("work".to_owned(), config)])).unwrap();
    let persisted = read_connections(&path).unwrap();
    assert!(persisted["work"].get("access_token").is_none());
    for (key, value) in [
        ("misty_connection_id", "cloud_123"),
        ("misty_connection_source", "connected_account"),
        ("misty_connected_account_id", "connection_123"),
    ] {
        assert_eq!(persisted["work"][key], Value::String(value.to_owned()));
    }
    let _ = fs::remove_dir_all(root);
}

#[test]
fn token_envelope_is_read_when_access_token_is_absent() {
    let config = json!({
        "type": "drive",
        "token": "{\"access_token\":\"leased-token\"}"
    })
    .as_object()
    .cloned()
    .expect("remote config");

    assert_eq!(access_token(&config).as_deref(), Some("leased-token"));
}
