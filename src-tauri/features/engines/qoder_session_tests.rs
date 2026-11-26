// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/qoder_session.rs.
use super::*;

#[test]
fn rpc_error_message_strips_the_code_prefix() {
    assert_eq!(parse_rpc_error_message("rpc:-32601:no method"), "no method");
    assert_eq!(
        parse_rpc_error_message("rpc:-32000:session/fork: Authentication required: Sign in."),
        "Authentication required: Sign in."
    );
    assert_eq!(parse_rpc_error_message("plain failure"), "plain failure");
}

#[test]
fn parses_models_from_session_new() {
    let result = json!({
        "sessionId": "s-1",
        "models": {
            "currentModelId": "qoder-pro",
            "availableModels": [
                {"modelId": "qoder-pro", "name": "Qoder Pro"},
                {"modelId": "qoder-flash"},
            ],
        },
    });
    let models = parse_models_from_session_new(&result);
    assert_eq!(models.len(), 2);
    assert_eq!(models[0].id, "qoder-pro");
    assert_eq!(models[0].name.as_deref(), Some("Qoder Pro"));
    assert!(models[0].is_default);
    assert!(!models[1].is_default);
    assert_eq!(models[1].name, None);
    let result = json!({"models": {"availableModels": [{"modelId": "a"}]}});
    let models = parse_models_from_session_new(&result);
    assert!(models[0].is_default);
}

#[test]
fn bypass_started_session_skips_set_mode() {
    let started = json!({"sessionId": "s-1", "modes": {"currentModeId": "yolo"}});
    assert!(bypass_mode_active(&started));
    let legacy = json!({"modes": {"currentModeId": "bypassPermissions"}});
    assert!(bypass_mode_active(&legacy));
    let downgraded = json!({"modes": {"currentModeId": "default"}});
    assert!(!bypass_mode_active(&downgraded));
    assert!(!bypass_mode_active(&json!({"sessionId": "s-1"})));
    assert_eq!(
        ACP_LAUNCH_ARGS,
        ["--acp", "--permission-mode", "bypass_permissions"]
    );
}
