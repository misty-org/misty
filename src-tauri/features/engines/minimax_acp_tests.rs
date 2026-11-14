// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/minimax_acp.rs.
use super::*;

#[test]
fn session_id_survives_both_handshake_shapes() {
    assert_eq!(
        extract_session_id(&json!({ "sessionId": "mvs_a", "modes": {} })),
        Some("mvs_a".to_string())
    );
    assert_eq!(
        extract_session_id(&json!({ "_meta": { "sessionId": "mvs_b" } })),
        Some("mvs_b".to_string())
    );
    assert_eq!(extract_session_id(&json!({ "session_id": " " })), None);
}

fn modes_result(modes: Value) -> Value {
    json!({ "sessionId": "mvs_a", "modes": { "availableModes": modes } })
}

/// The live session/new shape (mcode 0.5.1): only `default` and `plan`
/// are session modes — everything else lives in the `permissionMode`
/// config option, so only the plan request routes through `mode_id`.
#[test]
fn mode_matching_reads_advertised_ids_and_names() {
    let modes = json!([
        { "id": "default", "name": "Default" },
        { "id": "plan", "name": "Plan" },
    ]);
    assert_eq!(
        mode_id(Some("plan"), &modes_result(modes.clone())).as_deref(),
        Some("plan")
    );
    // Non-plan permissions never match a session mode: they ride the
    // `permissionMode` config option instead.
    assert_eq!(mode_id(Some("auto"), &modes_result(modes.clone())), None);
    assert_eq!(mode_id(Some("bypass"), &modes_result(modes)), None);
    // Flat string-mode spellings also match.
    let flat = json!(["default", "plan"]);
    assert_eq!(
        mode_id(Some("plan"), &modes_result(flat)).as_deref(),
        Some("plan")
    );
    // No advertised modes → None (the driver keeps the CLI default).
    assert_eq!(mode_id(Some("plan"), &json!({})), None);
}

#[test]
fn permission_config_maps_onto_the_verified_values() {
    assert_eq!(permission_config_value("auto"), "auto");
    assert_eq!(permission_config_value("manual"), "default");
    // No folder sandbox, so never Full access.
    assert_eq!(permission_config_value("bypass"), "auto");
    assert_eq!(permission_config_value("plan"), "auto");
}

/// The live `model` config option (mcode 0.5.1): internal
/// `m:<provider>:<model>:v:<variant>` values only.
fn model_session_result() -> Value {
    json!({
        "sessionId": "mvs_a",
        "configOptions": [
            { "id": "permissionMode", "options": [
                { "value": "default", "name": "Ask" },
                { "value": "auto", "name": "Auto" },
                { "value": "bypassPermissions", "name": "Full access" },
            ]},
            { "id": "model", "options": [
                { "value": "m:minimax:MiniMax-M3:v:", "name": "MiniMax-M3" },
                { "value": "m:minimax:MiniMax-M3:v:thinking", "name": "MiniMax-M3 · thinking" },
                { "value": "m:minimax:MiniMax-M2.7-highspeed:v:thinking", "name": "MiniMax-M2.7-highspeed · thinking" },
                { "value": "m:minimax:MiniMax-M2.7:v:thinking", "name": "MiniMax-M2.7 · thinking" },
            ]},
        ],
    })
}

#[test]
fn model_resolution_matches_live_config_values() {
    // Thinking variant preferred for a normal effort request…
    assert_eq!(
        resolve_model_value(
            &model_session_result(),
            "minimax/MiniMax-M3",
            Some("medium")
        )
        .as_deref(),
        Some("m:minimax:MiniMax-M3:v:thinking")
    );
    // …plain variant when the effort is off, with a fall-back to the
    // first candidate when the wanted variant does not exist.
    assert_eq!(
        resolve_model_value(&model_session_result(), "minimax/MiniMax-M3", Some("off")).as_deref(),
        Some("m:minimax:MiniMax-M3:v:")
    );
    assert_eq!(
        resolve_model_value(
            &model_session_result(),
            "minimax/MiniMax-M2.7-highspeed",
            Some("high")
        )
        .as_deref(),
        Some("m:minimax:MiniMax-M2.7-highspeed:v:thinking")
    );
    // A `#variant` suffix on the picker id is stripped before matching.
    assert_eq!(
        resolve_model_value(
            &model_session_result(),
            "minimax/MiniMax-M2.7#thinking",
            None
        )
        .as_deref(),
        Some("m:minimax:MiniMax-M2.7:v:thinking")
    );
    // Unknown model / no model option at all → None (keep CLI default).
    assert_eq!(
        resolve_model_value(&model_session_result(), "minimax/Nope-M99", None),
        None
    );
    assert_eq!(
        resolve_model_value(&json!({}), "minimax/MiniMax-M3", None),
        None
    );
}

#[test]
fn parse_model_option_skips_non_conforming_values() {
    assert_eq!(
        parse_model_option_value("m:minimax:MiniMax-M3:v:"),
        Some(("minimax/MiniMax-M3".to_string(), String::new()))
    );
    assert_eq!(
        parse_model_option_value("m:minimax:MiniMax-M2.7:v:thinking"),
        Some(("minimax/MiniMax-M2.7".to_string(), "thinking".to_string()))
    );
    assert_eq!(parse_model_option_value("minimax/MiniMax-M3"), None);
    assert_eq!(parse_model_option_value("m:::v:"), None);
}

