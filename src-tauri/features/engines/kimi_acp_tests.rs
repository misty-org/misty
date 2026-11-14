use super::*;

#[tokio::test]
async fn additional_dirs_keep_valid_roots_without_mutating_grants() {
    let home = std::env::temp_dir().join(format!("kimi-grants-{}", uuid::Uuid::new_v4()));
    let valid = home.join("有效目录 with spaces");
    let missing = home.join("missing");
    let file = home.join("file");
    std::fs::create_dir_all(&valid).unwrap();
    std::fs::write(&file, "file").unwrap();
    let dirs: Vec<String> = [&missing, &valid, &file]
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect();
    let original = dirs.clone();
    assert_eq!(
        existing_additional_dirs(&dirs).await.unwrap(),
        vec![dirs[1].as_str()]
    );
    assert_eq!(dirs, original);
    assert!(existing_additional_dirs(&[]).await.unwrap().is_empty());
    assert!(
        existing_additional_dirs(&[dirs[0].clone(), dirs[2].clone()])
            .await
            .unwrap()
            .is_empty()
    );
    std::fs::create_dir(&missing).unwrap();
    assert_eq!(
        existing_additional_dirs(&dirs).await.unwrap(),
        vec![dirs[0].as_str(), dirs[1].as_str()]
    );
    std::fs::remove_dir_all(home).unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn additional_dirs_follow_directory_links_but_report_other_io_errors() {
    let home = std::env::temp_dir().join(format!("kimi-grant-links-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&home).unwrap();
    let valid = home.join("valid-link");
    let broken = home.join("broken-link");
    let cyclic = home.join("cyclic-link");
    std::os::unix::fs::symlink(&home, &valid).unwrap();
    std::os::unix::fs::symlink(home.join("missing"), &broken).unwrap();
    std::os::unix::fs::symlink(&cyclic, &cyclic).unwrap();
    let dirs = vec![
        valid.to_string_lossy().into_owned(),
        broken.to_string_lossy().into_owned(),
    ];
    assert_eq!(
        existing_additional_dirs(&dirs).await.unwrap(),
        vec![dirs[0].as_str()]
    );
    let error = existing_additional_dirs(&[cyclic.to_string_lossy().into_owned()])
        .await
        .unwrap_err();
    assert!(error.contains("Kimi additional directory"), "{error}");
    std::fs::remove_dir_all(home).unwrap();
}

fn request() -> Value {
    json!({"mode": "form", "message": "任务？\n语言？\n继续？", "requestedSchema": {
        "type": "object", "required": ["q0", "q1", "q2"], "properties": {
            "q0": {"type": "string", "title": "任务", "oneOf": [{"const":"修复", "description":"修复错误"}, {"const":"功能"}]},
            "q1": {"type": "array", "title": "语言", "items": {"anyOf": [{"const":"中文"}, {"const":"English"}]}},
            "q2": {"type": "string", "title": "继续", "oneOf": [{"const":"是"}, {"const":"否"}]}
        }
    }})
}

#[test]
fn three_questions_round_trip_without_losing_multiselect_or_order() {
    let questions = fields(&request()).unwrap();
    assert_eq!(questions.len(), 3);
    assert_eq!(questions[0]["question"], "任务？");
    assert_eq!(questions[1]["multiSelect"], true);
    assert_eq!(questions[2]["allowOther"], false);
    for id in [json!(7), json!("rpc-7")] {
        let context = json!({"rpcId": id, "fields": questions});
        let answers = json!({"任务？": "修复", "语言？": ["中文", "English"], "继续？": "是"});
        assert_eq!(
            answer_frame(&context, Some(&answers)).unwrap(),
            json!({
                "jsonrpc": "2.0", "id": id, "result": {"action": "accept", "content": {
                    "q0": "修复", "q1": ["中文", "English"], "q2": "是"
                }}
            })
        );
        assert_eq!(
            answer_frame(&context, None).unwrap()["result"]["action"],
            "cancel"
        );
        assert!(answer_frame(&context, Some(&json!({}))).is_err());
        let mut invalid = answers.clone();
        invalid["任务？"] = json!("free text");
        assert!(answer_frame(&context, Some(&invalid)).is_err());
        invalid = answers.clone();
        invalid["语言？"] = json!([]);
        assert!(answer_frame(&context, Some(&invalid)).is_err());
    }
    assert!(fields(&json!({"mode": "url"})).is_err());
}

#[test]
fn auto_keeps_questions_enabled_and_advertises_forms() {
    assert_eq!(mode(Some("auto")), "auto");
    assert_eq!(mode(Some("manual")), "default");
    assert_eq!(mode(Some("plan")), "plan");
    assert_eq!(mode(Some("bypass")), "default");
    assert_eq!(
        initialization()["clientCapabilities"]["elicitation"],
        json!({"form": {}})
    );
}

#[test]
fn channel_model_depends_on_resolved_environment_not_optional_provider_id() {
    let mut command = tokio::process::Command::new("kimi");
    assert_eq!(
        selected_model(Some("native-alias"), &command).as_deref(),
        Some("native-alias")
    );
    assert_eq!(selected_model(None, &command), None);
    command.env("KIMI_MODEL_API_KEY", "test-key");
    assert_eq!(
        selected_model(Some("channel-model"), &command).as_deref(),
        Some("__kimi_env_model__")
    );
    assert_eq!(
        selected_model(None, &command).as_deref(),
        Some("__kimi_env_model__")
    );
}

#[test]
fn boolean_thinking_models_accept_effort_without_rejecting_the_turn() {
    let config = json!({"configOptions": [{"id": "thinking", "options": [{"value":"off"}, {"value":"on"}]}]});
    assert_eq!(supported_effort("medium", &config), "on");
    assert_eq!(supported_effort("high", &config), "on");
    assert_eq!(supported_effort("none", &config), "off");
    assert_eq!(supported_effort("off", &config), "off");
    let config = json!({"configOptions": [{"id": "thinking", "currentValue": "medium", "options": [{"value":"off"}, {"value":"on"}, {"value":"medium"}]}]});
    assert_eq!(supported_effort("medium", &config), "on");
    let config = json!({"configOptions": [{"id": "thinking", "options": [{"value":"medium"}, {"value":"high"}]}]});
    assert_eq!(supported_effort("high", &config), "high");
    assert_eq!(supported_effort("ultra", &config), "high");
    assert_eq!(supported_effort("low", &config), "medium");
    assert_eq!(supported_effort("off", &config), "medium");
}

#[test]
fn multiline_prompts_do_not_shift_questions_and_answer_fields() {
    let mut params = request();
    params["message"] = json!("任务？\n请选择一项\n语言？\n继续？");
    params["requestedSchema"]["properties"]["q1"]["title"] = json!("任务");
    let questions = fields(&params).unwrap();
    assert_eq!(questions[0]["question"], "Q1 · 任务");
    assert_eq!(questions[1]["question"], "Q2 · 任务");
    assert_eq!(questions[2]["question"], "Q3 · 继续");
    let context = json!({"rpcId": 1, "fields": questions});
    let response = answer_frame(
        &context,
        Some(&json!({"Q1 · 任务":"修复", "Q2 · 任务":["中文"], "Q3 · 继续":"否"})),
    )
    .unwrap();
    assert_eq!(
        response["result"]["content"],
        json!({"q0":"修复", "q1":["中文"], "q2":"否"})
    );
}

/// Kimi Code 2.6.2's `session/new` answer (on an env channel), trimmed to its options.
fn kimi_session() -> Value {
    json!({"sessionId": "session_10d77b63-6ad8-4009-8379-2d91b1d75f63", "configOptions": [
        {"type": "select", "id": "model", "name": "Model", "category": "model",
         "currentValue": "__kimi_env_model__",
         "options": [{"value": "__kimi_env_model__", "name": "probe-model"}]},
        {"type": "select", "id": "thinking", "name": "Thinking", "category": "thought_level",
         "currentValue": "on",
         "options": [{"value": "off", "name": "Thinking Off"}, {"value": "on", "name": "Thinking On"}]},
        {"type": "select", "id": "mode", "name": "Mode", "category": "mode", "currentValue": "default",
         "options": [{"value": "default", "name": "Default"}, {"value": "plan", "name": "Plan"},
                     {"value": "auto", "name": "Auto"}, {"value": "yolo", "name": "YOLO"}]}],
        "modes": {"currentModeId": "default", "availableModes": [
            {"id": "default", "name": "Default", "description": "Manual approvals; tools execute normally."},
            {"id": "plan", "name": "Plan", "description": "Read-only planning; no tool execution."},
            {"id": "auto", "name": "Auto", "description": "Auto-approve safe operations."},
            {"id": "yolo", "name": "YOLO", "description": "Auto-approve everything."}]}})
}

#[test]
fn kimi_modes_and_thinking_match_the_installed_handshake() {
    let session = kimi_session();
    let listed: Vec<String> = crate::engines::models::acp_modes(&session)
        .into_iter()
        .map(|mode| mode.id)
        .collect();
    assert_eq!(listed, ["default", "plan", "auto", "yolo"]);
    // Every mode Misty sets is one Kimi lists; YOLO, with no sandbox, is never one of them.
    for permission in ["manual", "plan", "auto", "bypass"] {
        assert!(listed.iter().any(|id| id == mode(Some(permission))));
    }
    let adapter: Vec<&str> = crate::engines::kimi::KimiEngine
        .modes()
        .iter()
        .map(|mode| mode.id)
        .collect();
    assert_eq!(adapter, ["default", "plan", "auto"]);
    // Its thinking option is a switch.
    assert_eq!(supported_effort("high", &session), "on");
    assert_eq!(supported_effort("none", &session), "off");
}

#[test]
fn usage_preserves_context_occupancy_and_window() {
    assert_eq!(
        usage(&json!({"update": {"sessionUpdate": "usage_update", "used": 29000, "size": 262144}})),
        Some(json!({"input_tokens": 29000, "used": 29000, "model_context_window": 262144}))
    );
    assert!(usage(&json!({"update": {"sessionUpdate": "agent_message_chunk"}})).is_none());
    // A fresh session's empty context is no compaction: the bar reads no size from it.
    let empty =
        usage(&json!({"update": {"sessionUpdate": "usage_update", "used": 0, "size": 1}})).unwrap();
    assert_eq!(
        crate::engines::bridge::context_usage(&empty),
        (None, Some(1))
    );
}
