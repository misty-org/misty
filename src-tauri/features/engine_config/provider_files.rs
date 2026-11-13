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
//
// OpenCode and Qoder keep their native configuration and sign-in; these engines declare no
// official files here.

use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use toml_edit::{DocumentMut, Item};

use super::support;

// ── Official files ──────────────────────────────────────────────────────────

pub(crate) struct Target {
    pub(crate) path: PathBuf,
}

/// The CLI's own config files the official editor shows, in pane order. Codex's `auth.json` is
/// left out: it holds the person's ChatGPT sign-in, which Misty never reads.
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
        "codebuddy" => vec![target(
            home(Some("CODEBUDDY_CONFIG_DIR"), ".codebuddy").join("settings.json"),
        )],
        "agy" => vec![target(
            home(Some("ANTIGRAVITY_HOME"), ".gemini/antigravity-cli").join("settings.json"),
        )],
        _ => Vec::new(),
    }
}

/// Where a write to an official file keeps the version it replaced.
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

/// Native config files of `engine` (the official editor's panes). Empty for engines whose
/// official state lives elsewhere.
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

/// One editable file of an engine's official config, one pane of the edit dialog.
#[derive(Debug, Clone, serde::Serialize)]
pub struct OfficialConfigFile {
    /// Absolute path: the pane label, and the write-back key.
    pub path: String,
    /// Editor language mode, from the extension.
    pub format: &'static str,
    /// Live file content; "" when absent (`exists` tells them apart).
    pub content: String,
    pub exists: bool,
}

/// An edited official file, matched back to a declared target by exact path so the window can
/// never name another file.
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

/// Overwrites official files, only when the person saves them in the editor. Everything is
/// validated before anything is written, and each replaced file is kept in
/// `~/.misty/engine-config/provider-backups`.
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

// ── Channel value extraction ────────────────────────────────────────────────

/// Loader, hook and interception variables a stored channel must never put into a CLI's
/// environment: they hand code execution or traffic to whoever wrote the channel. Prefix families
/// (DYLD_/LD_, GIT_CONFIG_KEY/VALUE) match by prefix, the rest exactly, without regard to case.
///
/// Beyond loader hooks: PATH hijacks the git and rg the CLI starts; a proxy with
/// NODE_EXTRA_CA_CERTS intercepts the CLI's HTTPS; GIT_CONFIG_*, GIT_TEMPLATE_DIR and
/// GIT_EXEC_PATH turn git calls into code execution; EDITOR and GIT_PAGER run when the CLI pages
/// or opens an editor. The proxy itself comes from Settings › Network.
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

/// baseUrl/apiKey/model to environment variable, per engine: the variables an imported CC Switch
/// channel carries its fields under, and what a flat channel is started with.
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
        // Codex reads OpenAI-compatible variables for its default provider.
        "codex" => [
            ("baseUrl", "OPENAI_BASE_URL"),
            ("apiKey", "OPENAI_API_KEY"),
            ("model", ""),
        ],
        "codebuddy" => [
            ("baseUrl", "CODEBUDDY_BASE_URL"),
            ("apiKey", "CODEBUDDY_API_KEY"),
            ("model", "CODEBUDDY_MODEL"),
        ],
        // Gemini CLI and Qwen Code read these for a custom endpoint and key.
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

/// A channel's raw environment maps: CC Switch's `settingsConfig.env` first, then the flat `env`.
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

/// One field (baseUrl/apiKey/model): the flat field wins, then the engine's variable in the raw
/// environment maps.
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

/// The environment a CLI is started with for `provider`: the raw maps first (blocked keys and
/// empty values refused), then the flat fields where the raw maps have no value.
///
/// Codex also lifts `settingsConfig.auth.OPENAI_API_KEY` when there is no other key: that is
/// where CC Switch keeps a Codex channel's key.
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
        // GROK_BASE_URL and GROK_API_KEY are channel aliases, not the CLI's own variables.
        // Translate them, keeping native variables the channel set itself.
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
    if engine == "codebuddy" && !seen.contains("CODEBUDDY_INTERNET_ENVIRONMENT") {
        // CodeBuddy needs CODEBUDDY_INTERNET_ENVIRONMENT to pick its sign-in and endpoint family
        // (China "internal", iOA "ioa", dedicated "cloudhosted", self-hosted "selfhosted");
        // without it a key channel signs in against the wrong service and fails with 401. The
        // two that can be told from the base URL are derived; a raw variable still wins.
        if let Some(edition) = out
            .get("CODEBUDDY_BASE_URL")
            .and_then(|base| codebuddy_edition_for(base))
        {
            out.insert(
                "CODEBUDDY_INTERNET_ENVIRONMENT".to_string(),
                edition.to_string(),
            );
        }
    }
    Ok(out)
}

