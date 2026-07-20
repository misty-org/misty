use super::*;

#[test]
fn formats_structured_errors_without_product_leaking_engine_name() {
    let error = storage_error("operations/list", 500, r#"{"error":"denied"}"#);
    assert_eq!(error, "Storage operation failed (500): denied");
}

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

#[cfg(feature = "embedded-storage-go")]
#[test]
fn embedded_runtime_starts_and_surfaces_only_curated_workflows() {
    crate::services::keychain::prime_rclone_config_password_cache_for_test(None);
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