/// The live session/new menu (mcode 0.5.1): variant entries collapse to
/// one row per model, labels lose their variant suffix, and the CLI's
/// configured default leads — including providers the user added
/// themselves (a GLM channel lists as glm/…).
#[test]
fn probe_menu_collapses_variants_and_leads_with_the_default() {
    let rows = models_from_config_options(&json!({
        "sessionId": "mvs_a",
        "configOptions": [
            { "id": "permissionMode", "options": [] },
            { "id": "model", "currentValue": "m:minimax:MiniMax-M2.7:v:thinking", "options": [
                { "value": "m:minimax:MiniMax-M3:v:", "name": "MiniMax-M3" },
                { "value": "m:minimax:MiniMax-M3:v:thinking", "name": "MiniMax-M3 · thinking" },
                { "value": "m:glm:glm-4.7:v:thinking", "name": "glm-4.7 · thinking" },
                { "value": "m:minimax:MiniMax-M2.7:v:thinking", "name": "MiniMax-M2.7 · thinking" },
            ]},
        ],
    }));
    assert_eq!(
        rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(),
        ["minimax/MiniMax-M2.7", "minimax/MiniMax-M3", "glm/glm-4.7"]
    );
    assert!(rows[0].is_default);
    assert!(!rows[1].is_default);
    assert_eq!(rows[1].name.as_deref(), Some("MiniMax-M3"));
    assert_eq!(rows[2].name.as_deref(), Some("glm-4.7"));
    // A handshake without a model option yields an empty menu.
    assert!(models_from_config_options(&json!({ "configOptions": [] })).is_empty());
}

#[test]
fn rpc_error_recovery_keeps_code_and_message() {
    let raw = "rpc:session/set_config_option:-32601:Method not found";
    let error = rpc_error(raw, "session/set_config_option");
    assert_eq!(error.code, -32601);
    assert_eq!(error.message, "Method not found");
    assert_eq!(rpc_code(raw), Some(-32601));
    assert_eq!(rpc_code("rpc timed out"), None);
}

#[test]
fn the_prompt_answers_acp_usage_sizes_the_context() {
    // MiniMax Code's prompt answer: ACP's `usage` (its input leaves the cache out) beside its
    // own turn record in `_meta`.
    let answer = json!({"stopReason": "end_turn",
        "usage": {"totalTokens": 18200, "inputTokens": 1200, "outputTokens": 200,
            "cachedReadTokens": 16800},
        "_meta": {"minimax-code/turn": {"runId": "acp_t1", "turnId": "t1", "durationMs": 900,
            "usageIncomplete": false}}});
    let usage = prompt_usage(&answer).unwrap();
    assert_eq!(usage["cachedReadTokens"], 16800);
    assert_eq!(
        crate::engines::bridge::context_usage(&usage),
        (Some(18200), None)
    );
    // Its usage_update once the turn finishes: the context's size, sent on as `used`.
    let update = usage_update(&json!({"sessionId": "s1", "update": {
        "sessionUpdate": "usage_update", "used": 18200, "size": 204800,
        "cost": {"amount": 0.002, "currency": "USD"}}}))
    .unwrap();
    assert_eq!(update["used"], 18200);
    assert_eq!(
        crate::engines::bridge::context_usage(&update),
        (Some(18200), Some(204800))
    );
}

#[test]
fn usage_and_updates_project_onto_frontend_keys() {
    let usage =
        prompt_usage(&json!({ "_meta": { "inputTokens": 10, "outputTokens": 5 } })).unwrap();
    assert_eq!(usage["totalTokens"], json!(15));
    assert_eq!(
        usage_update(
            &json!({"update": {"sessionUpdate": "usage_update", "used": 100, "size": 200000}})
        )
        .unwrap()["model_context_window"],
        json!(200000)
    );
    assert!(usage_update(&json!({"update": {"sessionUpdate": "agent_message_chunk"}})).is_none());
    assert!(prompt_usage(&json!({})).is_none());
}

/// mcode 0.7.7's `session/load` answer for a session last run in plan mode (the mode outlives the
/// process; `permissionMode` is per process and comes back `auto`).
fn loaded_in_plan() -> Value {
    json!({
        "modes": {"currentModeId": "plan", "availableModes": [
            {"id": "default", "name": "Default", "description": "Work normally with the configured tools and permission policy."},
            {"id": "plan", "name": "Plan", "description": "Research and prepare an implementation plan before making changes."}
        ]},
        "configOptions": [{"type": "select", "id": "permissionMode", "name": "Permission mode",
            "category": "_permission", "currentValue": "auto", "options": [
                {"value": "default", "name": "Ask"}, {"value": "auto", "name": "Auto"},
                {"value": "bypassPermissions", "name": "Full access"}],
            "_meta": {"minimax-code/scope": "process"}}]
    })
}

#[test]
fn a_session_left_in_plan_mode_goes_back_to_default() {
    assert_eq!(
        leave_plan_mode(&loaded_in_plan()).as_deref(),
        Some("default")
    );
    let mut fresh = loaded_in_plan();
    fresh["modes"]["currentModeId"] = json!("default");
    assert_eq!(leave_plan_mode(&fresh), None);
    assert_eq!(leave_plan_mode(&json!({})), None);
    // The plan request still finds mcode's plan mode, and the other modes are its permission
    // option's values.
    assert_eq!(
        mode_id(Some("plan"), &loaded_in_plan()).as_deref(),
        Some("plan")
    );
    assert_eq!(permission_config_value("manual"), "default");
    assert_eq!(permission_config_value("auto"), "auto");
}
