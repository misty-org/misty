// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/grok.rs.
use super::{command_for_binary, BuiltCommand, Engine, SendRequest};
use serde_json::Value;

pub struct GrokEngine;

pub(super) fn isolate_channel(
    built: &mut BuiltCommand,
    provider: &Value,
    req: &SendRequest,
) -> Result<(), String> {
    stage_channel(
        built,
        provider,
        req.model.as_deref(),
        &super::engine_home(Some("GROK_HOME"), ".grok"),
        &crate::engines::support::paths::app_home().join("grok-staging"),
    )
}

fn stage_channel(
    built: &mut BuiltCommand,
    provider: &Value,
    model: Option<&str>,
    native_home: &std::path::Path,
    directory: &std::path::Path,
) -> Result<(), String> {
    let config = native_home.join("config.toml");
    let base = match read_native_config(&config) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(format!("read {}: {e}", config.display())),
    };
    let env = crate::engines::support::provider_files::channel_env("grok", provider)?;
    let content = crate::engines::support::provider_files::render_grok(&base, provider)?;
    let mut doc: toml::Value = toml::from_str(&content).map_err(|_| "Invalid Grok config TOML")?;
    let model = model
        .or_else(|| env.get("GROK_MODEL").map(String::as_str))
        .or_else(|| doc.get("models")?.get("default")?.as_str())
        .map(str::to_owned);
    if let Some(model) = model {
        let root = doc.as_table_mut().ok_or("Grok config must be a table")?;
        root.entry("models")
            .or_insert_with(|| toml::Value::Table(Default::default()))
            .as_table_mut()
            .ok_or("Grok models must be a table")?
            .insert("default".into(), toml::Value::String(model.clone()));
        let table = root
            .entry("model")
            .or_insert_with(|| toml::Value::Table(Default::default()))
            .as_table_mut()
            .ok_or("Grok model must be a table")?
            .entry(model.clone())
            .or_insert_with(|| toml::Value::Table(Default::default()))
            .as_table_mut()
            .ok_or("Grok model entry must be a table")?;
        table.insert("model".into(), toml::Value::String(model));
        if let Some(base) = env.get("GROK_MODELS_BASE_URL") {
            table.insert("base_url".into(), toml::Value::String(base.clone()));
        }
        if let Some(key) = env
            .get("XAI_API_KEY")
            .or_else(|| env.get("GROK_CODE_XAI_API_KEY"))
        {
            table.remove("env_key");
            table.insert("api_key".into(), toml::Value::String(key.clone()));
        }
    }
    let content = toml::to_string(&doc).map_err(|_| "Cannot serialize Grok channel config")?;
    file_access::fs::create_dir_all(directory)
        .map_err(|e| format!("create grok staging dir: {e}"))?;
    let directory = directory.join(format!("grok-channel-{}", uuid::Uuid::new_v4()));
    #[allow(unused_mut)]
    let mut builder = file_access::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        builder.mode(0o700);
    }
    builder
        .create(&directory)
        .map_err(|e| format!("create private grok home: {e}"))?;
    built.cleanup_files.push(directory.clone());
    copy_native_home(native_home, &directory)?;
    file_access::fs::write(directory.join("config.toml"), content)
        .map_err(|e| format!("write grok channel config: {e}"))?;
    let sessions = native_home.join("sessions");
    create_native_sessions(&sessions).map_err(|e| format!("create grok sessions dir: {e}"))?;
    link_sessions(&sessions, &directory.join("sessions"))
        .map_err(|e| format!("link grok session history: {e}"))?;
    built.command.env("GROK_HOME", directory);
    built.command.env_remove("GROK_CONFIG");
    built.command.env_remove("GROK_CONFIG_PATH");
    Ok(())
}

#[allow(
    clippy::disallowed_methods,
    reason = "reads Grok's own config in place, which may sit outside the engine folders the gate grants"
)]
fn read_native_config(config: &std::path::Path) -> std::io::Result<String> {
    std::fs::read_to_string(config)
}

#[allow(
    clippy::disallowed_methods,
    reason = "makes Grok's own session folder in its home, which may sit outside the engine folders the gate grants"
)]
fn create_native_sessions(sessions: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(sessions)
}

