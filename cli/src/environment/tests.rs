use super::*;

fn fixture_workspace(path: &Path) -> Workspace {
    Workspace {
        root: path.into(),
        misty: path.into(),
        server: path.join("server"),
        cli: path.join("cli"),
        website: path.join("website"),
        features: path.join("src/features"),
    }
}

#[test]
fn cli_loader_enforces_ownership() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace = fixture_workspace(tmp.path());
    let path = workspace.cli.join(".env/common.env");
    write_private(&path, b"MISTY_DEV_SIGNING_IDENTITY=fixture\n").unwrap();
    let values = read_selected_cli_files(&workspace, &["common.env"]).unwrap();
    assert_eq!(values["MISTY_DEV_SIGNING_IDENTITY"], "fixture");
    write_private(&path, b"APPLE_SIGNING_IDENTITY=fixture\n").unwrap();
    assert!(read_selected_cli_files(&workspace, &["common.env"]).is_err());
    write_private(&path, b"MISTY_UNKNOWN_SETTING=fixture\n").unwrap();
    assert!(read_selected_cli_files(&workspace, &["common.env"]).is_err());
    write_private(
        &path,
        b"MISTY_DEV_SIGNING_IDENTITY=one\nMISTY_DEV_SIGNING_IDENTITY=two\n",
    )
    .unwrap();
    assert!(read_selected_cli_files(&workspace, &["common.env"]).is_err());
}

#[test]
fn invalid_private_values_do_not_appear_in_errors() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace = fixture_workspace(tmp.path());
    for (path, cli) in [
        (root(&workspace).join("runtime.env"), false),
        (workspace.cli.join(".env/common.env"), true),
    ] {
        write_private(&path, b"INVALID KEY=private-fixture-token\n").unwrap();
        let result = if cli {
            read_cli_files(&workspace)
        } else {
            read(&workspace)
        };
        let error = format!("{:#}", result.unwrap_err());
        assert!(!error.contains("private-fixture-token"));
    }
}

#[test]
fn set_replaces_export_assignments_without_creating_duplicates() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace = fixture_workspace(tmp.path());
    let path = root(&workspace).join("runtime.env");
    write_private(&path, b"export MISTY_INSTANCE_NAME=old\n").unwrap();
    set(&workspace, "MISTY_INSTANCE_NAME", "new-$literal").unwrap();
    assert_eq!(
        read(&workspace).unwrap()["MISTY_INSTANCE_NAME"],
        "new-$literal"
    );
}

#[test]
fn development_generation_preserves_keys_and_detects_api_overrides() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace = fixture_workspace(tmp.path());
    init(&workspace).unwrap();
    crate::server::initialize_development_secrets(&workspace).unwrap();
    let path = root(&workspace).join("crypto/journal.env");
    let original = fs::read(&path).unwrap();
    assert!(crate::server::generate_worker_secrets(&workspace).is_err());
    assert_eq!(fs::read(path).unwrap(), original);
    crate::server::validate_development_secrets(&workspace).unwrap();
    set(&workspace, "JOURNAL_COLLAB_TICKET_PUBLIC_KEY", "different").unwrap();
    assert!(crate::server::validate_development_secrets(&workspace).is_err());
}

#[test]
fn every_name_has_one_owner() {
    let owners = ownership().unwrap();
    assert!(owners.len() > 50);
    assert_eq!(owners["JOURNAL_COLLAB_ROOM_SALT"], "crypto/journal.env");
    assert_eq!(owners["MISTY_AUTH_SIGNING_KEY"], "crypto/services.env");
    assert_eq!(
        owners["MISTY_AUTH_SIGNING_KEY_PREVIOUS"],
        "crypto/services.env"
    );
}

#[test]
fn a_misplaced_key_is_refused_without_showing_it() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace = fixture_workspace(tmp.path());
    let base = root(&workspace);
    write_private(
        &base.join("crypto/spaces.env"),
        b"SPACE_LINK_ENCRYPTION_KEY=private-fixture-key\n",
    )
    .unwrap();
    assert_eq!(
        read(&workspace).unwrap()["SPACE_LINK_ENCRYPTION_KEY"],
        "private-fixture-key"
    );
    write_private(
        &base.join("google.env"),
        b"SPACE_LINK_ENCRYPTION_KEY=private-misplaced-key\n",
    )
    .unwrap();
    let error = read(&workspace).unwrap_err().to_string();
    assert!(error.contains("belongs in"));
    assert!(!error.contains("private-misplaced-key"));
}

