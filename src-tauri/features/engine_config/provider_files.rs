// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
//
// A channel's environment for a CLI it is started with, and the engines' own official config
// files for the official editor. Choosing a channel never writes those files: the channel is
// applied to each start (environment and, for Claude Code and Codex, launch flags from
// `channels::channel_launch`), so chats on one engine can use different channels at once and
// `--resume` still finds history in the CLI's real home.
//
// desktop-cc-gui also carries a one-time migration that restores files its older versions wrote
// for a channel. Misty never wrote them, so that migration is not ported.

use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use toml_edit::{DocumentMut, Item};

use super::support;

pub(crate) struct Target {
    pub(crate) path: PathBuf,
}

pub(crate) fn targets(engine: &str) -> Vec<Target> {
    let home = support::engine_home;
    let target = |path: PathBuf| Target { path };
    match engine {
        "claude" => vec![target(support::claude_home().join("settings.json"))],
        "codex" => vec![target(support::codex_home().join("config.toml"))],
        "kimi" => vec![target(
            home(Some("KIMI_CODE_HOME"), ".kimi-code").join("config.toml"),
        )],
        "grok" => vec![target(home(Some("GROK_HOME"), ".grok").join("config.toml"))],
        "agy" => vec![target(
            home(Some("ANTIGRAVITY_HOME"), ".gemini/antigravity-cli").join("settings.json"),
        )],
        _ => Vec::new(),
    }
}

fn backup_path(engine: &str, target: &Target) -> PathBuf {
    let name = target
        .path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "config".into());
    support::app_home()
        .join("provider-backups")
        .join(engine)
        .join(format!("{name}.{}", support::now_ms()))
}

pub fn provider_file_paths(engine: &str) -> Vec<String> {
    targets(engine)
        .iter()
        .map(|t| t.path.display().to_string())
        .collect()
}