#[allow(
    clippy::disallowed_methods,
    reason = "lists Grok's own home in place, which may sit outside the engine folders the gate grants"
)]
fn copy_native_home(
    native_home: &std::path::Path,
    directory: &std::path::Path,
) -> Result<(), String> {
    if !native_home.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(native_home).map_err(|e| format!("read grok home: {e}"))? {
        let entry = entry.map_err(|e| format!("read grok home entry: {e}"))?;
        let file_type = entry
            .file_type()
            .map_err(|e| format!("read grok home entry type: {e}"))?;
        if file_type.is_symlink() {
            continue;
        }
        let name = entry.file_name();
        let name_text = name.to_string_lossy();
        if (file_type.is_file() && !name_text.ends_with(".lock"))
            || ["skills", "agents", "rules", "hooks", "plugins", "memory"]
                .contains(&name_text.as_ref())
        {
            copy_config_input(&entry.path(), &directory.join(name), &mut Vec::new())
                .map_err(|e| format!("copy grok configuration input: {e}"))?;
        }
    }
    Ok(())
}

#[allow(
    clippy::disallowed_methods,
    reason = "copies Grok's own config inputs out of its home, which may sit outside the engine folders the gate grants, into a private staging home"
)]
fn copy_config_input(
    source: &std::path::Path,
    target: &std::path::Path,
    ancestors: &mut Vec<std::path::PathBuf>,
) -> std::io::Result<()> {
    let meta = std::fs::symlink_metadata(source)?;
    if meta.file_type().is_symlink() {
        return Ok(());
    }
    if meta.is_dir() {
        let canonical = source.canonicalize()?;
        if ancestors.contains(&canonical) {
            return Err(std::io::Error::other(
                "cycle in Grok configuration directories",
            ));
        }
        ancestors.push(canonical);
        std::fs::create_dir(target)?;
        for entry in std::fs::read_dir(source)? {
            let entry = entry?;
            copy_config_input(&entry.path(), &target.join(entry.file_name()), ancestors)?;
        }
        ancestors.pop();
    } else {
        std::fs::copy(source, target)?;
    }
    Ok(())
}

fn link_sessions(source: &std::path::Path, target: &std::path::Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        file_access::fs::symlink(source, target)
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let output = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command",
                "$ErrorActionPreference='Stop'; New-Item -ItemType Junction -Path $env:CCGUI_GROK_LINK -Target $env:CCGUI_GROK_SESSIONS | Out-Null"])
            .env("CCGUI_GROK_LINK", target)
            .env("CCGUI_GROK_SESSIONS", dunce::canonicalize(source)?)
            .creation_flags(0x0800_0000)
            .output()?;
        if output.status.success() {
            Ok(())
        } else {
            Err(std::io::Error::other(
                String::from_utf8_lossy(&output.stderr).into_owned(),
            ))
        }
    }
}

#[cfg(test)]
mod channel_tests {
    use super::*;
    use std::path::{Path, PathBuf};

    fn built() -> BuiltCommand {
        BuiltCommand {
            command: tokio::process::Command::new("grok"),
            stdin_payload: None,
            keep_stdin_open: false,
            cleanup_files: Vec::new(),
            preassigned_session_id: None,
        }
    }

    fn env_path(built: &BuiltCommand, key: &str) -> PathBuf {
        built
            .command
            .as_std()
            .get_envs()
            .find(|(name, _)| *name == key)
            .and_then(|(_, value)| value)
            .map(PathBuf::from)
            .unwrap()
    }

