// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/codex.rs.
use super::*;
use crate::engines::{Engine, EngineEvent};

fn argv(req: &SendRequest) -> Vec<String> {
    CodexEngine
        .build_command(req, "fake-bin")
        .unwrap()
        .command
        .as_std()
        .get_args()
        .map(|a| a.to_string_lossy().to_string())
        .collect()
}

fn base_req() -> SendRequest {
    SendRequest {
        session_id: None,
        workspace: std::path::PathBuf::from("/tmp"),
        prompt: "hi".into(),
        prompt_contributions: Vec::new(),
        native_compact: false,
        images: Vec::new(),
        model: Some("gpt-6-astra".into()),
        effort: None,
        service_tier: None,
        permission: Some("auto".into()),
        additional_dirs: Vec::new(),
        provider_id: None,
        mcp_servers: None,
        allowed_tools: None,
    }
}

fn channel_command(provider: &Value, req: &SendRequest) -> tokio::process::Command {
    let mut built = CodexEngine.build_command(req, "fake-bin").unwrap();
    let env = crate::engines::support::provider_files::channel_env("codex", provider).unwrap();
    built.command.envs(&env);
    apply_channel(&mut built.command, provider, &env, req).unwrap();
    built.command
}

fn overrides(command: &tokio::process::Command) -> toml::Table {
    let args: Vec<_> = command
        .as_std()
        .get_args()
        .map(|s| s.to_string_lossy())
        .collect();
    let mut result = toml::Table::new();
    for pair in args.windows(2) {
        if pair[0] == "-c" {
            result.extend(toml::from_str::<toml::Table>(&pair[1]).unwrap());
        }
    }
    result
}

/// Codex declares typed next_turn plan review, and plan is back in its supported list (so
/// resolve_permission no longer silently falls back to auto).
#[test]
fn plan_approval_is_typed_next_turn_and_advertised() {
    assert!(CodexEngine.supported_permissions().contains(&"plan"));
    match CodexEngine.plan_approval() {
        crate::engines::plan_review::PlanApproval::Typed {
            review_kind,
            evidence,
            limitations,
        } => {
            assert_eq!(
                review_kind,
                crate::engines::plan_review::PlanReviewKind::NextTurn
            );
            assert!(evidence.contains("collaborationMode"), "{evidence}");
            assert!(!limitations.is_empty());
        }
        other => panic!("codex must declare typed next_turn plan approval, got {other:?}"),
    }
}

/// The exec/WSL fallback has no collaborationMode protocol: an explicit plan request must fail
/// closed, never silently become workspace-write through resolve_permission.
#[test]
fn exec_path_refuses_plan_permission() {
    let mut req = base_req();
    req.permission = Some("plan".into());
    let error = match CodexEngine.build_command(&req, "fake-bin") {
        Err(error) => error,
        Ok(_) => panic!("the exec/WSL path must refuse an explicit plan request"),
    };
    assert!(error.contains("app-server"), "{error}");
}

