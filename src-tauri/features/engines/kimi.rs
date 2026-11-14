// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/kimi.rs.
use super::{command_for_binary, BuiltCommand, Engine, SendRequest};
use std::collections::HashMap;

pub struct KimiEngine;

pub(super) fn apply_channel(
    command: &mut tokio::process::Command,
    env: &HashMap<String, String>,
    req: &SendRequest,
) -> Result<(), String> {
    let value = |key: &str| {
        env.get(key)
            .map(String::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
    };
    let model = req
        .model
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| value("KIMI_MODEL_NAME"))
        .ok_or("Select a model for the Kimi channel before sending")?;
    let api_key = value("KIMI_MODEL_API_KEY")
        .or_else(|| value("KIMI_API_KEY"))
        .ok_or("The selected Kimi channel has no API key")?;
    let provider_type = value("KIMI_MODEL_PROVIDER_TYPE").unwrap_or("openai");
    if !matches!(provider_type, "openai" | "anthropic" | "kimi") {
        return Err("Unsupported Kimi channel provider type".into());
    }
    command.env("KIMI_MODEL_NAME", model);
    command.env("KIMI_MODEL_API_KEY", api_key);
    command.env("KIMI_MODEL_PROVIDER_TYPE", provider_type);
    if let Some(base_url) = value("KIMI_MODEL_BASE_URL").or_else(|| value("KIMI_BASE_URL")) {
        command.env("KIMI_MODEL_BASE_URL", base_url);
    } else {
        command.env_remove("KIMI_MODEL_BASE_URL");
    }
    if let Some(effort) = req
        .effort
        .as_deref()
        .map(str::trim)
        .filter(|e| !e.is_empty())
    {
        command.env("KIMI_MODEL_THINKING_EFFORT", effort);
    }
    Ok(())
}

impl Engine for KimiEngine {
    fn id(&self) -> &'static str {
        "kimi"
    }

    fn drives_own_transport(&self) -> bool {
        true
    }

    fn host_command(&self, _req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
        let mut command = command_for_binary(bin);
        command.arg("acp");
        Ok(BuiltCommand {
            command,
            stdin_payload: None,
            keep_stdin_open: true,
            cleanup_files: Vec::new(),
            preassigned_session_id: None,
        })
    }

    fn supports_images(&self) -> bool {
        true
    }
    fn supports_effort(&self) -> bool {
        true
    }
    /// Kimi Code's ACP session modes (`session/set_mode`, `acp-server/src/modes.ts`): `default`,
    /// where each ask comes back through ACP, `plan`, and `auto`, which approves safe operations
    /// itself. Its YOLO isn't offered: Kimi has no sandbox that keeps it inside its folder.
    fn modes(&self) -> &'static [super::modes::EngineMode] {
        use super::modes::{mode, ModeKind::*};
        const MODES: &[super::modes::EngineMode] = &[
            mode("default", "Default", Asks, "manual"),
            mode("plan", "Plan", Plans, "plan"),
            mode("auto", "Auto", Edits, "auto"),
        ];
        MODES
    }
    fn supports_mcp(&self) -> bool {
        true
    }
}

#[cfg(test)]
mod channel_tests {
    use super::*;

    #[test]
    fn kimi_uses_interactive_transport() {
        assert!(KimiEngine.drives_own_transport());
        let req = SendRequest {
            session_id: None,
            workspace: std::env::temp_dir(),
            prompt: "ask".into(),
            prompt_contributions: vec![],
            native_compact: false,
            images: vec![],
            model: Some("native-model".into()),
            effort: Some("medium".into()),
            service_tier: None,
            permission: Some("auto".into()),
            additional_dirs: vec![],
            provider_id: None,
            mcp_servers: None,
            allowed_tools: None,
        };
        let built = KimiEngine.host_command(&req, "kimi").unwrap();
        let args: Vec<_> = built.command.as_std().get_args().collect();
        assert_eq!(args, ["acp"]);
        assert!(built.keep_stdin_open);
    }

    #[test]
    fn independent_channel_sets_an_ephemeral_model() {
        let mut req = SendRequest {
            session_id: Some("existing-session".into()),
            workspace: std::env::temp_dir(),
            prompt: "routing probe".into(),
            prompt_contributions: vec![],
            native_compact: false,
            images: vec![],
            model: Some("selected-model".into()),
            effort: None,
            service_tier: None,
            permission: Some("auto".into()),
            additional_dirs: vec![],
            provider_id: Some("plugin_model-switcher_probe".into()),
            mcp_servers: None,
            allowed_tools: None,
        };
        let mut env = HashMap::from([
            ("KIMI_BASE_URL".into(), "https://selected.invalid/v1".into()),
            ("KIMI_API_KEY".into(), "test-selected".into()),
            ("KIMI_MODEL_NAME".into(), "channel-default".into()),
        ]);
        let mut built = KimiEngine.host_command(&req, "kimi").unwrap();
        built.command.envs(&env);
        apply_channel(&mut built.command, &env, &req).unwrap();
        let injected: HashMap<_, _> = built
            .command
            .as_std()
            .get_envs()
            .map(|(k, v)| (k.to_str().unwrap(), v.and_then(|s| s.to_str())))
            .collect();
        assert_eq!(injected["KIMI_MODEL_NAME"], Some("selected-model"));
        assert_eq!(injected["KIMI_MODEL_API_KEY"], Some("test-selected"));
        assert_eq!(
            injected["KIMI_MODEL_BASE_URL"],
            Some("https://selected.invalid/v1")
        );
        assert_eq!(injected["KIMI_MODEL_PROVIDER_TYPE"], Some("openai"));
        assert!(apply_channel(&mut built.command, &HashMap::new(), &req).is_err());
        env.insert("KIMI_MODEL_PROVIDER_TYPE".into(), "invalid-provider".into());
        assert!(apply_channel(&mut built.command, &env, &req).is_err());
        env.insert("KIMI_MODEL_PROVIDER_TYPE".into(), "anthropic".into());
        env.insert("KIMI_MODEL_API_KEY".into(), "test-modern".into());
        env.insert(
            "KIMI_MODEL_BASE_URL".into(),
            "https://modern.invalid".into(),
        );
        req.model = None;
        apply_channel(&mut built.command, &env, &req).unwrap();
        let injected: HashMap<_, _> = built
            .command
            .as_std()
            .get_envs()
            .map(|(k, v)| (k.to_str().unwrap(), v.and_then(|s| s.to_str())))
            .collect();
        assert_eq!(injected["KIMI_MODEL_NAME"], Some("channel-default"));
        assert_eq!(injected["KIMI_MODEL_API_KEY"], Some("test-modern"));
        assert_eq!(
            injected["KIMI_MODEL_BASE_URL"],
            Some("https://modern.invalid")
        );
        assert_eq!(injected["KIMI_MODEL_PROVIDER_TYPE"], Some("anthropic"));
        env.remove("KIMI_BASE_URL");
        env.remove("KIMI_MODEL_BASE_URL");
        apply_channel(&mut built.command, &env, &req).unwrap();
        assert!(built
            .command
            .as_std()
            .get_envs()
            .any(|(k, v)| k == "KIMI_MODEL_BASE_URL" && v.is_none()));
        let mut missing_model = env.clone();
        missing_model.remove("KIMI_MODEL_NAME");
        assert!(apply_channel(&mut built.command, &missing_model, &req).is_err());
    }
}