    #[test]
    fn concurrent_channels_isolate_cli_config_saves_and_keep_native_files() {
        let directory =
            std::env::temp_dir().join(format!("ccgui-grok-channel-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let config = directory.join("config.toml");
        let auth = directory.join("auth.json");
        let original = "# keep this comment\n[models]\ndefault = \"native-model\"\n[model.selected-model]\napi_key = \"old-key\"\nenv_key = \"OLD_KEY\"\nbase_url = \"https://old.example\"\ncontext_window = 200000\n";
        std::fs::write(&config, original).unwrap();
        std::fs::write(&auth, "native-auth").unwrap();
        std::fs::create_dir_all(directory.join("sessions")).unwrap();
        std::fs::write(directory.join("sessions/keep.jsonl"), "history").unwrap();
        std::fs::write(directory.join("requirements.toml"), "policy = true").unwrap();
        let mut a = built();
        let mut b = built();
        for (built, key, base) in [
            (&mut a, "key-a", "https://a.example"),
            (&mut b, "key-b", "https://b.example"),
        ] {
            let provider =
                serde_json::json!({"apiKey":key,"baseUrl":base,"model":"channel-default"});
            stage_channel(
                built,
                &provider,
                Some("selected-model"),
                &directory,
                &directory.join("staging"),
            )
            .unwrap();
            let staged_path = env_path(built, "GROK_HOME").join("config.toml");
            assert_ne!(staged_path, config);
            let staged: toml::Value =
                toml::from_str(&std::fs::read_to_string(&staged_path).unwrap()).unwrap();
            assert_eq!(staged["models"]["default"].as_str(), Some("selected-model"));
            assert_eq!(
                staged["model"]["selected-model"]["api_key"].as_str(),
                Some(key)
            );
            assert_eq!(
                staged["model"]["selected-model"]["base_url"].as_str(),
                Some(base)
            );
            assert!(staged["model"]["selected-model"].get("env_key").is_none());
            assert_eq!(
                staged["model"]["selected-model"]["context_window"].as_integer(),
                Some(200000)
            );
            assert_eq!(staged["endpoints"]["models_base_url"].as_str(), Some(base));
            assert_eq!(
                std::fs::read_to_string(env_path(built, "GROK_HOME").join("auth.json")).unwrap(),
                "native-auth"
            );
            let home = env_path(built, "GROK_HOME");
            assert_eq!(
                std::fs::read_to_string(home.join("requirements.toml")).unwrap(),
                "policy = true"
            );
            assert_eq!(
                std::fs::read_to_string(home.join("sessions/keep.jsonl")).unwrap(),
                "history"
            );
            std::fs::write(home.join("sessions/new.jsonl"), "new history").unwrap();
            std::fs::write(&staged_path, "rewritten by CLI").unwrap();
            std::fs::write(
                env_path(built, "GROK_HOME").join("auth.json"),
                "updated-auth",
            )
            .unwrap();
            std::fs::write(staged_path.with_extension("tmp"), "temporary secret").unwrap();
        }
        let a_path = env_path(&a, "GROK_HOME").join("config.toml");
        let b_path = env_path(&b, "GROK_HOME").join("config.toml");
        assert_ne!(a_path, b_path);
        super::super::cleanup_staged_files(&a.cleanup_files);
        assert!(!a_path.parent().unwrap().exists());
        assert!(b_path.exists());
        super::super::cleanup_staged_files(&b.cleanup_files);
        assert_eq!(
            std::fs::read_to_string(directory.join("sessions/keep.jsonl")).unwrap(),
            "history"
        );
        assert_eq!(
            std::fs::read_to_string(directory.join("sessions/new.jsonl")).unwrap(),
            "new history"
        );
        assert_eq!(std::fs::read_to_string(config).unwrap(), original);
        assert_eq!(std::fs::read_to_string(auth).unwrap(), "native-auth");
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    #[ignore = "requires CCGUI_TEST_GROK_BIN pointing to an installed Grok CLI"]
    fn installed_grok_uses_channel_without_rewriting_native_config() {
        let binary = std::env::var("CCGUI_TEST_GROK_BIN").expect("set CCGUI_TEST_GROK_BIN");
        let directory =
            std::env::temp_dir().join(format!("ccgui-grok-probe-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let original = "# native comment\n[models]\ndefault = \"native-model\"\n[features]\nremote_fetch = false\n";
        std::fs::write(directory.join("config.toml"), original).unwrap();
        std::fs::write(directory.join("auth.json"), "{}").unwrap();
        let mut built = built();
        built.command = tokio::process::Command::new(binary);
        let provider = serde_json::json!({"model":"probe-model", "apiKey":"fake-probe-key", "baseUrl":"http://127.0.0.1:1"});
        for (key, value) in
            crate::engines::support::provider_files::channel_env("grok", &provider).unwrap()
        {
            built.command.env(key, value);
        }
        stage_channel(
            &mut built,
            &provider,
            None,
            &directory,
            &directory.join("staging"),
        )
        .unwrap();
        built
            .command
            .args(["models"])
            .current_dir(&directory)
            .env("GROK_DISABLE_AUTOUPDATER", "1")
            .env_remove("GROK_CONFIG")
            .env_remove("GROK_CONFIG_PATH");
        let output = built.command.as_std_mut().output().unwrap();
        super::super::cleanup_staged_files(&built.cleanup_files);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("Default model: probe-model"));
        assert_eq!(
            std::fs::read_to_string(directory.join("config.toml")).unwrap(),
            original
        );
        assert_eq!(
            std::fs::read_to_string(directory.join("auth.json")).unwrap(),
            "{}"
        );
        assert!(directory.join("sessions").is_dir());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn staging_never_follows_symlinks_outside_the_native_home() {
        let directory =
            std::env::temp_dir().join(format!("ccgui-grok-symlink-test-{}", uuid::Uuid::new_v4()));
        let outside = directory.join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secret.txt"), "secret").unwrap();
        let native = directory.join("native");
        std::fs::create_dir_all(native.join("skills")).unwrap();
        std::fs::write(native.join("skills/real.txt"), "real").unwrap();
        std::fs::write(native.join("config.toml"), "[models]\ndefault = \"m\"\n").unwrap();
        std::os::unix::fs::symlink(outside.join("secret.txt"), native.join("linked-secret"))
            .unwrap();
        std::os::unix::fs::symlink(&outside, native.join("skills/linked-dir")).unwrap();
        let mut built = built();
        stage_channel(
            &mut built,
            &serde_json::json!({}),
            None,
            &native,
            &directory.join("staging"),
        )
        .unwrap();
        let home = env_path(&built, "GROK_HOME");
        assert!(!home.join("linked-secret").exists());
        assert!(!home.join("skills/linked-dir").exists());
        assert_eq!(
            std::fs::read_to_string(home.join("skills/real.txt")).unwrap(),
            "real"
        );
        super::super::cleanup_staged_files(&built.cleanup_files);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn invalid_native_config_fails_before_staging() {
        let directory =
            std::env::temp_dir().join(format!("ccgui-grok-invalid-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let config = directory.join("config.toml");
        std::fs::write(&config, "endpoints = 1").unwrap();
        let mut built = built();
        assert!(stage_channel(
            &mut built,
            &serde_json::json!({}),
            None,
            &directory,
            &directory.join("staging")
        )
        .is_err());
        assert!(built.cleanup_files.is_empty());
        assert!(!Path::new(&directory.join("staging")).exists());
        assert_eq!(std::fs::read_to_string(config).unwrap(), "endpoints = 1");
        std::fs::remove_dir_all(directory).unwrap();
    }
}

pub(super) fn prompt_mode(permission: Option<&str>) -> Option<&'static str> {
    (GrokEngine.resolve_permission(permission) == "ask").then_some("ask")
}

impl Engine for GrokEngine {
    fn id(&self) -> &'static str {
        "grok"
    }

    fn drives_own_transport(&self) -> bool {
        true
    }

    fn host_command(&self, req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
        let mut cmd = command_for_binary(bin);
        cmd.arg("agent");
        if let Some(model) = req.model.as_deref() {
            cmd.arg("-m");
            cmd.arg(model);
        }
        if let Some(effort) = req
            .effort
            .as_deref()
            .map(str::trim)
            .filter(|e| !e.is_empty())
        {
            cmd.arg("--effort");
            cmd.arg(effort);
        }
        cmd.arg("stdio");
        cmd.env("GROK_DISABLE_AUTOUPDATER", "1");
        Ok(BuiltCommand {
            command: cmd,
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
    fn modes(&self) -> &'static [super::modes::EngineMode] {
        use super::modes::{mode, ModeKind::*};
        const MODES: &[super::modes::EngineMode] = &[
            mode("default", "Default", Asks, "manual"),
            mode("ask", "Ask", Asks, "ask"),
        ];
        MODES
    }
    fn supports_mcp(&self) -> bool {
        true
    }

    fn plan_approval(&self) -> super::plan_review::PlanApproval {
        super::plan_review::PlanApproval::Unavailable {
            reason: "Grok plan review rides ACP x.ai/toggle_plan_mode + x.ai/exit_plan_mode (1.0.40 binary strings), but the ExitPlanModeExtResponse schema is not recoverable from the binary: its 2 field names (decision discriminant and feedback text) and the approve/revise/abandon encoding are unknown, and toggle_plan_mode's enter-plan-mode params encoding is unverified; wiring it without a live frame capture would fabricate the approval reply, and today a plan request would silently degrade to bypassPermissions",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn host_command_passes_effort_flag() {
        let req = SendRequest {
            session_id: Some("s1".into()),
            prompt: "hi".into(),
            prompt_contributions: vec![],
            native_compact: false,
            images: vec![],
            workspace: PathBuf::from("/tmp"),
            model: Some("grok-3".into()),
            effort: Some("high".into()),
            service_tier: None,
            permission: Some("bypass".into()),
            additional_dirs: vec![],
            provider_id: None,
            mcp_servers: None,
            allowed_tools: None,
        };
        let built = GrokEngine.host_command(&req, "grok").unwrap();
        let args: Vec<String> = built
            .command
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert!(args.windows(2).any(|w| w == ["--effort", "high"]));
        assert!(!args.contains(&"--always-approve".to_string()), "{args:?}");
    }
}