/// The CodeBuddy edition for a base URL, or `None`. The parsed host must match exactly: a
/// substring match also took look-alike domains and proxy paths for Tencent's endpoint.
fn codebuddy_edition_for(base_url: &str) -> Option<&'static str> {
    let rest = base_url
        .split_once("://")
        .map_or(base_url, |(scheme, rest)| {
            if scheme.is_empty() || scheme.contains(['/', '?', '#']) {
                base_url
            } else {
                rest
            }
        });
    let authority = rest.split(['/', '?', '#']).next().unwrap_or(rest);
    let host_port = authority.rsplit('@').next().unwrap_or(authority);
    let host = host_port
        .split_once(':')
        .map(|(host, _)| host)
        .unwrap_or(host_port);
    match host.to_ascii_lowercase().as_str() {
        "tencent.sso.copilot.tencent.com" => Some("ioa"),
        "copilot.tencent.com" => Some("internal"),
        _ => None,
    }
}

pub(crate) fn codex_api_key(provider: &Value) -> Option<String> {
    non_empty_str(provider.pointer("/settingsConfig/auth/OPENAI_API_KEY"))
        .or_else(|| channel_field("codex", provider, "apiKey"))
}

/// The fields a model-list probe needs. Never sent to a window: the endpoint and key are used
/// only for the request the person asked for.
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
    fn channel_env_codebuddy_derives_internet_environment() {
        let edition = |base: &str, extra: Option<&str>| {
            let mut p = serde_json::json!({ "baseUrl": base, "apiKey": "sk" });
            if let Some(value) = extra {
                p["env"] = serde_json::json!({ "CODEBUDDY_INTERNET_ENVIRONMENT": value });
            }
            channel_env("codebuddy", &p)
                .unwrap()
                .get("CODEBUDDY_INTERNET_ENVIRONMENT")
                .cloned()
        };
        assert_eq!(
            edition("https://copilot.tencent.com/v1", None).as_deref(),
            Some("internal")
        );
        // The iOA endpoint wins over the copilot.tencent.com suffix.
        assert_eq!(
            edition("https://tencent.sso.copilot.tencent.com/v1", None).as_deref(),
            Some("ioa")
        );
        // A raw variable wins over the derivation.
        assert_eq!(
            edition("https://copilot.tencent.com/v1", Some("cloudhosted")).as_deref(),
            Some("cloudhosted")
        );
        assert_eq!(edition("https://selfhosted.example.com", None), None);
        // Look-alike domains and proxy paths carrying the real host derive nothing.
        for base in [
            "https://copilot.tencent.com.example.org/v1",
            "copilot.tencent.com.example.org/v1",
            "https://gateway.corp/https://copilot.tencent.com/v1",
            "gateway.corp/https://copilot.tencent.com/v1",
        ] {
            assert_eq!(edition(base, None), None, "{base}");
        }
        // A port on the real host, and a base without a scheme, still match.
        assert_eq!(
            edition("https://copilot.tencent.com:8443/v1", None).as_deref(),
            Some("internal")
        );
        assert_eq!(
            edition("copilot.tencent.com/v1", None).as_deref(),
            Some("internal")
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
        // Scalars and arrays parse as JSON but are not a settings file.
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
        assert!(provider_file_paths("opencode").is_empty());
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn codebuddy_native_settings_are_editable_and_backed_up() {
        let scratch = std::env::temp_dir().join(format!("misty-pf-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&scratch).unwrap();
        let _home = support::TestHome::set(&scratch);
        let path = scratch.join(".codebuddy").join("settings.json");
        assert_eq!(
            provider_file_paths("codebuddy"),
            vec![path.to_string_lossy().into_owned()]
        );
        let missing = official_config_read("codebuddy").unwrap();
        assert_eq!(missing.len(), 1);
        assert_eq!(missing[0].format, "json");
        assert!(!missing[0].exists);
        assert_eq!(missing[0].content, "");

        let first = r#"{"model":"native-model","env":{"CUSTOM":"kept"}}"#;
        let draft = |content: &str| OfficialConfigDraft {
            path: path.to_string_lossy().into_owned(),
            content: content.into(),
        };
        official_config_write("codebuddy", vec![draft(first)]).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), first);
        official_config_write("codebuddy", vec![draft(r#"{"model":"next"}"#)]).unwrap();
        let backups: Vec<_> =
            std::fs::read_dir(scratch.join(".misty/engine-config/provider-backups/codebuddy"))
                .unwrap()
                .flatten()
                .map(|entry| std::fs::read_to_string(entry.path()).unwrap())
                .collect();
        assert_eq!(backups, vec![first.to_string()]);
        // A file that isn't the engine's is refused, and a bad draft writes nothing.
        assert!(official_config_write(
            "codebuddy",
            vec![OfficialConfigDraft {
                path: scratch.join("other.json").to_string_lossy().into_owned(),
                content: "{}".into(),
            }]
        )
        .is_err());
        assert!(official_config_write("codebuddy", vec![draft("[]")]).is_err());
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            r#"{"model":"next"}"#
        );
        let _ = std::fs::remove_dir_all(&scratch);
    }
}
