// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/codebuddy.rs.
use super::{
    claude::ClaudeEngine, command_for_binary, images, BuiltCommand, Engine, EngineEvent,
    SendRequest,
};
use serde_json::{json, Value};

const SKIP_QUESTION_ACTION: &str = "skip_question";

pub(super) fn question_response(
    request_id: &str,
    context: &Value,
    answers: Option<Value>,
) -> Result<Value, String> {
    let answers = match answers {
        Some(Value::Object(answers)) if !answers.is_empty() => answer_texts(answers)?,
        Some(Value::Object(_)) | None => {
            serde_json::Map::from_iter([("_action".to_string(), json!(SKIP_QUESTION_ACTION))])
        }
        Some(_) => return Err("question answers must be an object".to_string()),
    };
    let mut input = context["input"].as_object().cloned().unwrap_or_default();
    input.insert("answers".into(), Value::Object(answers));
    Ok(json!({
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": request_id,
            "response": {
                "allowed": true,
                "tool_use_id": context["toolUseId"],
                "updatedInput": Value::Object(input),
            },
        },
    }))
}

fn answer_texts(
    answers: serde_json::Map<String, Value>,
) -> Result<serde_json::Map<String, Value>, String> {
    answers
        .into_iter()
        .map(|(question, answer)| {
            let text = match answer {
                Value::String(text) => text,
                Value::Array(labels) => labels
                    .iter()
                    .map(|label| label.as_str().ok_or_else(|| malformed_answer(&question)))
                    .collect::<Result<Vec<_>, _>>()?
                    .join(", "),
                _ => return Err(malformed_answer(&question)),
            };
            Ok((question, Value::String(text)))
        })
        .collect()
}

fn malformed_answer(question: &str) -> String {
    format!("answer to \"{question}\" must be a string or a list of strings")
}

const CHANNEL_SETTINGS_ENV_KEYS: &[&str] = &[
    "CODEBUDDY_BASE_URL",
    "CODEBUDDY_API_KEY",
    "CODEBUDDY_MODEL",
    "CODEBUDDY_INTERNET_ENVIRONMENT",
];

pub(super) fn apply_channel(
    built: &mut BuiltCommand,
    env: &std::collections::HashMap<String, String>,
    model: Option<&str>,
    directory: &std::path::Path,
) -> Result<(), String> {
    let mut overlay = serde_json::Map::new();
    for key in CHANNEL_SETTINGS_ENV_KEYS {
        overlay.insert(key.to_string(), serde_json::Value::String(String::new()));
    }
    for (key, value) in env {
        overlay.insert(key.clone(), serde_json::Value::String(value.clone()));
    }
    let mut settings = serde_json::json!({ "env": overlay });
    let model = model.map(str::trim).filter(|m| !m.is_empty()).or_else(|| {
        env.get("CODEBUDDY_MODEL")
            .map(String::as_str)
            .map(str::trim)
            .filter(|m| !m.is_empty())
    });
    if let Some(model) = model {
        settings["model"] = serde_json::Value::String(model.to_string());
    }
    stage_overlay(built, &settings, directory)
}

fn stage_overlay(
    built: &mut BuiltCommand,
    settings: &serde_json::Value,
    directory: &std::path::Path,
) -> Result<(), String> {
    let path = stage_private_json(directory, "channel", settings)?;
    built.cleanup_files.push(path.clone());
    built.command.arg("--settings").arg(path);
    Ok(())
}

pub(super) fn stage_private_json(
    directory: &std::path::Path,
    prefix: &str,
    value: &serde_json::Value,
) -> Result<std::path::PathBuf, String> {
    stage_private_json_with_writer(directory, prefix, value, |file, content| {
        use std::io::Write;
        file.write_all(content)
    })
}

fn stage_private_json_with_writer(
    directory: &std::path::Path,
    prefix: &str,
    value: &serde_json::Value,
    write: impl FnOnce(&mut file_access::fs::File, &[u8]) -> std::io::Result<()>,
) -> Result<std::path::PathBuf, String> {
    let content = serde_json::to_vec(value)
        .map_err(|_| format!("Cannot serialize CodeBuddy {prefix} settings"))?;
    file_access::fs::create_dir_all(directory)
        .map_err(|e| format!("create CodeBuddy staging directory: {e}"))?;
    let path = directory.join(format!("{prefix}-{}.json", uuid::Uuid::new_v4()));
    let mut options = file_access::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        options.mode(0o600);
    }
    let mut file = options
        .open(&path)
        .map_err(|e| format!("create private CodeBuddy settings: {e}"))?;
    if let Err(error) = write(&mut file, &content) {
        drop(file);
        let _ = file_access::fs::remove_file(&path);
        return Err(format!("write private CodeBuddy settings: {error}"));
    }
    Ok(path)
}
pub struct CodeBuddyEngine {
    inner: ClaudeEngine,
}

