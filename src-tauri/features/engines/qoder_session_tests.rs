// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/qoder_session.rs.
use super::*;

#[test]
fn parses_response_notification_and_agent_request() {
    let response = json!({"jsonrpc":"2.0","id":1,"result":{"ok":true}});
    match parse_acp_line(&response) {
        AcpLine::Response { id, result, error } => {
            assert_eq!(id, json!(1));
            assert_eq!(result, Some(json!({"ok":true})));
            assert!(error.is_none());
        }
        _ => panic!("expected response"),
    }
    let notification = json!({
        "jsonrpc":"2.0",
        "method":"session/update",
        "params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hi"}}}
    });
    match parse_acp_line(&notification) {
        AcpLine::Notification { method, .. } => assert_eq!(method, "session/update"),
        _ => panic!("expected notification"),
    }
    // method + id = the agent is asking US (permission, fs).
    let request = json!({"jsonrpc":"2.0","id":9,"method":"session/request_permission","params":{}});
    match parse_acp_line(&request) {
        AcpLine::AgentRequest { id, method, .. } => {
            assert_eq!(id, json!(9));
            assert_eq!(method, "session/request_permission");
        }
        _ => panic!("expected agent request"),
    }
    // String ids key responses too.
    assert_eq!(jsonrpc_id_key(&json!("req-1")).as_deref(), Some("req-1"));
    assert_eq!(jsonrpc_id_key(&json!(7)).as_deref(), Some("7"));
    assert!(matches!(
        parse_acp_line(&json!({"hello":"world"})),
        AcpLine::Other
    ));
    assert!(matches!(
        parse_acp_line(&json!({"jsonrpc":"2.0"})),
        AcpLine::Other
    ));
    let error = json!({"jsonrpc":"2.0","id":2,"error":{"code":-32601,"message":"no such method"}});
    match parse_acp_line(&error) {
        AcpLine::Response {
            error: Some(error), ..
        } => {
            assert_eq!(error.code, -32601);
            assert_eq!(error.message, "no such method");
        }
        _ => panic!("expected error response"),
    }
}

#[test]
fn maps_session_update_kinds() {
    let text =
        json!({"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello"}});
    assert_eq!(
        map_session_update(&text),
        QoderSessionUpdate::AgentMessageChunk {
            text: "hello".to_string()
        }
    );
    let thought = json!({"sessionUpdate":"agent_thought_chunk","content":{"type":"thinking","thinking":"hmm"}});
    assert_eq!(
        map_session_update(&thought),
        QoderSessionUpdate::AgentThoughtChunk {
            text: "hmm".to_string()
        }
    );
    let tool = json!({"sessionUpdate":"tool_call","toolCallId":"call-1","title":"read","status":"pending","rawInput":{"path":"a.rs"}});
    assert_eq!(
        map_session_update(&tool),
        QoderSessionUpdate::ToolStarted {
            tool_id: "call-1".to_string(),
            tool_name: "read".to_string(),
            input: Some(json!({"path":"a.rs"})),
        }
    );
    // A completed snapshot carries the result instead of a start.
    let done = json!({"sessionUpdate":"tool_call","toolCallId":"call-1","title":"read","status":"completed","rawOutput":"ok"});
    assert_eq!(
        map_session_update(&done),
        QoderSessionUpdate::ToolCompleted {
            tool_id: "call-1".to_string(),
            tool_name: Some("read".to_string()),
            output: Some(json!("ok")),
            error: None,
        }
    );
    let failed = json!({"sessionUpdate":"tool_call_update","toolCallId":"call-2","status":"failed","content":[{"type":"content","content":{"type":"text","text":"boom"}}]});
    assert_eq!(
        map_session_update(&failed),
        QoderSessionUpdate::ToolCompleted {
            tool_id: "call-2".to_string(),
            tool_name: None,
            output: Some(json!([{"type":"content","content":{"type":"text","text":"boom"}}])),
            error: Some("boom".to_string()),
        }
    );
    // Updates without a usable id or text are ignored.
    assert_eq!(
        map_session_update(&json!({"sessionUpdate":"tool_call","status":"pending"})),
        QoderSessionUpdate::Ignore
    );
    assert_eq!(
        map_session_update(&json!({"sessionUpdate":"agent_message_chunk","content":{}})),
        QoderSessionUpdate::Ignore
    );
    // Notifications wrap the update under params.update.
    let wrapped =
        json!({"update":{"sessionUpdate":"agent_message_chunk","content":{"text":"wrapped"}}});
    assert_eq!(
        session_update_from_notification(&wrapped),
        QoderSessionUpdate::AgentMessageChunk {
            text: "wrapped".to_string()
        }
    );
}