#[tauri::command]
pub async fn engine_channels_official_paths(engine: String) -> Vec<String> {
    provider_file_paths(&engine)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct OfficialConfigFile {
    pub path: String,
    pub format: &'static str,
    pub content: String,
    pub exists: bool,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct OfficialConfigDraft {
    pub path: String,
    pub content: String,
}

fn file_format(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("toml") => "toml",
        _ => "json",
    }
}

pub fn official_config_read(engine: &str) -> Result<Vec<OfficialConfigFile>, String> {
    super::channels::checked_engine(engine)?;
    targets(engine)
        .iter()
        .map(|t| {
            let content = match file_access::fs::read_to_string(&t.path) {
                Ok(content) => Ok(content),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
                Err(e) => Err(format!("read {}: {e}", t.path.display())),
            }?;
            Ok(OfficialConfigFile {
                path: t.path.display().to_string(),
                format: file_format(&t.path),
                content,
                exists: file_access::fs::exists(&t.path),
            })
        })
        .collect()
}

#[tauri::command]
pub async fn engine_channels_official_read(
    engine: String,
) -> Result<Vec<OfficialConfigFile>, String> {
    tauri::async_runtime::spawn_blocking(move || official_config_read(&engine))
        .await
        .map_err(|e| e.to_string())?
}

pub fn official_config_write(engine: &str, files: Vec<OfficialConfigDraft>) -> Result<(), String> {
    super::channels::checked_engine(engine)?;
    let _guard = super::channels::lock();
    let targets = targets(engine);
    if targets.is_empty() {
        return Err(format!("{engine} has no config file Misty can edit"));
    }
    for draft in &files {
        let target = targets
            .iter()
            .find(|t| t.path.display().to_string() == draft.path)
            .ok_or_else(|| format!("{} is not a config file of {engine}", draft.path))?;
        validate_official(target, &draft.content)?;
    }
    for draft in &files {
        let target = targets
            .iter()
            .find(|t| t.path.display().to_string() == draft.path)
            .expect("validated above");
        write_official(engine, target, &draft.content)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn engine_channels_official_write(
    engine: String,
    files: Vec<OfficialConfigDraft>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || official_config_write(&engine, files))
        .await
        .map_err(|e| e.to_string())?
}

fn validate_official(target: &Target, content: &str) -> Result<(), String> {
    match file_format(&target.path) {
        "toml" => {
            content
                .parse::<DocumentMut>()
                .map_err(|e| format!("Invalid TOML in {}: {e}", target.path.display()))?;
        }
        _ => {
            let value: Value = serde_json::from_str(content)
                .map_err(|e| format!("Invalid JSON in {}: {e}", target.path.display()))?;
            if !value.is_object() {
                return Err(format!("{} must be a JSON object", target.path.display()));
            }
        }
    }
    Ok(())
}

fn write_official(engine: &str, target: &Target, content: &str) -> Result<(), String> {
    if let Ok(previous) = file_access::fs::read_to_string(&target.path) {
        support::atomic_write(&backup_path(engine, target), &previous)?;
    }
    support::atomic_write(&target.path, content)
}

pub(crate) fn is_blocked_env_key(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    if upper.starts_with("DYLD_")
        || upper.starts_with("LD_")
        || upper.starts_with("GIT_CONFIG_KEY_")
        || upper.starts_with("GIT_CONFIG_VALUE_")
    {
        return true;
    }
    matches!(
        upper.as_str(),
        "NODE_OPTIONS"
            | "NODE_REPL_EXTERNAL_MODULE"
            | "NODE_EXTRA_CA_CERTS"
            | "BASH_ENV"
            | "ENV"
            | "SHELLOPTS"
            | "PYTHONSTARTUP"
            | "PYTHONINSPECT"
            | "PYTHONPATH"
            | "RUBYOPT"
            | "PERL5OPT"
            | "PATH"
            | "HTTP_PROXY"
            | "HTTPS_PROXY"
            | "ALL_PROXY"
            | "GIT_SSH"
            | "GIT_SSH_COMMAND"
            | "GIT_CONFIG_GLOBAL"
            | "GIT_CONFIG_SYSTEM"
            | "GIT_CONFIG_COUNT"
            | "GIT_TEMPLATE_DIR"
            | "GIT_EXEC_PATH"
            | "SSH_ASKPASS"
            | "PROMPT_COMMAND"
            | "EDITOR"
            | "GIT_PAGER"
            | "PAGER"
            | "IFS"
    )
}

pub(crate) fn env_mapping(engine: &str) -> [(&'static str, &'static str); 3] {
    match engine {
        "claude" => [
            ("baseUrl", "ANTHROPIC_BASE_URL"),
            ("apiKey", "ANTHROPIC_AUTH_TOKEN"),
            ("model", "ANTHROPIC_MODEL"),
        ],
        "kimi" => [
            ("baseUrl", "KIMI_BASE_URL"),
            ("apiKey", "KIMI_API_KEY"),
            ("model", "KIMI_MODEL_NAME"),
        ],
        "grok" => [
            ("baseUrl", "GROK_BASE_URL"),
            ("apiKey", "GROK_API_KEY"),
            ("model", "GROK_MODEL"),
        ],
        "codex" => [
            ("baseUrl", "OPENAI_BASE_URL"),
            ("apiKey", "OPENAI_API_KEY"),
            ("model", ""),
        ],
        "gemini" => [
            ("baseUrl", "GOOGLE_GEMINI_BASE_URL"),
            ("apiKey", "GEMINI_API_KEY"),
            ("model", "GEMINI_MODEL"),
        ],
        "qwen" => [
            ("baseUrl", "OPENAI_BASE_URL"),
            ("apiKey", "OPENAI_API_KEY"),
            ("model", "OPENAI_MODEL"),
        ],
        _ => [("baseUrl", ""), ("apiKey", ""), ("model", "")],
    }
}

pub(crate) fn non_empty_str(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn channel_env_maps(
    provider: &Value,
) -> impl Iterator<Item = &serde_json::Map<String, Value>> + '_ {
    [
        provider.get("settingsConfig").and_then(|s| s.get("env")),
        provider.get("env"),
    ]
    .into_iter()
    .flatten()
    .filter_map(Value::as_object)
}

pub(crate) fn channel_field(engine: &str, provider: &Value, field: &str) -> Option<String> {
    if let Some(v) = non_empty_str(provider.get(field)) {
        return Some(v);
    }
    let (_, var) = env_mapping(engine).into_iter().find(|(f, _)| *f == field)?;
    if var.is_empty() {
        return None;
    }
    channel_env_maps(provider).find_map(|map| non_empty_str(map.get(var)))
}

pub(crate) fn channel_env(
    engine: &str,
    provider: &Value,
) -> Result<HashMap<String, String>, String> {
    let mut out: HashMap<String, String> = HashMap::new();
    let mut seen = HashSet::new();
    for map in channel_env_maps(provider) {
        for (key, val) in map {
            if is_blocked_env_key(key) {
                eprintln!("[engine channels] refusing to pass a blocked variable: {key}");
                continue;
            }
            if seen.contains(key) {
                continue;
            }
            let scalar = match val {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                Value::Bool(b) => b.to_string(),
                _ => continue,
            };
            if scalar.trim().is_empty() {
                continue;
            }
            seen.insert(key.clone());
            out.insert(key.clone(), scalar);
        }
    }
    for (field, var) in env_mapping(engine) {
        if var.is_empty() || seen.contains(var) {
            continue;
        }
        if let Some(v) = channel_field(engine, provider, field) {
            seen.insert(var.to_string());
            out.insert(var.to_string(), v);
        }
    }
    if engine == "codex" && !seen.contains("OPENAI_API_KEY") {
        if let Some(key) = non_empty_str(
            provider
                .get("settingsConfig")
                .and_then(|s| s.get("auth"))
                .and_then(|a| a.get("OPENAI_API_KEY")),
        ) {
            out.insert("OPENAI_API_KEY".to_string(), key);
        }
    }
    if engine == "grok" {
        if let Some(base) = out.remove("GROK_BASE_URL") {
            let base = base.trim_end_matches('/');
            for key in [
                "GROK_MODELS_BASE_URL",
                "GROK_XAI_API_BASE_URL",
                "GROK_CLI_CHAT_PROXY_BASE_URL",
            ] {
                out.entry(key.into()).or_insert_with(|| base.to_string());
            }
            out.entry("GROK_MODELS_LIST_URL".into())
                .or_insert_with(|| format!("{base}/models"));
        }
        if let Some(key) = out.remove("GROK_API_KEY") {
            out.entry("XAI_API_KEY".into()).or_insert(key);
        }
    }
    Ok(out)
}

pub(crate) fn codex_api_key(provider: &Value) -> Option<String> {
    non_empty_str(provider.pointer("/settingsConfig/auth/OPENAI_API_KEY"))
        .or_else(|| channel_field("codex", provider, "apiKey"))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SafeProviderProbeConfig {
    pub name: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub configured_model: Option<String>,
}

pub(crate) fn safe_provider_probe_config(
    engine: &str,
    provider: &Value,
) -> SafeProviderProbeConfig {
    let name = non_empty_str(provider.get("name")).unwrap_or_else(|| "Provider".to_string());
    let configured_model = channel_field(engine, provider, "model").or_else(|| {
        if engine != "codex" {
            return None;
        }
        provider
            .pointer("/settingsConfig/config")
            .and_then(Value::as_str)
            .and_then(|text| text.parse::<DocumentMut>().ok())
            .and_then(|doc| doc.get("model").and_then(Item::as_str).map(str::to_string))
    });
    SafeProviderProbeConfig {
        name,
        base_url: channel_field(engine, provider, "baseUrl"),
        api_key: if engine == "codex" {
            codex_api_key(provider)
        } else {
            channel_field(engine, provider, "apiKey")
        },
        configured_model,
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::disallowed_methods, clippy::disallowed_types)]
    use super::*;

    #[test]
    fn grok_channel_injects_native_endpoint_and_auth_names() {
        let p = serde_json::json!({"env": {
            "GROK_BASE_URL": "https://relay.example/v1/",
            "GROK_API_KEY": "dummy-key"
        }});
        let env = channel_env("grok", &p).unwrap();
        for key in [
            "GROK_MODELS_BASE_URL",
            "GROK_XAI_API_BASE_URL",
            "GROK_CLI_CHAT_PROXY_BASE_URL",
        ] {
            assert_eq!(
                env.get(key).map(String::as_str),
                Some("https://relay.example/v1")
            );
        }
        assert_eq!(
            env.get("GROK_MODELS_LIST_URL").map(String::as_str),
            Some("https://relay.example/v1/models")
        );
        assert_eq!(
            env.get("XAI_API_KEY").map(String::as_str),
            Some("dummy-key")
        );
        assert!(!env.contains_key("GROK_API_KEY"));
        assert!(!env.contains_key("GROK_BASE_URL"));
    }

    #[test]
    fn channel_env_raw_wins_convention_and_refuses_blocked_keys() {
        let p = serde_json::json!({
            "baseUrl": "https://flat.example",
            "apiKey": "sk-flat",
            "model": "flat-model",
            "settingsConfig": { "env": { "ANTHROPIC_BASE_URL": "https://raw.example" } },
            "env": { "ANTHROPIC_AUTH_TOKEN": "sk-raw" },
        });
        let env = channel_env("claude", &p).unwrap();
        assert_eq!(
            env.get("ANTHROPIC_BASE_URL").map(String::as_str),
            Some("https://raw.example")
        );
        assert_eq!(
            env.get("ANTHROPIC_AUTH_TOKEN").map(String::as_str),
            Some("sk-raw")
        );
        assert_eq!(
            env.get("ANTHROPIC_MODEL").map(String::as_str),
            Some("flat-model")
        );

        let blocked = serde_json::json!({ "env": {
            "NODE_OPTIONS": "--require ./x.js",
            "PATH": "/tmp/evil-bin:/usr/bin",
            "HTTPS_PROXY": "http://mitm.example:8080",
            "NODE_EXTRA_CA_CERTS": "/tmp/evil-ca.pem",
            "GIT_CONFIG_GLOBAL": "/tmp/evil-gitconfig",
            "GIT_CONFIG_KEY_0": "core.hooksPath",
            "EDITOR": "/tmp/evil-editor",
            "SAFE": "1"
        } });
        let env = channel_env("claude", &blocked).unwrap();
        for key in [
            "NODE_OPTIONS",
            "PATH",
            "HTTPS_PROXY",
            "NODE_EXTRA_CA_CERTS",
            "GIT_CONFIG_GLOBAL",
            "GIT_CONFIG_KEY_0",
            "EDITOR",
        ] {
            assert!(!env.contains_key(key), "{key} must never be injected");
        }
        assert_eq!(env.get("SAFE").map(String::as_str), Some("1"));
    }

    #[test]
    fn channel_env_codex_lifts_auth_json_key() {
        let p = serde_json::json!({
            "settingsConfig": { "auth": { "OPENAI_API_KEY": "sk-codex" } },
        });
        let env = channel_env("codex", &p).unwrap();
        assert_eq!(
            env.get("OPENAI_API_KEY").map(String::as_str),
            Some("sk-codex")
        );
    }

    #[test]
    fn validate_official_rejects_malformed_content() {
        let json_target = Target {
            path: PathBuf::from("/tmp/settings.json"),
        };
        let toml_target = Target {
            path: PathBuf::from("/tmp/config.toml"),
        };
        assert!(validate_official(&json_target, r#"{"env":{}}"#).is_ok());
        assert!(validate_official(&json_target, "{not json").is_err());
        assert!(validate_official(&json_target, "[1,2]").is_err());
        assert!(validate_official(&toml_target, "[providers]\nx=1").is_ok());
        assert!(validate_official(&toml_target, "key = = 1").is_err());
    }

    #[test]
    fn codex_official_files_never_include_the_sign_in() {
        let scratch = std::env::temp_dir().join(format!("misty-pf-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&scratch).unwrap();
        let _home = support::TestHome::set(&scratch);
        let paths = provider_file_paths("codex");
        assert_eq!(paths.len(), 1);
        assert!(paths[0].ends_with("config.toml"));
        assert!(provider_file_paths("misty").is_empty());
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn agy_native_settings_are_editable_and_backed_up() {
        let scratch = std::env::temp_dir().join(format!("misty-pf-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&scratch).unwrap();
        let _home = support::TestHome::set(&scratch);
        let path = scratch
            .join(".gemini")
            .join("antigravity-cli")
            .join("settings.json");
        assert_eq!(
            provider_file_paths("agy"),
            vec![path.to_string_lossy().into_owned()]
        );
        let missing = official_config_read("agy").unwrap();
        assert_eq!(missing.len(), 1);
        assert_eq!(missing[0].format, "json");
        assert!(!missing[0].exists);
        assert_eq!(missing[0].content, "");

        let first = r#"{"model":"native-model","env":{"CUSTOM":"kept"}}"#;
        let draft = |content: &str| OfficialConfigDraft {
            path: path.to_string_lossy().into_owned(),
            content: content.into(),
        };
        official_config_write("agy", vec![draft(first)]).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), first);
        official_config_write("agy", vec![draft(r#"{"model":"next"}"#)]).unwrap();
        let backups: Vec<_> =
            std::fs::read_dir(scratch.join(".misty/engine-config/provider-backups/agy"))
                .unwrap()
                .flatten()
                .map(|entry| std::fs::read_to_string(entry.path()).unwrap())
                .collect();
        assert_eq!(backups, vec![first.to_string()]);
        assert!(official_config_write(
            "agy",
            vec![OfficialConfigDraft {
                path: scratch.join("other.json").to_string_lossy().into_owned(),
                content: "{}".into(),
            }]
        )
        .is_err());
        assert!(official_config_write("agy", vec![draft("[]")]).is_err());
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            r#"{"model":"next"}"#
        );
        let _ = std::fs::remove_dir_all(&scratch);
    }
}
