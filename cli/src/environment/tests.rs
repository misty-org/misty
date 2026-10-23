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
        (
            root(&workspace, Target::Dev).join("integrations/ai.env"),
            false,
        ),
        (workspace.cli.join(".env/common.env"), true),
    ] {
        write_private(&path, b"INVALID KEY=private-fixture-token\n").unwrap();
        let result = if cli {
            read_cli_files(&workspace)
        } else {
            read(&workspace, Target::Dev)
        };
        let error = format!("{:#}", result.unwrap_err());
        assert!(!error.contains("private-fixture-token"));
    }
}

#[test]
fn set_replaces_export_assignments_without_creating_duplicates() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace = fixture_workspace(tmp.path());
    let path = root(&workspace, Target::Dev).join("integrations/ai.env");
    write_private(&path, b"export AI_GATEWAY_API_KEY=old\n").unwrap();
    set(
        &workspace,
        Target::Dev,
        "AI_GATEWAY_API_KEY",
        "new-$literal",
    )
    .unwrap();
    assert_eq!(
        read(&workspace, Target::Dev).unwrap()["AI_GATEWAY_API_KEY"],
        "new-$literal"
    );
}

#[test]
fn fresh_production_keys_need_no_placeholder_files_and_are_preserved() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace = fixture_workspace(tmp.path());
    init(&workspace, Target::Prod).unwrap();
    crate::server::generate_production_worker_secrets(&workspace).unwrap();
    let first = read(&workspace, Target::Prod).unwrap();
    assert!(first.contains_key("JOURNAL_COLLAB_ROOM_SALT"));
    assert!(first.contains_key("JOURNAL_COLLAB_TICKET_PRIVATE_KEY"));
    assert!(crate::server::generate_production_worker_secrets(&workspace).is_err());
    assert_eq!(first, read(&workspace, Target::Prod).unwrap());
}

#[test]
fn development_generation_preserves_keys_and_detects_api_overrides() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace = fixture_workspace(tmp.path());
    init(&workspace, Target::Dev).unwrap();
    crate::server::initialize_development_secrets(&workspace).unwrap();
    let path = workspace
        .server
        .join("apps/journal-collab/.secrets/server.env");
    let original = fs::read(&path).unwrap();
    assert!(crate::server::generate_worker_secrets(&workspace).is_err());
    assert_eq!(fs::read(path).unwrap(), original);
    crate::server::validate_development_secrets(&workspace).unwrap();
    set(
        &workspace,
        Target::Dev,
        "JOURNAL_COLLAB_CONTROL_SECRET",
        "different",
    )
    .unwrap();
    assert!(crate::server::validate_development_secrets(&workspace).is_err());
}

#[test]
fn every_name_has_one_owner() {
    let owners = ownership().unwrap();
    assert!(owners.len() > 80);
    assert_eq!(owners["COMPOSIO_API_KEY"], "composio.env");
    assert_eq!(
        owners["MISTY_COMPOSIO_API_KEY"],
        "integrations/composio.env"
    );

    assert_eq!(owners["JOURNAL_COLLAB_ROOM_SALT"], "crypto/journal.env");
    assert_eq!(owners["MISTY_AUTH_SIGNING_KEY"], "crypto/services.env");
    assert_eq!(
        owners["MISTY_AUTH_SIGNING_KEY_PREVIOUS"],
        "crypto/services.env"
    );
}

#[test]
fn composio_scoped_files_load_without_exposing_or_relocating_keys() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace = fixture_workspace(tmp.path());
    for target in [Target::Dev, Target::Prod] {
        let base = root(&workspace, target);
        write_private(
            &base.join("composio.env"),
            b"COMPOSIO_API_KEY=private-fixture-key\n",
        )
        .unwrap();
        write_private(
            &base.join("integrations/composio.env"),
            b"MISTY_COMPOSIO_DEPLOYMENT=cloud\n",
        )
        .unwrap();
        let values = read(&workspace, target).unwrap();
        assert_eq!(values["COMPOSIO_API_KEY"], "private-fixture-key");
        assert_eq!(values["MISTY_COMPOSIO_DEPLOYMENT"], "cloud");
        set(
            &workspace,
            target,
            "MISTY_COMPOSIO_API_KEY",
            "private-instance-key",
        )
        .unwrap();
        assert_eq!(
            read(&workspace, target).unwrap()["MISTY_COMPOSIO_API_KEY"],
            "private-instance-key"
        );
        write_private(
            &base.join("integrations/composio.env"),
            b"COMPOSIO_API_KEY=private-misplaced-key\n",
        )
        .unwrap();
        let error = read(&workspace, target).unwrap_err().to_string();
        assert!(error.contains("belongs in"));
        assert!(!error.contains("private-misplaced-key"));
    }
}