#[test]
fn toml_string_escapes_paths_that_would_read_as_escapes() {
    // codex parses the value as TOML: a bare quoted Windows path would
    // turn \t into a tab and \U into an escape.
    assert_eq!(toml_string(r"C:\tmp\x"), r#""C:\\tmp\\x""#);
    assert_eq!(toml_string("a\"b"), r#""a\"b""#);
}

#[test]
fn channel_toml_is_applied_for_new_and_resumed_sessions_without_auth_in_argv() {
    let provider = serde_json::json!({"settingsConfig": {
        "auth": {"OPENAI_API_KEY":"test-channel-secret"},
        "config": "disable_response_storage = true\nmodel_provider = \"relay\"\nmodel = \"channel-model\"\nmodel_reasoning_effort = \"low\"\n[model_providers.relay]\nname = \"Relay\"\nbase_url = \"https://relay.example/v1\"\nwire_api = \"responses\"\nrequires_openai_auth = true\n[model_providers.relay.http_headers]\nX-Route = \"channel\"\n"
    }});
    for session_id in [None, Some("existing-session".into())] {
        let mut req = base_req();
        req.session_id = session_id;
        req.effort = Some("high".into());
        let command = channel_command(&provider, &req);
        let config = overrides(&command);
        assert_eq!(config["model_provider"].as_str(), Some("relay"));
        assert_eq!(config["model_reasoning_effort"].as_str(), Some("high"));
        assert!(!config.contains_key("model"), "explicit -m wins");
        assert!(!config.contains_key("disable_response_storage"));
        let relay = &config["model_providers"]["relay"];
        assert_eq!(relay["base_url"].as_str(), Some("https://relay.example/v1"));
        assert!(relay.get("http_headers").is_none());
        let header_key = relay["env_http_headers"]["X-Route"].as_str().unwrap();
        assert!(command
            .as_std()
            .get_envs()
            .any(|(key, value)| key == header_key
                && value == Some(std::ffi::OsStr::new("channel"))));
        assert_eq!(relay["requires_openai_auth"].as_bool(), Some(false));
        assert_eq!(relay["env_key"].as_str(), Some("CCGUI_CODEX_API_KEY"));
        assert!(command
            .as_std()
            .get_envs()
            .any(|(k, v)| k == "CCGUI_CODEX_API_KEY"
                && v == Some(std::ffi::OsStr::new("test-channel-secret"))));
        assert!(!command
            .as_std()
            .get_args()
            .any(|s| s.to_string_lossy().contains("test-channel-secret")));
    }
}

#[test]
fn flat_channels_select_independent_providers_and_models() {
    let mut req = base_req();
    req.model = None;
    let a = channel_command(
        &serde_json::json!({"baseUrl":"https://a.example", "apiKey":"key-a", "model":"model-a"}),
        &req,
    );
    let b = channel_command(
        &serde_json::json!({"baseUrl":"https://b.example", "apiKey":"key-b", "model":"model-b"}),
        &req,
    );
    for (command, base, model) in [
        (&a, "https://a.example", "model-a"),
        (&b, "https://b.example", "model-b"),
    ] {
        let config = overrides(command);
        assert_eq!(config["model_provider"].as_str(), Some("ccgui"));
        assert_eq!(
            config["model_providers"]["ccgui"]["base_url"].as_str(),
            Some(base)
        );
        assert_eq!(config["model"].as_str(), Some(model));
    }
}

#[test]
fn channel_context_limits_are_process_overrides() {
    let provider = serde_json::json!({"settingsConfig": {"config":
        "model_context_window = 1000000\nmodel_auto_compact_token_limit = 900000"}});
    let command = channel_command(&provider, &base_req());
    let config = overrides(&command);
    assert_eq!(config["model_context_window"].as_integer(), Some(1_000_000));
    assert_eq!(
        config["model_auto_compact_token_limit"].as_integer(),
        Some(900_000)
    );
}

#[test]
fn malformed_channel_toml_fails_without_exposing_source() {
    let mut command = tokio::process::Command::new("codex");
    let provider =
        serde_json::json!({"settingsConfig":{"config":"key = super-secret-invalid-toml"}});
    let error =
        apply_channel(&mut command, &provider, &Default::default(), &base_req()).unwrap_err();
    assert_eq!(error, "Invalid Codex channel config.toml");
}

#[test]
fn effort_and_fast_tier_pass_through() {
    let mut req = base_req();
    req.effort = Some("ultra".into());
    req.service_tier = Some("priority".into());
    let args = argv(&req);
    assert!(args.iter().any(|a| a == "model_reasoning_effort=\"ultra\""));
    assert!(args.iter().any(|a| a == "service_tier=\"priority\""));
}

#[test]
fn max_effort_is_not_clamped_to_xhigh() {
    let mut req = base_req();
    req.effort = Some("max".into());
    let args = argv(&req);
    assert!(args.iter().any(|a| a == "model_reasoning_effort=\"max\""));
    assert!(!args.iter().any(|a| a.contains("xhigh")));
}

#[test]
fn host_command_carries_effort_override() {
    let mut req = base_req();
    req.effort = Some("high".into());
    let built = CodexEngine.host_command(&req, "fake-bin").unwrap();
    let args: Vec<String> = built
        .command
        .as_std()
        .get_args()
        .map(|a| a.to_string_lossy().to_string())
        .collect();
    assert!(args.iter().any(|a| a == "model_reasoning_effort=\"high\""));
}

/// Native identity makes Codex treat the app-server client as first-party,
/// which unlocks skill MCP-dependency auto-install. Under approval "never"
/// plus full access it writes the skill's MCP servers into the global
/// config.toml without asking (verified on codex 0.167, repo-provided
/// skills included), so every app-server launch must keep it off.
#[test]
fn host_command_disables_skill_mcp_dependency_install() {
    for permission in [Some("bypass"), Some("auto"), Some("plan"), None] {
        let mut req = base_req();
        req.permission = permission.map(str::to_string);
        let built = CodexEngine.host_command(&req, "fake-bin").unwrap();
        assert_eq!(
            overrides(&built.command)
                .get("features")
                .and_then(|features| features.get("skill_mcp_dependency_install")),
            Some(&toml::Value::Boolean(false)),
            "{permission:?}"
        );
        let args: Vec<String> = built
            .command
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        let flag = args
            .iter()
            .position(|a| a == "features.skill_mcp_dependency_install=false")
            .unwrap_or_else(|| panic!("{args:?}"));
        let subcommand = args
            .iter()
            .position(|a| a == "app-server")
            .unwrap_or_else(|| panic!("{args:?}"));
        assert!(flag < subcommand, "{args:?}");
    }
}

fn parse(line: &str) -> Vec<EngineEvent> {
    let mut out = Vec::new();
    CodexEngine.parse_line(line, &mut out);
    out
}

/// Captured live from `codex exec --json` against a mock endpoint that
/// drops the SSE stream: codex announces every retry as an `error` event
/// and only `turn.failed` ends the turn. Handling these as terminal
/// settled the UI — and killed the CLI — on the first reconnect, so the
/// turn died at 1/5 instead of continuing to completion.
#[test]
fn reconnect_notice_is_live_retry_progress() {
    let line = r#"{"type":"error","message":"Reconnecting... 1/5 (stream disconnected before completion: stream closed before response.completed)"}"#;
    match &parse(line)[..] {
        [EngineEvent::Retry {
            attempt,
            max,
            message,
        }] => {
            assert_eq!((*attempt, *max), (1, 5));
            assert!(message.contains("stream disconnected"));
        }
        other => panic!("expected live retry progress, got {other:?}"),
    }
}

/// The bare error line codex emits right before `turn.failed` repeats the
/// final message; the terminal signal is the `turn.failed` event itself.
#[test]
fn turn_failed_is_the_terminal_error() {
    // A non-reconnect error line is a notice, not retry progress.
    match &parse(
        r#"{"type":"error","message":"unexpected status 401 Unauthorized: Incorrect API key provided: x."}"#,
    )[..]
    {
        [EngineEvent::Warn(_)] => {}
        other => panic!("expected warn for the retry notice, got {other:?}"),
    }
    // turn.failed carries the terminal error text to the banner.
    match &parse(
        r#"{"type":"turn.failed","error":{"message":"unexpected status 401 Unauthorized: Incorrect API key provided: x."}}"#,
    )[..]
    {
        [EngineEvent::Error(message)] => assert!(message.contains("401 Unauthorized")),
        other => panic!("expected terminal error, got {other:?}"),
    }
}

/// A successful turn after retries must still complete normally.
#[test]
fn turn_completed_after_retries_still_dones() {
    let mut out = Vec::new();
    CodexEngine.parse_line(
        r#"{"type":"error","message":"Reconnecting... 2/5 (stream disconnected before completion: x)"}"#,
        &mut out,
    );
    CodexEngine.parse_line(r#"{"type":"turn.completed","usage":null}"#, &mut out);
    assert!(matches!(out[0], EngineEvent::Retry { .. }));
    assert!(matches!(out[1], EngineEvent::Done { .. }));
}

/// Help shape verified live against codex-cli 0.153.0: `--json` under
/// Options, `resume` under Commands.
#[test]
fn exec_help_gate_requires_json_flag_and_resume() {
    let current =
        "Usage: codex exec [OPTIONS] [PROMPT]\n\nCommands:\n  resume  Resume a previous session\n\nOptions:\n      --json";
    assert!(exec_help_supported(current, false));
    assert!(exec_help_supported(current, true));

    // Pre-exec-transport CLIs render no --json flag on exec.
    let legacy = "Usage: codex exec [OPTIONS] [PROMPT]\n\nOptions:\n  --full-auto";
    assert!(!exec_help_supported(legacy, false));

    // --json without the resume subcommand: new sessions fine,
    // continuing one must be refused with the upgrade message.
    let no_resume = "Usage: codex exec [OPTIONS] [PROMPT]\n\nOptions:\n      --json";
    assert!(exec_help_supported(no_resume, false));
    assert!(!exec_help_supported(no_resume, true));
}

/// A binary that cannot even be spawned must not be blocked by the
/// preflight: the real spawn's own error is clearer than a probe flake.
#[tokio::test]
async fn preflight_never_blocks_on_probe_flake() {
    assert!(check_exec_support("/nonexistent/codex-bin-xyz", true)
        .await
        .is_ok());
}