#[test]
fn error_prefixed_chunks_are_detected() {
    assert!(is_error_prefixed_text("[Error] Network attempt failed"));
    assert!(is_error_prefixed_text("  [Error] boom"));
    assert!(!is_error_prefixed_text("hello [Error] later"));
}

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
fn permission_auto_answer_selects_first_allow_kind() {
    let params = json!({
        "options": [
            {"kind":"reject_once","optionId":"no"},
            {"kind":"allow_always","optionId":"yes"},
        ]
    });
    let answer = permission_auto_answer(&params).unwrap();
    assert_eq!(answer["outcome"]["optionId"], json!("yes"));
    assert!(permission_auto_answer(&json!({"options":[]})).is_err());
}

#[test]
fn rpc_internal_error_retains_safe_details_instead_of_hiding_the_cause() {
    let response = json!({"jsonrpc":"2.0", "id":4, "error": {
        "code":-32603, "message":"Internal error", "data": {
            "details":"Unknown model alias: missing-model; api_key=sk-private\nprivate stack trace",
            "request": {"prompt":"private conversation"}
        }
    }});
    let AcpLine::Response {
        error: Some(error), ..
    } = parse_acp_line(&response)
    else {
        panic!("expected RPC error");
    };
    assert!(error.message.contains("Unknown model alias: missing-model"));
    assert!(!error.message.contains("sk-private"));
    assert!(!error.message.contains("private stack"));
    assert!(!error.message.contains("private conversation"));
}

