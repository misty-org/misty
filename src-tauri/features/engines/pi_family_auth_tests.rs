use super::*;

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "ccgui-pi-family-auth-test-{tag}-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn mask_key_boundaries() {
    assert_eq!(mask_key("!op read x"), "!op read x");
    assert_eq!(mask_key("$ENV"), "$ENV");
    assert_eq!(mask_key("short"), "········");
    let masked = mask_key("sk-ant-1234567890abcd");
    assert!(masked.starts_with("sk-ant"));
    assert!(masked.ends_with("abcd"));
    assert!(masked.contains("········"));
    assert!(!masked.contains("123456"));
}

#[test]
fn strips_jsonc_comments() {
    let input = "{\n  // line\n  \"a\": \"http://x\", /* block */ \"b\": 1\n}";
    let value: Value = serde_json::from_str(&strip_jsonc_comments(input)).unwrap();
    assert_eq!(value["a"], "http://x");
    assert_eq!(value["b"], 1);
}

#[test]
fn pi_set_list_delete_roundtrip_preserves_oauth_and_unknown() {
    let dir = temp_dir("pi-roundtrip");
    // Pre-existing oauth + unknown entries must survive writes.
    std::fs::write(
        dir.join("auth.json"),
        r#"{"openai-codex": {"type": "oauth", "refresh": "r"}, "custom-x": {"type": "api_key", "key": "keepme", "env": {"A": "B"}}}"#,
    )
    .unwrap();

    pi_set_api_key(&dir, "anthropic", "sk-ant-test-123456").unwrap();
    let list = pi_list(&dir).unwrap();
    assert!(list.store.exists);
    let anthropic = list.providers.iter().find(|p| p.id == "anthropic").unwrap();
    assert_eq!(anthropic.state, "configured");
    assert!(anthropic
        .masked_key
        .as_deref()
        .unwrap()
        .contains("········"));
    assert_eq!(list.oauth_providers, vec!["openai-codex".to_string()]);

    // Raw file still carries the preserved entries.
    let raw: Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("auth.json")).unwrap()).unwrap();
    assert_eq!(raw["openai-codex"]["type"], "oauth");
    assert_eq!(raw["custom-x"]["key"], "keepme");
    assert_eq!(raw["anthropic"]["key"], "sk-ant-test-123456");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(dir.join("auth.json"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    pi_delete_credential(&dir, "anthropic").unwrap();
    let list = pi_list(&dir).unwrap();
    assert_eq!(
        list.providers
            .iter()
            .find(|p| p.id == "anthropic")
            .unwrap()
            .state,
        "none"
    );

    // OAuth-only catalog entries refuse API-key writes.
    let err = pi_set_api_key(&dir, "github-copilot", "x").unwrap_err();
    assert!(err.contains("OAUTH_ONLY"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn pi_corrupted_auth_fails_closed() {
    let dir = temp_dir("pi-corrupt");
    std::fs::write(dir.join("auth.json"), "{not json").unwrap();
    assert!(pi_list(&dir).unwrap_err().contains("CORRUPTED"));
    assert!(pi_set_api_key(&dir, "anthropic", "sk-test-value-1").is_err());
    // Never overwritten.
    assert_eq!(
        std::fs::read_to_string(dir.join("auth.json")).unwrap(),
        "{not json"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// Mirror of omp's schema + revision triggers (from omp's auth
/// migrations), so tests exercise the same write path live omp uses.
fn create_omp_db(dir: &std::path::Path) {
    let conn = rusqlite::Connection::open(dir.join("agent.db")).unwrap();
    conn.execute_batch(
        "CREATE TABLE auth_credentials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider TEXT NOT NULL,
            credential_type TEXT NOT NULL,
            data TEXT NOT NULL,
            disabled_cause TEXT DEFAULT NULL,
            identity_key TEXT DEFAULT NULL,
            created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
            updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
        );
        CREATE TABLE auth_change_revision (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL);
        INSERT INTO auth_change_revision (id, revision) VALUES (1, 0);
        CREATE TRIGGER auth_change_revision_auth_credentials_insert AFTER INSERT ON auth_credentials
            BEGIN UPDATE auth_change_revision SET revision = revision + 1 WHERE id = 1; END;
        CREATE TRIGGER auth_change_revision_auth_credentials_delete AFTER DELETE ON auth_credentials
            BEGIN UPDATE auth_change_revision SET revision = revision + 1 WHERE id = 1; END;",
    )
    .unwrap();
}

fn omp_revision(dir: &std::path::Path) -> i64 {
    let conn = rusqlite::Connection::open(dir.join("agent.db")).unwrap();
    conn.query_row(
        "SELECT revision FROM auth_change_revision WHERE id = 1",
        [],
        |r| r.get(0),
    )
    .unwrap()
}

#[test]
fn omp_missing_db_lists_all_none_without_creating() {
    let dir = temp_dir("omp-missing");
    let list = omp_list(&dir).unwrap();
    assert!(!list.store.exists);
    assert!(list.providers.iter().all(|p| p.state == "none"));
    assert!(!dir.join("agent.db").exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn omp_set_list_delete_roundtrip() {
    let dir = temp_dir("omp-roundtrip");
    create_omp_db(&dir);

    omp_set_api_key(&dir, "openai", "sk-test-openai-123").unwrap();
    assert!(omp_revision(&dir) > 0); // omp's triggers fired
    let list = omp_list(&dir).unwrap();
    assert!(list.store.exists);
    let openai = list.providers.iter().find(|p| p.id == "openai").unwrap();
    assert_eq!(openai.state, "configured");
    assert_eq!(openai.key_source.as_deref(), Some("literal"));

    // Replace: the masked key tracks the new value.
    omp_set_api_key(&dir, "openai", "sk-test-openai-456").unwrap();
    let list = omp_list(&dir).unwrap();
    let openai = list.providers.iter().find(|p| p.id == "openai").unwrap();
    assert!(openai.masked_key.as_deref().unwrap().ends_with("-456"));

    // OAuth rows survive api_key writes and are listed separately.
    let (conn, _) = omp_connect(&dir, false).unwrap();
    conn.execute(
        "INSERT INTO auth_credentials (provider, credential_type, data, identity_key) VALUES ('openai-codex', 'oauth', '{\"access\":\"a\"}', 'k')",
        [],
    )
    .unwrap();
    drop(conn);
    omp_set_api_key(&dir, "openai", "sk-test-openai-789").unwrap();
    let list = omp_list(&dir).unwrap();
    assert_eq!(list.oauth_providers, vec!["openai-codex".to_string()]);

    // Delete removes only api_key rows; oauth-only providers refuse.
    omp_delete_credential(&dir, "openai").unwrap();
    let list = omp_list(&dir).unwrap();
    assert_eq!(
        list.providers
            .iter()
            .find(|p| p.id == "openai")
            .unwrap()
            .state,
        "none"
    );
    assert_eq!(list.oauth_providers, vec!["openai-codex".to_string()]);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn models_config_validate_and_summarize() {
    // pi: JSONC with comments.
    let json = "{\n  // relay\n  \"providers\": {\"r\": {\"baseUrl\": \"https://x/v1\", \"apiKey\": \"$K\", \"models\": [{\"id\": \"m1\"}]}}\n}";
    let value = validate_models_config_text("pi", json).unwrap();
    let summaries = summarize_providers(&value);
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].id, "r");
    assert_eq!(summaries[0].model_count, 1);
    assert!(summaries[0].has_api_key);
    assert!(
        validate_models_config_text("pi", "{\"providers\": {\"r\": {\"models\": [{}]}}}").is_err()
    );

    // omp: YAML.
    let yaml = "providers:\n  r:\n    baseUrl: https://x/v1\n    api: openai-completions\n    models:\n      - id: m1\n      - id: m2\n";
    let value = validate_models_config_text("omp", yaml).unwrap();
    let summaries = summarize_providers(&value);
    assert_eq!(summaries[0].model_count, 2);
    assert!(!summaries[0].has_api_key);
    assert!(validate_models_config_text("omp", "providers: [not-a-map]").is_err());
}

#[test]
fn models_config_read_write_roundtrip() {
    let dir = temp_dir("models");
    // Missing file: no text, template offered, nothing written.
    let read = read_models_config(&dir, "pi").unwrap();
    assert!(!read.file.exists);
    assert!(read.text.is_none());
    assert!(read.template.contains("providers"));

    write_models_config(&dir, "pi", "{\n  \"providers\": {}\n}\n").unwrap();
    let read = read_models_config(&dir, "pi").unwrap();
    assert!(read.file.exists);
    assert_eq!(read.file.format, "json");
    assert!(read.parse_error.is_none());

    // Corrupted file: read reports parse_error; invalid writes leave the
    // file untouched.
    std::fs::write(dir.join("models.json"), "{bad").unwrap();
    let read = read_models_config(&dir, "pi").unwrap();
    assert!(read.parse_error.is_some());
    assert!(write_models_config(&dir, "pi", "{also bad").is_err());
    assert_eq!(
        std::fs::read_to_string(dir.join("models.json")).unwrap(),
        "{bad"
    );

    // omp lands on models.yml.
    write_models_config(&dir, "omp", MODELS_TEMPLATE_YAML).unwrap();
    let read = read_models_config(&dir, "omp").unwrap();
    assert!(read.file.path.ends_with("models.yml"));
    assert_eq!(read.file.format, "yaml");
    assert_eq!(read.providers.len(), 1);
    assert_eq!(read.providers[0].id, "my-relay");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn an_unknown_engine_is_an_error_even_with_the_agent_dir_variable_set() {
    let _lock = crate::engine_config::support::HOME_ENV_LOCK.lock();
    let saved = std::env::var_os("PI_CODING_AGENT_DIR");
    let dir = temp_dir("unknown-engine");
    std::env::set_var("PI_CODING_AGENT_DIR", &dir);
    let list = pi_family_auth_list("codex".into());
    let set = pi_family_auth_set_api_key("codex".into(), "anthropic".into(), "sk-x".into());
    let delete = pi_family_auth_delete_credential("codex".into(), "anthropic".into());
    let models = pi_family_models_config_read("codex".into());
    match saved {
        Some(value) => std::env::set_var("PI_CODING_AGENT_DIR", value),
        None => std::env::remove_var("PI_CODING_AGENT_DIR"),
    }
    let _ = file_access::fs::remove_dir_all(&dir);
    for error in [list.err(), set.err(), delete.err(), models.err()] {
        assert!(error.is_some_and(|text| text.contains("unsupported engine: codex")));
    }
}