impl CodeBuddyEngine {
    pub fn new() -> Self {
        Self {
            inner: ClaudeEngine::reporting_as("codebuddy"),
        }
    }
}

impl Default for CodeBuddyEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine for CodeBuddyEngine {
    fn id(&self) -> &'static str {
        "codebuddy"
    }

    fn supports_images(&self) -> bool {
        true
    }

    fn supports_mcp(&self) -> bool {
        true
    }
    fn supports_web_search(&self) -> bool {
        true
    }
    fn supports_effort(&self) -> bool {
        true
    }

    fn modes_help_flag(&self) -> Option<&'static str> {
        Some("--permission-mode")
    }
    fn modes(&self) -> &'static [super::modes::EngineMode] {
        use super::modes::{mode, ModeKind::*};
        const MODES: &[super::modes::EngineMode] = &[
            mode("default", "Default", Asks, "manual"),
            mode("auto", "Auto", Edits, "auto"),
            mode("plan", "Plan", Plans, "plan"),
        ];
        MODES
    }

    fn supports_tool_constraints(&self) -> bool {
        true
    }

    fn build_command(&self, req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
        let mut cmd = command_for_binary(bin);
        cmd.arg("-p");
        cmd.arg("--input-format");
        cmd.arg("stream-json");
        cmd.arg("--output-format");
        cmd.arg("stream-json");
        cmd.arg("--verbose");
        cmd.arg("--include-partial-messages");

        let mut preapproved: Vec<&str> = Vec::new();
        let mut cleanup_files: Vec<std::path::PathBuf> = Vec::new();
        let allowed: Vec<&str> = req
            .allowed_tools
            .as_deref()
            .map(|tools| {
                tools
                    .iter()
                    .map(|t| t.trim())
                    .filter(|t| !t.is_empty())
                    .collect()
            })
            .unwrap_or_default();
        if req.allowed_tools.is_some() && allowed.is_empty() {
            return Err("tool constraints must not be empty".to_string());
        }

        let mcp_servers = req
            .mcp_servers
            .as_ref()
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        if !mcp_servers.is_empty() {
            let config = serde_json::json!({ "mcpServers": mcp_servers });
            let path = stage_private_json(
                &crate::engines::support::paths::app_home().join("codebuddy-staging"),
                "mcp",
                &config,
            )?;
            cleanup_files.push(path.clone());
            cmd.arg("--mcp-config").arg(path);
        }

        if !allowed.is_empty() {
            cmd.arg("--permission-mode");
            cmd.arg("plan");
            cmd.arg("--tools");
            cmd.arg(
                allowed
                    .iter()
                    .copied()
                    .chain(preapproved.iter().copied())
                    .collect::<Vec<_>>()
                    .join(","),
            );
            cmd.arg("--allowedTools");
            for tool in &allowed {
                cmd.arg(*tool);
            }
            for tool in &preapproved {
                cmd.arg(*tool);
            }
            let denied: Vec<&str> = [
                "Bash",
                "PowerShell",
                "Edit",
                "Write",
                "NotebookEdit",
                "Task",
                "Agent",
                "Workflow",
                "TeamCreate",
            ]
            .into_iter()
            .filter(|tool| !allowed.contains(tool))
            .collect();
            if !denied.is_empty() {
                cmd.arg("--disallowedTools");
                for tool in denied {
                    cmd.arg(tool);
                }
            }
        } else {
            let mode = self.resolve_permission(req.permission.as_deref());
            cmd.arg("--permission-mode");
            cmd.arg(match mode {
                "plan" => "plan",
                "auto" => "auto",
                "manual" => "default",
                _ => "acceptEdits",
            });
            if mode == "auto" {
                preapproved.extend(["WebSearch", "WebFetch"]);
            }
            if !preapproved.is_empty() {
                cmd.arg("--allowedTools");
                for tool in preapproved {
                    cmd.arg(tool);
                }
            }
        }

        if let Some(model) = req.model.as_deref() {
            let trimmed = model.trim();
            if !trimmed.is_empty() {
                cmd.arg("--model");
                cmd.arg(trimmed);
            }
        }

        if let Some(effort) = req.effort.as_deref() {
            let trimmed = effort.trim();
            if !trimmed.is_empty() {
                cmd.arg("--effort");
                cmd.arg(match trimmed {
                    "ultra" => "max",
                    other => other,
                });
            }
        }

        let mut seen_dirs = std::collections::HashSet::new();
        for dir in &req.additional_dirs {
            let dir = dir.trim();
            if dir.is_empty()
                || dir == req.workspace.to_string_lossy()
                || !seen_dirs.insert(dir.to_string())
            {
                continue;
            }
            cmd.arg("--add-dir");
            cmd.arg(dir);
        }

        if let Some(session_id) = req.session_id.as_deref() {
            cmd.arg("-r");
            cmd.arg(session_id);
        }

        let user_message = images::claude_stdin_message(&req.prompt, &req.images, &req.workspace)
            .inspect_err(|_| {
            super::cleanup_staged_files(&cleanup_files);
        })?;
        let initialize = json!({
            "type": "control_request",
            "request_id": uuid::Uuid::new_v4().to_string(),
            "request": {
                "subtype": "initialize",
                "hasPrompt": true,
                "capabilities": { "askUserQuestion": true },
            },
        });
        Ok(BuiltCommand {
            command: cmd,
            stdin_payload: Some(format!("{initialize}\n{user_message}")),
            keep_stdin_open: true,
            cleanup_files,
            preassigned_session_id: None,
        })
    }

    fn parse_line(&self, line: &str, out: &mut Vec<EngineEvent>) {
        self.inner.parse_line(line, out);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn sample_req() -> SendRequest {
        SendRequest {
            session_id: None,
            workspace: PathBuf::from("D:\\ws"),
            prompt: "say hello".to_string(),
            prompt_contributions: Vec::new(),
            native_compact: false,
            images: Vec::new(),
            model: Some("hy4-preview".to_string()),
            effort: Some("high".to_string()),
            service_tier: None,
            permission: Some("auto".to_string()),
            additional_dirs: Vec::new(),
            provider_id: None,
            mcp_servers: None,
            allowed_tools: None,
        }
    }

    #[test]
    fn never_spawns_credential_store_tools() {
        let source = include_str!("codebuddy.rs");
        for tool in ["cmdkey", "security", "/usr/bin/security", "secret-tool"] {
            let spawn = format!("Command::new(\"{tool}\")");
            assert!(!source.contains(&spawn), "codebuddy.rs spawns {tool}");
        }
    }

    struct ScratchHome {
        dir: PathBuf,
        previous_home: Option<std::ffi::OsString>,
        previous_profile: Option<std::ffi::OsString>,
        _lock: parking_lot::MutexGuard<'static, ()>,
    }

    impl ScratchHome {
        fn new(tag: &str) -> Self {
            let lock = crate::engines::support::paths::HOME_ENV_LOCK.lock();
            let dir = std::env::temp_dir()
                .join(format!("ccgui-codebuddy-{tag}-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            let previous_home = std::env::var_os("HOME");
            let previous_profile = std::env::var_os("USERPROFILE");
            std::env::set_var("HOME", &dir);
            std::env::set_var("USERPROFILE", &dir);
            Self {
                dir,
                previous_home,
                previous_profile,
                _lock: lock,
            }
        }
    }

    impl Drop for ScratchHome {
        fn drop(&mut self) {
            match &self.previous_home {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
            match &self.previous_profile {
                Some(value) => std::env::set_var("USERPROFILE", value),
                None => std::env::remove_var("USERPROFILE"),
            }
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn failed_private_json_write_removes_the_partial_file() {
        let dir = std::env::temp_dir().join(format!(
            "ccgui-codebuddy-write-failure-{}",
            uuid::Uuid::new_v4()
        ));
        let result = stage_private_json_with_writer(
            &dir,
            "channel",
            &serde_json::json!({"env":{"CODEBUDDY_API_KEY":"secret"}}),
            |file, content| {
                use std::io::Write;
                file.write_all(&content[..content.len() / 2])?;
                Err(std::io::Error::new(
                    std::io::ErrorKind::WriteZero,
                    "injected write failure",
                ))
            },
        );
        assert!(result.unwrap_err().contains("injected write failure"));
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn image_payload_failure_cleans_staged_mcp_config() {
        let home = ScratchHome::new("image-cleanup");
        let staging = home.dir.join(".misty/shared/engines/codebuddy-staging");
        let mut req = sample_req();
        req.mcp_servers = Some(serde_json::json!({
            "misty": { "type": "http", "url": "http://127.0.0.1:1/mcp", "headers": { "Authorization": "Bearer t" } },
        }));
        req.images = vec!["data:image/png;base64,not-valid-base64".to_string()];

        let error = CodeBuddyEngine::new()
            .build_command(&req, "codebuddy")
            .err()
            .expect("an invalid image must fail command construction");
        assert!(error.contains("invalid base64"));
        assert_eq!(
            std::fs::read_dir(&staging).unwrap().count(),
            0,
            "the staged MCP config (including any overlay token) must not survive a failed launch"
        );
    }

    #[test]
    fn engine_metadata_and_capabilities() {
        let engine = CodeBuddyEngine::new();
        assert_eq!(engine.id(), "codebuddy");
        assert!(engine.supports_images());
        assert!(engine.supports_effort());
        assert!(engine.supports_mcp());
        assert!(engine.supports_tool_constraints());
        assert_eq!(engine.supported_permissions(), &["manual", "auto", "plan"]);
    }

    #[test]
    fn build_command_flags() {
        let engine = CodeBuddyEngine::new();
        let mut req = sample_req();
        req.session_id = Some("sess-123".to_string());
        let built = engine.build_command(&req, "codebuddy").unwrap();
        let debug = format!("{:?}", built.command);
        assert!(debug.contains("-p"));
        assert!(debug.contains("--input-format"));
        assert!(debug.contains("stream-json"));
        assert!(debug.contains("--output-format"));
        assert!(debug.contains("--verbose"));
        assert!(debug.contains("--include-partial-messages"));
        assert!(debug.contains("--permission-mode"));
        assert!(debug.contains("auto"));
        assert!(debug.contains("--model"));
        assert!(debug.contains("hy4-preview"));
        assert!(debug.contains("--effort"));
        assert!(debug.contains("high"));
        assert!(debug.contains("-r"));
        assert!(debug.contains("sess-123"));
    }

    #[test]
    fn initializes_question_capability_before_sending_prompt() {
        let engine = CodeBuddyEngine::new();
        let mut req = sample_req();
        req.session_id = Some("existing-session".into());
        let built = engine.build_command(&req, "codebuddy").unwrap();
        assert!(built.keep_stdin_open);
        let payload = built.stdin_payload.unwrap();
        let frames: Vec<Value> = payload
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0]["type"], "control_request");
        assert!(frames[0]["request_id"]
            .as_str()
            .is_some_and(|id| !id.is_empty()));
        assert_eq!(
            frames[0]["request"],
            json!({
                "subtype": "initialize",
                "hasPrompt": true,
                "capabilities": { "askUserQuestion": true },
            })
        );
        assert_eq!(frames[1]["type"], "user");
        assert_eq!(frames[1]["message"]["content"][0]["text"], req.prompt);
    }

    #[test]
    fn question_callback_round_trips_with_codebuddy_response_shape() {
        let engine = CodeBuddyEngine::new();
        let input = json!({"questions": [], "metadata": {"source": "test"}});
        let callback = json!({
            "type": "control_request",
            "request_id": "req",
            "request": {
                "subtype": "can_use_tool",
                "tool_name": "AskUserQuestion",
                "tool_use_id": "tool",
                "input": input,
            },
        });
        let mut events = Vec::new();
        engine.parse_line(&callback.to_string(), &mut events);
        let [EngineEvent::Question {
            request_id,
            tool_use_id,
            input: parsed,
        }] = events.as_slice()
        else {
            panic!("expected a question event");
        };
        assert_eq!(parsed, &input);
        let context = json!({"input": parsed, "toolUseId": tool_use_id});
        let frame = question_response(
            request_id,
            &context,
            Some(json!({"单选": "甲", "多选": ["乙", "丙"]})),
        )
        .unwrap();
        assert_eq!(frame["type"], "control_response");
        assert_eq!(frame["response"]["request_id"], "req");
        assert_eq!(
            frame["response"]["response"],
            json!({
                "allowed": true,
                "tool_use_id": "tool",
                "updatedInput": {
                    "questions": [],
                    "metadata": {"source": "test"},
                    "answers": {"单选": "甲", "多选": "乙, 丙"},
                },
            }),
        );
    }

    #[test]
    fn skipped_question_uses_codebuddys_native_skip_not_a_denial() {
        let context = json!({
            "input": {"questions": [{"question": "Q?"}]},
            "toolUseId": "tool",
        });
        for answers in [None, Some(json!({}))] {
            let frame = question_response("req", &context, answers).unwrap();
            assert_eq!(frame["response"]["request_id"], "req");
            assert_eq!(
                frame["response"]["response"],
                json!({
                    "allowed": true,
                    "tool_use_id": "tool",
                    "updatedInput": {
                        "questions": [{"question": "Q?"}],
                        "answers": {"_action": "skip_question"},
                    },
                }),
            );
        }
    }

    #[test]
    fn malformed_question_answers_are_rejected() {
        let context = json!({"input": {"questions": []}, "toolUseId": "tool"});
        for answers in [
            json!("甲"),
            json!(["甲"]),
            json!({"Q?": 1}),
            json!({"Q?": ["甲", 2]}),
            json!({"Q?": null}),
        ] {
            assert!(
                question_response("req", &context, Some(answers.clone())).is_err(),
                "accepted {answers}"
            );
        }
    }

    #[test]
    fn build_command_ultra_effort_maps_to_max() {
        let engine = CodeBuddyEngine::new();
        let mut req = sample_req();
        req.effort = Some("ultra".to_string());
        let built = engine.build_command(&req, "codebuddy").unwrap();
        let debug = format!("{:?}", built.command);
        assert!(debug.contains("--effort"));
        assert!(debug.contains("max"));
    }

    #[test]
    fn build_command_never_passes_dash_y() {
        let engine = CodeBuddyEngine::new();
        let mut req = sample_req();
        req.permission = Some("bypass".to_string());
        let built = engine.build_command(&req, "codebuddy").unwrap();
        let args: Vec<String> = built
            .command
            .as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert!(!args.contains(&"-y".to_string()), "{args:?}");
        assert!(args
            .windows(2)
            .any(|w| w == ["--permission-mode", "default"]));
    }

    #[test]
    fn read_only_whitelist_denies_shell_and_subagent_tools() {
        let engine = CodeBuddyEngine::new();
        let args_of = |allowed: Vec<String>| {
            let mut req = sample_req();
            req.allowed_tools = Some(allowed);
            let built = engine.build_command(&req, "codebuddy").unwrap();
            built
                .command
                .as_std()
                .get_args()
                .map(|a| a.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
        };

        let args = args_of(vec!["Read".to_string(), "Glob".to_string()]);
        let whitelist = &args[args
            .iter()
            .position(|a| a == "--tools")
            .expect("--tools must be emitted")
            + 1];
        let listed: Vec<&str> = whitelist.split(',').collect();
        assert_eq!(listed, ["Read", "Glob"]);
        for tool in ["Bash", "Edit", "Write", "PowerShell"] {
            assert!(!listed.contains(&tool), "whitelist must not contain {tool}");
        }

        let denied = &args[args
            .iter()
            .position(|a| a == "--disallowedTools")
            .expect("--disallowedTools must be emitted")
            + 1..];
        for tool in [
            "Bash",
            "PowerShell",
            "Edit",
            "Write",
            "NotebookEdit",
            "Task",
            "Agent",
            "Workflow",
            "TeamCreate",
        ] {
            assert!(denied.iter().any(|a| a == tool), "missing deny for {tool}");
        }

        let args = args_of(vec!["Bash".to_string()]);
        let denied = &args[args.iter().position(|a| a == "--disallowedTools").unwrap() + 1..];
        assert!(!denied.iter().any(|a| a == "Bash"));
    }

    #[test]
    fn channel_env_rides_staged_settings_file_never_argv() {
        let mut built = BuiltCommand {
            command: tokio::process::Command::new("codebuddy"),
            stdin_payload: None,
            keep_stdin_open: false,
            cleanup_files: Vec::new(),
            preassigned_session_id: None,
        };
        let env = std::collections::HashMap::from([
            (
                "CODEBUDDY_BASE_URL".to_string(),
                "https://copilot.tencent.com".to_string(),
            ),
            ("CODEBUDDY_API_KEY".to_string(), "sk-test".to_string()),
            (
                "CODEBUDDY_INTERNET_ENVIRONMENT".to_string(),
                "internal".to_string(),
            ),
        ]);
        let dir =
            std::env::temp_dir().join(format!("ccgui-codebuddy-stage-{}", uuid::Uuid::new_v4()));
        apply_channel(&mut built, &env, None, &dir).unwrap();
        let args: Vec<_> = built
            .command
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(args.len(), 2);
        assert_eq!(args[0], "--settings");
        assert!(
            args.iter().all(|a| !a.contains("sk-test")),
            "api key leaked onto argv: {args:?}"
        );
        assert_eq!(built.cleanup_files.len(), 1);
        let staged_path = &built.cleanup_files[0];
        assert_eq!(args[1], staged_path.to_string_lossy());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(staged_path).unwrap().permissions().mode() & 0o777,
                0o600,
                "staged settings must be private"
            );
        }
        let staged: serde_json::Value =
            serde_json::from_slice(&std::fs::read(staged_path).unwrap()).unwrap();
        assert_eq!(
            staged["env"]["CODEBUDDY_BASE_URL"],
            "https://copilot.tencent.com"
        );
        assert_eq!(staged["env"]["CODEBUDDY_API_KEY"], "sk-test");
        assert_eq!(staged["env"]["CODEBUDDY_INTERNET_ENVIRONMENT"], "internal");
        assert_eq!(staged["env"]["CODEBUDDY_MODEL"], "");
        super::super::cleanup_staged_files(&built.cleanup_files);
        assert!(!staged_path.exists());
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn channel_overlay_mirrors_selected_model() {
        let mut built = BuiltCommand {
            command: tokio::process::Command::new("codebuddy"),
            stdin_payload: None,
            keep_stdin_open: false,
            cleanup_files: Vec::new(),
            preassigned_session_id: None,
        };
        let dir =
            std::env::temp_dir().join(format!("ccgui-codebuddy-model-{}", uuid::Uuid::new_v4()));
        apply_channel(
            &mut built,
            &std::collections::HashMap::new(),
            Some(" glm-5.3 "),
            &dir,
        )
        .unwrap();
        let staged_path = built.cleanup_files[0].clone();
        let staged: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&staged_path).unwrap()).unwrap();
        assert_eq!(staged["model"], "glm-5.3");
        super::super::cleanup_staged_files(&built.cleanup_files);
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn tool_flags_never_dangle_when_every_deniable_tool_is_allowed() {
        let engine = CodeBuddyEngine::new();
        let mut req = sample_req();
        req.allowed_tools = Some(
            [
                "Bash",
                "PowerShell",
                "Edit",
                "Write",
                "NotebookEdit",
                "Task",
                "Agent",
                "Workflow",
                "TeamCreate",
            ]
            .into_iter()
            .map(str::to_string)
            .collect(),
        );
        let built = engine.build_command(&req, "codebuddy").unwrap();
        let args: Vec<String> = built
            .command
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert!(!args.iter().any(|a| a == "--disallowedTools"));
        for (index, arg) in args.iter().enumerate() {
            if matches!(
                arg.as_str(),
                "--tools"
                    | "--allowedTools"
                    | "--disallowedTools"
                    | "--model"
                    | "--effort"
                    | "--permission-mode"
            ) {
                let next = args
                    .get(index + 1)
                    .unwrap_or_else(|| panic!("{arg} has no value"));
                assert!(
                    !next.starts_with('-'),
                    "{arg} swallowed the next flag: {next}"
                );
            }
        }
    }

    #[test]
    fn blank_allowed_tools_are_rejected_fail_closed() {
        let engine = CodeBuddyEngine::new();
        let mut req = sample_req();
        req.allowed_tools = Some(vec!["  ".to_string(), String::new()]);
        let error = engine
            .build_command(&req, "codebuddy")
            .err()
            .expect("a present but empty tool whitelist must be rejected");
        assert_eq!(error, "tool constraints must not be empty");
    }

    #[test]
    fn parse_line_delegates_to_claude_parser() {
        let engine = CodeBuddyEngine::new();
        let mut out = Vec::new();
        let sample = r#"{"type":"assistant","uuid":"u1","session_id":"s1","message":{"id":"m1","content":[{"type":"text","text":"hello world"}],"model":"custom:kimi-k3","role":"assistant"}}"#;
        engine.parse_line(sample, &mut out);
        assert!(out
            .iter()
            .any(|e| matches!(e, EngineEvent::SessionId(id) if id == "s1")));
        assert!(out
            .iter()
            .any(|e| matches!(e, EngineEvent::Model(model) if model == "custom:kimi-k3")));
    }
}