#[test]
fn a_deployed_servers_files_can_sit_alongside_and_arent_read() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace = fixture_workspace(tmp.path());
    let base = root(&workspace);
    write_private(
        &base.join("misty.env"),
        b"MISTY_HOSTNAME=misty.example.test\n",
    )
    .unwrap();
    write_private(
        &base.join("mailjet.env"),
        b"MAILJET_API_KEY=private-fixture-key\n",
    )
    .unwrap();
    let values = read(&workspace).unwrap();
    assert!(!values.contains_key("MISTY_HOSTNAME"));
    assert!(!values.contains_key("MAILJET_API_KEY"));
}

#[test]
fn an_unknown_file_is_still_refused() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace = fixture_workspace(tmp.path());
    write_private(&root(&workspace).join("stray.env"), b"NOT_A_SETTING=1\n").unwrap();
    assert!(read(&workspace)
        .unwrap_err()
        .to_string()
        .contains("unknown environment file"));
}

#[test]
#[cfg(unix)]
fn keys_require_private_files() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = tempfile::tempdir().unwrap();
    let workspace = fixture_workspace(tmp.path());
    let path = root(&workspace).join("crypto/spaces.env");
    write_private(&path, b"SPACE_LINK_ENCRYPTION_KEY=private-fixture-key\n").unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    let error = read(&workspace).unwrap_err().to_string();
    assert!(error.contains("must not be accessible"));
    assert!(!error.contains("private-fixture-key"));
}

#[test]
fn optional_files_are_created_only_when_configured() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace = Workspace {
        root: tmp.path().to_path_buf(),
        misty: tmp.path().to_path_buf(),
        server: tmp.path().join("server"),
        cli: tmp.path().join("cli"),
        website: tmp.path().join("website"),
        features: tmp.path().join("src/features"),
    };
    init(&workspace).unwrap();
    assert!(!workspace.cli.join(".env").exists());
    assert!(read_cli_files(&workspace).unwrap().is_empty());
    let integration = root(&workspace).join("google.env");
    assert!(!integration.exists());
    let before = read(&workspace).unwrap();
    assert!(!before.contains_key("GOOGLE_SIGN_IN_REDIRECT_URL"));
    set(&workspace, "GOOGLE_SIGN_IN_REDIRECT_URL", "fixture").unwrap();
    assert_eq!(
        read(&workspace).unwrap()["GOOGLE_SIGN_IN_REDIRECT_URL"],
        "fixture"
    );
    fs::remove_file(integration).unwrap();
    init(&workspace).unwrap();
    assert_eq!(read(&workspace).unwrap(), before);
    let error = validate(&workspace).unwrap_err().to_string();
    assert!(error.contains("missing required values"));
    assert!(error.contains("CLOUDFLARE_API_TOKEN"));
}

#[test]
fn setup_is_idempotent_and_setting_values_stay_private() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace = Workspace {
        root: tmp.path().to_path_buf(),
        misty: tmp.path().to_path_buf(),
        server: tmp.path().join("server"),
        cli: tmp.path().join("cli"),
        website: tmp.path().join("website"),
        features: tmp.path().join("src/features"),
    };
    init(&workspace).unwrap();
    crate::server::initialize_development_secrets(&workspace).unwrap();
    crate::server::validate_development_secrets(&workspace).unwrap();
    let first = read(&workspace).unwrap();
    crate::server::initialize_development_secrets(&workspace).unwrap();
    assert_eq!(
        read(&workspace).unwrap(),
        first,
        "repeating setup must keep the same Worker keys"
    );

    set(&workspace, "MISTY_INSTANCE_NAME", "test-$literal-secret").unwrap();
    init(&workspace).unwrap();
    crate::server::initialize_development_secrets(&workspace).unwrap();
    let second = read(&workspace).unwrap();
    assert_eq!(second["MISTY_INSTANCE_NAME"], "test-$literal-secret");
    for (name, value) in first {
        assert_eq!(second[&name], value, "{name} changed on rerun");
    }
    assert!(set(&workspace, "UNKNOWN", "x").is_err());
    assert!(set(&workspace, "MISTY_INSTANCE_NAME", "x\nINJECTED=bad").is_err());
    assert!(validate(&workspace).is_err());
    for (key, val) in [
        ("CLOUDFLARE_API_TOKEN", "fixture"),
        ("CLOUDFLARE_TUNNEL_TOKEN", "fixture"),
        ("CLOUDFLARE_ACCOUNT_ID", "0123456789abcdef0123456789abcdef"),
        ("MISTY_CLOUDFLARE_WORKER_HOST", "fixture.workers.dev"),
        ("MISTY_DEV_API_ORIGIN", "https://api.example.com"),
        ("MISTY_DEV_API_TUNNEL_HOSTNAME", "api.example.com"),
    ] {
        set(&workspace, key, val).unwrap();
    }
    validate(&workspace).unwrap();
    set(
        &workspace,
        "MISTY_DEV_API_ORIGIN",
        "https://api.example.com/v1",
    )
    .unwrap();
    assert!(validate(&workspace).is_err());
}