#[test]
fn fs_sandbox_rejects_escape() {
    let root = std::env::temp_dir().join(format!("qoder-fs-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let err = confine_path_to_workspace(&root, "/etc/passwd", false).expect_err("escape");
    assert!(err.contains("escapes workspace root"), "{err}");
    let nested = confine_path_to_workspace(&root, "sub/file.txt", true).unwrap();
    assert!(nested.starts_with(std::fs::canonicalize(&root).unwrap()));
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn unknown_agent_request_returns_method_not_found() {
    let root = std::env::temp_dir();
    let response = answer_agent_request(&root, &json!(3), "totally/unknown", &json!({}));
    assert_eq!(response["error"]["code"], json!(JSONRPC_METHOD_NOT_FOUND));
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
    // No current model: the first entry becomes the default.
    let result = json!({"models": {"availableModels": [{"modelId": "a"}]}});
    let models = parse_models_from_session_new(&result);
    assert!(models[0].is_default);
}

#[test]
fn bypass_started_session_skips_set_mode() {
    // qodercli 1.1.78/1.1.79 report the internal "yolo" id for a session
    // started with --permission-mode bypass_permissions; set_mode on
    // that id fails with "unknown permission_mode: yolo".
    let started = json!({"sessionId": "s-1", "modes": {"currentModeId": "yolo"}});
    assert!(bypass_mode_active(&started));
    let legacy = json!({"modes": {"currentModeId": "bypassPermissions"}});
    assert!(bypass_mode_active(&legacy));
    // Trust/policy downgrade or a CLI that ignores the flag: switch.
    let downgraded = json!({"modes": {"currentModeId": "default"}});
    assert!(!bypass_mode_active(&downgraded));
    assert!(!bypass_mode_active(&json!({"sessionId": "s-1"})));
    assert_eq!(
        ACP_LAUNCH_ARGS,
        ["--acp", "--permission-mode", "bypass_permissions"]
    );
}

/// session/prompt carries PROMPT_TIMEOUT for every ACP driver (qoder,
/// grok/kimi, minimax, omp): a prompt silent past 30 minutes must still
/// end on its own response, not "session/prompt timed out". The paused
/// clock races the read loop's idle ticks forward; the 31 minutes start
/// once the CLI has the request, because the loop's clock starts only
/// after the write.
#[cfg(unix)]
#[tokio::test(start_paused = true)]
async fn a_prompt_silent_past_thirty_minutes_runs_to_its_own_response() {
    let directory =
        std::env::temp_dir().join(format!("ccgui-acp-long-prompt-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&directory).unwrap();
    let received = directory.join("received");
    let release = directory.join("release");
    let response = json!({ "jsonrpc": "2.0", "id": 1, "result": { "stopReason": "end_turn" } });
    let mut command = Command::new("sh");
    command.args([
        "-c",
        &format!(
            "read request; : > '{}'; while [ ! -e '{}' ]; do sleep 0.05; done; echo '{response}'; exec sleep 30",
            received.display(),
            release.display(),
        ),
    ]);
    let mut spawned = spawn_piped_acp(&mut command, "sh", &directory).unwrap();
    let killed = AtomicBool::new(false);
    let mut on_update = |_: &Value| {};
    let (result, silent_for) = tokio::join!(
        spawned.acp.request(
            "session/prompt",
            json!({ "sessionId": "s-1", "prompt": [] }),
            PROMPT_TIMEOUT,
            &killed,
            Some("s-1"),
            &mut on_update,
        ),
        async {
            while !received.exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            let quiet_since = Instant::now();
            tokio::time::sleep(Duration::from_secs(31 * 60)).await;
            std::fs::write(&release, b"").unwrap();
            quiet_since.elapsed()
        },
    );
    teardown(&mut spawned.child).await;
    let _ = std::fs::remove_dir_all(&directory);
    assert_eq!(result.unwrap(), json!({ "stopReason": "end_turn" }));
    assert!(silent_for >= Duration::from_secs(31 * 60), "{silent_for:?}");
}

/// Without a wall-clock cap, Stop is what ends a hung prompt: the loop
/// sends session/cancel and, when the CLI never answers, still gives up
/// after the settle window instead of waiting forever.
#[cfg(unix)]
#[tokio::test(start_paused = true)]
async fn stopping_a_hung_prompt_gives_up_after_the_settle_window() {
    let directory =
        std::env::temp_dir().join(format!("ccgui-acp-hung-prompt-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&directory).unwrap();
    let received = directory.join("received");
    let mut command = Command::new("sh");
    // The shell keeps stdout open (a hung CLI, not an exited one) while
    // cat records what the driver sends.
    command.args([
        "-c",
        &format!("cat > '{}'; exec sleep 30", received.display()),
    ]);
    let mut spawned = spawn_piped_acp(&mut command, "sh", &directory).unwrap();
    let killed = AtomicBool::new(false);
    let mut on_update = |_: &Value| {};
    // A broken settle window would spin forever; the outer bound turns
    // that into a failure (it costs nothing on the paused clock).
    let (result, stopped_at) = timeout(Duration::from_secs(40 * 60), async {
        tokio::join!(
            spawned.acp.request(
                "session/prompt",
                json!({ "sessionId": "s-1", "prompt": [] }),
                PROMPT_TIMEOUT,
                &killed,
                Some("s-1"),
                &mut on_update,
            ),
            async {
                tokio::time::sleep(Duration::from_secs(31 * 60)).await;
                killed.store(true, Ordering::SeqCst);
                Instant::now()
            },
        )
    })
    .await
    .expect("Stop must end a hung prompt");
    let settled_in = stopped_at.elapsed();
    let sent = recorded(&received, "\"session/cancel\"");
    teardown(&mut spawned.child).await;
    let _ = std::fs::remove_dir_all(&directory);
    assert_eq!(result.unwrap_err(), CANCELLED);
    assert!(
        settled_in <= CANCEL_SETTLE_TIMEOUT + KILL_POLL * 2,
        "{settled_in:?}"
    );
    assert!(sent.contains("\"session/cancel\""), "{sent}");
}

/// Paused time races past the child process, so wait on the wall clock
/// for `cat` to record what the driver sent before tearing it down.
#[cfg(unix)]
fn recorded(path: &Path, needle: &str) -> String {
    for _ in 0..300 {
        let sent = std::fs::read_to_string(path).unwrap_or_default();
        if sent.contains(needle) {
            return sent;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    std::fs::read_to_string(path).unwrap_or_default()
}

#[test]
fn session_state_follows_only_what_changed() {
    // qodercli 1.1.89 repeats its whole config after every slash command.
    let config = |model: &str, effort: &str| {
        json!({"update": {"sessionUpdate": "config_option_update", "configOptions": [
            {"type": "select", "id": "mode", "category": "mode", "currentValue": "default", "options": []},
            {"type": "select", "id": "model", "category": "model", "currentValue": model, "options": []},
            {"type": "select", "id": "reasoning_effort", "category": "thought_level", "currentValue": effort, "options": []}
        ]}})
    };
    let mut known = AcpSessionState {
        mode: Some("default".into()),
        model: Some("auto".into()),
        effort: Some("medium".into()),
        ..Default::default()
    };
    let same = session_state_update(&config("auto", "medium")).unwrap();
    assert!(known.follow(same).is_empty());
    let switched = session_state_update(&config("ultimate", "medium")).unwrap();
    match &known.follow(switched)[..] {
        [EngineEvent::SessionChoice {
            model: Some(model),
            effort: None,
        }] => {
            assert_eq!(model, "ultimate")
        }
        other => panic!("expected a model change, got {other:?}"),
    }
    let mode =
        json!({"update": {"sessionUpdate": "current_mode_update", "currentModeId": "acceptEdits"}});
    let reported = session_state_update(&mode).unwrap();
    assert_eq!(
        misty_mode_id(reported.mode.as_deref().unwrap()),
        "accept_edits"
    );
    let title =
        json!({"update": {"sessionUpdate": "session_info_update", "title": " Fix the build "}});
    match &AcpSessionState::default().follow(session_state_update(&title).unwrap())[..] {
        [EngineEvent::SessionTitle(title)] => assert_eq!(title, "Fix the build"),
        other => panic!("expected a title, got {other:?}"),
    }
    let chunk = json!({"update": {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "hi"}}});
    assert!(session_state_update(&chunk).is_none());
}
