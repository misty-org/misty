use super::*;

#[test]
fn provider_allowlist_contains_only_core_three() {
    assert!(supported_provider("drive"));
    assert!(supported_provider("onedrive"));
    assert!(supported_provider("dropbox"));
    assert!(!supported_provider("s3"));
    assert!(!supported_provider("local"));
}

#[test]
fn operation_config_disables_automatic_retries() {
    let request = with_no_retry(serde_json::json!({"fs":"example:"}));
    assert_eq!(request["_config"]["retries"], 1);
    assert_eq!(request["_config"]["lowLevelRetries"], 1);
    assert_eq!(request["_config"]["retriesSleep"], 0);
}

#[test]
fn provider_boolean_answers_advance_only_after_the_option_is_presented() {
    let state = "*oauth-islocal";
    assert!(!should_answer_provider_option(None, state, "true"));
    assert!(!should_answer_provider_option(
        Some("different-state"),
        state,
        "true"
    ));
    assert!(should_answer_provider_option(Some(state), state, "true"));
    assert!(should_answer_provider_option(Some(state), state, "false"));
    assert!(!should_answer_provider_option(Some(state), state, ""));
}

#[test]
fn drive_parameters_use_browser_oauth_defaults_without_requiring_credentials() {
    let parameters = provider_parameters("drive", serde_json::json!({}))
        .expect("Google Drive should support the built-in OAuth app");

    assert_eq!(parameters["config_is_local"], "true");
    assert_eq!(parameters["config_change_team_drive"], "false");
    assert!(parameters.get("token").is_none());
}

#[test]
fn native_runtime_starts_and_surfaces_only_curated_workflows() {
    let root = std::env::temp_dir().join(format!("misty-storage-smoke-{}", uuid::Uuid::new_v4()));
    let environment = AppEnvironmentService::for_test_home(root.clone());
    let runtime = StorageRuntimeService::start(&environment);
    assert!(runtime.snapshot().ready, "{:?}", runtime.snapshot().error);
    let workflows = runtime.workflows().expect("list curated workflows");
    let provider_types = workflows
        .as_array()
        .expect("workflow array")
        .iter()
        .filter_map(|workflow| workflow.get("type").and_then(Value::as_str))
        .collect::<Vec<_>>();
    assert_eq!(provider_types.len(), 3);
    assert!(provider_types.iter().all(|value| supported_provider(value)));
    drop(runtime);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn remote_snapshot_exposes_safe_account_provenance_but_never_tokens() {
    let root =
        std::env::temp_dir().join(format!("misty-storage-provenance-{}", uuid::Uuid::new_v4()));
    let environment = AppEnvironmentService::for_test_home(root.clone());
    let runtime = StorageRuntimeService::start(&environment);
    runtime
        .call(
            "config/create",
            serde_json::json!({
                "name": "work",
                "type": "drive",
                "parameters": {
                    "access_token": "provider-secret",
                    "misty_connection_id": "cloud_123",
                    "misty_connection_source": "connected_account",
                    "misty_connected_account_id": "connection_123"
                }
            }),
        )
        .expect("create direct cloud remote");
    let remotes = runtime.remotes().expect("list remotes");
    assert_eq!(remotes[0]["connection_id"], "cloud_123");
    assert_eq!(remotes[0]["connection_source"], "connected_account");
    assert_eq!(remotes[0]["connected_account_id"], "connection_123");
    assert!(!remotes.to_string().contains("provider-secret"));
    drop(runtime);
    let _ = std::fs::remove_dir_all(root);
}