#[test]
#[cfg(unix)]
fn composio_keys_require_private_files() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = tempfile::tempdir().unwrap();
    let workspace = fixture_workspace(tmp.path());
    let path = root(&workspace, Target::Dev).join("composio.env");
    write_private(&path, b"COMPOSIO_API_KEY=private-fixture-key\n").unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    let error = read(&workspace, Target::Dev).unwrap_err().to_string();
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
    init(&workspace, Target::Dev).unwrap();
    assert!(!workspace.cli.join(".env").exists());
    assert!(read_cli_files(&workspace).unwrap().is_empty());
    let integration = root(&workspace, Target::Dev).join("integrations/dropbox.env");
    assert!(!integration.exists());
    let before = read(&workspace, Target::Dev).unwrap();
    assert!(!before.contains_key("MISTY_DROPBOX_CLIENT_ID"));
    set(
        &workspace,
        Target::Dev,
        "MISTY_DROPBOX_CLIENT_ID",
        "fixture",
    )
    .unwrap();
    assert_eq!(
        read(&workspace, Target::Dev).unwrap()["MISTY_DROPBOX_CLIENT_ID"],
        "fixture"
    );
    fs::remove_file(integration).unwrap();
    init(&workspace, Target::Dev).unwrap();
    assert_eq!(read(&workspace, Target::Dev).unwrap(), before);
    let error = validate(&workspace, Target::Dev).unwrap_err().to_string();
    assert!(error.contains("missing required values"));
    assert!(error.contains("CLOUDFLARE_API_TOKEN"));
    init(&workspace, Target::Prod).unwrap();
    assert!(read(&workspace, Target::Prod).unwrap().is_empty());
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
    init(&workspace, Target::Dev).unwrap();
    crate::server::initialize_development_secrets(&workspace).unwrap();
    crate::server::validate_development_secrets(&workspace).unwrap();
    let first = read(&workspace, Target::Dev).unwrap();
    let worker = workspace.server.join("apps/journal-collab/.dev.vars");
    let original_worker = fs::read(&worker).unwrap();
    fs::remove_file(&worker).unwrap();
    crate::server::initialize_development_secrets(&workspace).unwrap();
    assert_eq!(
        fs::read(&worker).unwrap(),
        original_worker,
        "interrupted setup must recover the same Worker keys"
    );

    set(
        &workspace,
        Target::Dev,
        "AI_GATEWAY_API_KEY",
        "test-$literal-secret",
    )
    .unwrap();
    init(&workspace, Target::Dev).unwrap();
    crate::server::initialize_development_secrets(&workspace).unwrap();
    let second = read(&workspace, Target::Dev).unwrap();
    assert_eq!(second["AI_GATEWAY_API_KEY"], "test-$literal-secret");
    for (name, value) in first {
        assert_eq!(second[&name], value, "{name} changed on rerun");
    }
    assert!(set(&workspace, Target::Dev, "UNKNOWN", "x").is_err());
    assert!(set(
        &workspace,
        Target::Dev,
        "AI_GATEWAY_API_KEY",
        "x\nINJECTED=bad"
    )
    .is_err());
    assert!(validate(&workspace, Target::Dev).is_err());
    for (key, val) in [
        ("CLOUDFLARE_API_TOKEN", "fixture"),
        ("CLOUDFLARE_TUNNEL_TOKEN", "fixture"),
        ("CLOUDFLARE_ACCOUNT_ID", "0123456789abcdef0123456789abcdef"),
        ("MISTY_CLOUDFLARE_WORKER_HOST", "fixture.workers.dev"),
        ("MISTY_DEV_API_ORIGIN", "https://api.example.com"),
        ("MISTY_DEV_API_TUNNEL_HOSTNAME", "api.example.com"),
        ("MISTY_BILLING_ADAPTER", "http"),
        ("MISTY_BILLING_URL", "https://billing.example.com/adapter"),
        (
            "MISTY_BILLING_SECRET",
            "fixture-billing-secret-32-bytes-long", // gitleaks:allow -- synthetic test fixture
        ),
    ] {
        set(&workspace, Target::Dev, key, val).unwrap();
    }
    validate(&workspace, Target::Dev).unwrap();
    set(
        &workspace,
        Target::Dev,
        "MISTY_DEV_API_ORIGIN",
        "https://api.example.com/v1",
    )
    .unwrap();
    assert!(validate(&workspace, Target::Dev).is_err());
}
