// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/models/claude.rs.
//! Claude's catalog comes from the CLI's own configuration, not the app's
//! provider channels: `claude --model` resolves the built-in aliases the
//! /model menu lists, and the CLI's configured default lives in
//! ~/.claude/settings.json (settings.local.json overrides it). The concrete
//! model id each alias resolves to is read from the registry the CLI embeds
//! in its own binary, so the picker names the real model instead of the
//! bare family name. No relay probe: the /model menu is built into the CLI
//! binary, so a channel's /v1/models would list ids the CLI never offers.

use std::path::PathBuf;

use super::EngineModel;

#[path = "claude_catalog.rs"]
mod catalog;
pub(super) use catalog::account_catalog;

#[derive(Clone, Debug, Default)]
pub(super) struct EmbeddedRegistry {
    alias_defaults: std::collections::HashMap<String, String>,
    provider_defaults: std::collections::HashMap<(String, String), String>,
    display_names: std::collections::HashMap<String, String>,
    model_facts: std::collections::HashMap<String, ModelFacts>,
    best: Option<String>,
}

#[derive(Clone, Debug, Default)]
struct ModelFacts {
    efforts: Option<Vec<String>>,
    default_effort: Option<String>,
    context_window: Option<u64>,
}

fn model_facts(record: &[u8]) -> ModelFacts {
    use regex::bytes::Regex;
    static CAPABILITIES: std::sync::LazyLock<Regex> =
        std::sync::LazyLock::new(|| Regex::new(r"capabilities:\[([^\]]*)\]").unwrap());
    static DEFAULT_EFFORT: std::sync::LazyLock<Regex> =
        std::sync::LazyLock::new(|| Regex::new(r#"default_effort:"([a-z]+)""#).unwrap());
    static WINDOW: std::sync::LazyLock<Regex> =
        std::sync::LazyLock::new(|| Regex::new(r"context:\{window:([0-9.e+]+)").unwrap());
    let efforts = CAPABILITIES.captures(record).map(|found| {
        let list = String::from_utf8_lossy(&found[1]).into_owned();
        let has = |name: &str| {
            list.split(',')
                .any(|item| item.trim().trim_matches('"') == name)
        };
        let mut efforts = Vec::new();
        if has("effort") {
            efforts.extend(["low", "medium", "high"].map(String::from));
            if has("xhigh_effort") {
                efforts.push("xhigh".to_string());
            }
            if has("max_effort") {
                efforts.push("max".to_string());
            }
        }
        efforts
    });
    ModelFacts {
        efforts,
        default_effort: DEFAULT_EFFORT
            .captures(record)
            .map(|found| String::from_utf8_lossy(&found[1]).into_owned()),
        context_window: WINDOW
            .captures(record)
            .and_then(|found| String::from_utf8_lossy(&found[1]).parse::<f64>().ok())
            .map(|window| window as u64),
    }
}

impl EmbeddedRegistry {
    fn display_line(&self, selector: &str) -> String {
        let bare = selector.strip_suffix("[1m]").unwrap_or(selector);
        let id = self
            .alias_defaults
            .get(bare)
            .map(String::as_str)
            .unwrap_or(bare);
        match self.display_names.get(id) {
            Some(name) => format!("{name} · {id}"),
            None => id.to_string(),
        }
    }
}

fn parse_registry(bytes: &[u8]) -> EmbeddedRegistry {
    use regex::bytes::Regex;
    let mut registry = EmbeddedRegistry::default();
    let models_re = Regex::new(r#"id:"([^"]+)",family:"[a-z]+",display_name:"([^"]+)""#).unwrap();
    let records: Vec<_> = models_re.captures_iter(bytes).collect();
    for (index, m) in records.iter().enumerate() {
        let id = String::from_utf8_lossy(&m[1]).into_owned();
        registry
            .display_names
            .insert(id.clone(), String::from_utf8_lossy(&m[2]).into_owned());
        let start = m.get(0).map_or(0, |whole| whole.end());
        let next = records
            .get(index + 1)
            .and_then(|record| record.get(0))
            .map_or(bytes.len(), |whole| whole.start());
        let mut end = next.min(start + 4096).min(bytes.len()).max(start);
        if let Some(close) = bytes[start..end].windows(2).position(|pair| pair == b"}]") {
            end = start + close;
        }
        registry
            .model_facts
            .insert(id, model_facts(&bytes[start..end]));
    }
    let aliases_re = Regex::new(r"aliases:\{").unwrap();
    let family_re = Regex::new(r#"([a-z]+):\{default:"([^"]+)""#).unwrap();
    let provider_family_re =
        Regex::new(r#"([a-z]+):\{default:"[^"]+",per_provider:\{([^}]+)\}"#).unwrap();
    let provider_re = Regex::new(r#"([a-z]+):"([^"]+)""#).unwrap();
    let best_re = Regex::new(r#",best:"([^"]+)""#).unwrap();
    for m in aliases_re.find_iter(bytes) {
        let window = &bytes[m.start()..(m.start() + 2048).min(bytes.len())];
        for f in family_re.captures_iter(window) {
            registry.alias_defaults.insert(
                String::from_utf8_lossy(&f[1]).into_owned(),
                String::from_utf8_lossy(&f[2]).into_owned(),
            );
        }
        for family in provider_family_re.captures_iter(window) {
            for provider in provider_re.captures_iter(&family[2]) {
                registry.provider_defaults.insert(
                    (
                        String::from_utf8_lossy(&family[1]).into_owned(),
                        String::from_utf8_lossy(&provider[1]).into_owned(),
                    ),
                    String::from_utf8_lossy(&provider[2]).into_owned(),
                );
            }
        }
        if registry.best.is_none() {
            if let Some(b) = best_re.captures(window) {
                registry.best = Some(String::from_utf8_lossy(&b[1]).into_owned());
            }
        }
    }
    registry
}

#[allow(
    clippy::disallowed_methods,
    reason = "reads the installed Claude Code program for its model registry, which lives outside the gate"
)]
fn embedded_registry(bin: &std::path::Path) -> Option<EmbeddedRegistry> {
    struct CacheEntry {
        len: u64,
        modified: Option<std::time::SystemTime>,
        registry: Option<EmbeddedRegistry>,
    }
    static CACHE: std::sync::LazyLock<parking_lot::Mutex<Option<CacheEntry>>> =
        std::sync::LazyLock::new(|| parking_lot::Mutex::new(None));
    let meta = std::fs::metadata(bin).ok()?;
    let (len, modified) = (meta.len(), meta.modified().ok());
    if let Some(entry) = CACHE.lock().as_ref() {
        if entry.len == len && entry.modified == modified {
            return entry.registry.clone();
        }
    }
    let registry = std::fs::read(bin)
        .ok()
        .map(|bytes| parse_registry(&bytes))
        .filter(|r| !r.alias_defaults.is_empty());
    *CACHE.lock() = Some(CacheEntry {
        len,
        modified,
        registry: registry.clone(),
    });
    registry
}

const CLI_ALIASES: &[(&str, &str)] = &[
    ("default", "Default"),
    ("opus", "Opus"),
    ("fable", "Fable"),
    ("sonnet", "Sonnet"),
    ("haiku", "Haiku"),
];

fn claude_config_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }
    dirs::home_dir().expect("no home directory").join(".claude")
}

const FAMILY_ENV_KEYS: &[(&str, &str, &str)] = &[
    ("opus", "ANTHROPIC_DEFAULT_OPUS_MODEL", "Opus"),
    ("sonnet", "ANTHROPIC_DEFAULT_SONNET_MODEL", "Sonnet"),
    ("haiku", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "Haiku"),
    ("fable", "ANTHROPIC_DEFAULT_FABLE_MODEL", "Fable"),
];

#[derive(Default)]
struct CliModelConfig {
    env_model: Option<String>,
    model_key: Option<String>,
    overrides: std::collections::HashMap<String, String>,
    provider_flags: std::collections::HashMap<String, String>,
}

impl CliModelConfig {
    fn override_for(&self, family: &str) -> Option<&str> {
        self.overrides.get(family).map(String::as_str)
    }

    fn resolved_default(&self) -> Option<String> {
        let raw = self.env_model.as_deref().or(self.model_key.as_deref())?;
        let family = raw.strip_suffix("[1m]").unwrap_or(raw);
        let resolved = self.override_for(family).unwrap_or(raw);
        Some(
            if family.len() != raw.len() && !resolved.ends_with("[1m]") {
                format!("{resolved}[1m]")
            } else {
                resolved.to_string()
            },
        )
    }
}

fn read_cli_config() -> CliModelConfig {
    read_cli_config_from(&claude_config_dir())
}

pub(crate) fn resolve_launch_model(selector: &str) -> String {
    resolve_launch_model_from(&read_cli_config(), selector)
}

fn resolve_launch_model_from(config: &CliModelConfig, selector: &str) -> String {
    let bare = selector.strip_suffix("[1m]").unwrap_or(selector);
    if bare == "default" {
        return config
            .resolved_default()
            .unwrap_or_else(|| selector.to_string());
    }
    let wants_1m = bare != selector;
    config
        .override_for(bare)
        .map(|resolved| {
            if wants_1m && !resolved.ends_with("[1m]") {
                format!("{resolved}[1m]")
            } else {
                resolved.to_string()
            }
        })
        .unwrap_or_else(|| selector.to_string())
}

pub(crate) fn comparison_model(
    selector: &str,
    bin: Option<&std::path::Path>,
    channel_env: Option<&std::collections::HashMap<String, String>>,
    workspace: &std::path::Path,
) -> Option<String> {
    let config = match channel_env {
        Some(env) => {
            let mut config = CliModelConfig::default();
            merge_settings_json(&mut config, &serde_json::json!({"env": env}).to_string());
            config
        }
        None => {
            let mut config = CliModelConfig::default();
            let env: std::collections::HashMap<_, _> = FAMILY_ENV_KEYS
                .iter()
                .map(|(_, key, _)| *key)
                .chain([
                    "ANTHROPIC_MODEL",
                    "CLAUDE_CODE_USE_BEDROCK",
                    "CLAUDE_CODE_USE_VERTEX",
                    "CLAUDE_CODE_USE_FOUNDRY",
                ])
                .filter_map(|key| std::env::var(key).ok().map(|value| (key, value)))
                .collect();
            merge_settings_json(&mut config, &serde_json::json!({"env": env}).to_string());
            for dir in [claude_config_dir(), workspace.join(".claude")] {
                for name in ["settings.json", "settings.local.json"] {
                    if let Ok(content) = read_settings_in_place(&dir.join(name)) {
                        merge_settings_json(&mut config, &content);
                    }
                }
            }
            config
        }
    };
    let registry = bin.and_then(embedded_registry);
    comparison_model_from(selector, &config, registry.as_ref())
}

fn comparison_model_from(
    selector: &str,
    config: &CliModelConfig,
    registry: Option<&EmbeddedRegistry>,
) -> Option<String> {
    let selector = if selector == "default" {
        config
            .resolved_default()
            .or_else(|| registry.and_then(|r| r.best.clone()))?
    } else {
        selector.to_string()
    };
    let bare = selector.strip_suffix("[1m]").unwrap_or(&selector);
    let mapped = config.override_for(bare).unwrap_or(bare);
    if !CLI_ALIASES.iter().any(|(alias, _)| *alias == mapped) {
        return Some(mapped.to_string());
    }
    let registry = registry?;
    let provider = [
        ("CLAUDE_CODE_USE_BEDROCK", "bedrock"),
        ("CLAUDE_CODE_USE_VERTEX", "vertex"),
        ("CLAUDE_CODE_USE_FOUNDRY", "foundry"),
    ]
    .into_iter()
    .find_map(|(key, provider)| {
        config
            .provider_flags
            .get(key)
            .filter(|value| value.as_str() == "1" || value.as_str() == "true")
            .map(|_| provider)
    });
    match provider {
        Some(provider) => registry
            .provider_defaults
            .get(&(mapped.to_string(), provider.to_string()))
            .cloned(),
        None => registry.alias_defaults.get(mapped).cloned(),
    }
}

#[allow(
    clippy::disallowed_methods,
    reason = "reads Claude Code's settings in place, in its home and in the person's project folder, which need not be linked"
)]
fn read_settings_in_place(path: &std::path::Path) -> std::io::Result<String> {
    std::fs::read_to_string(path)
}

fn read_cli_config_from(dir: &std::path::Path) -> CliModelConfig {
    let mut config = CliModelConfig::default();
    for name in ["settings.json", "settings.local.json"] {
        if let Ok(content) = file_access::fs::read_to_string(dir.join(name)) {
            merge_settings_json(&mut config, &content);
        }
    }
    config
}

fn merge_settings_json(config: &mut CliModelConfig, content: &str) {
    let pick = |value: Option<&serde_json::Value>| {
        value
            .and_then(|m| m.as_str())
            .map(str::trim)
            .filter(|m| !m.is_empty())
            .map(str::to_string)
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(content) else {
        return;
    };
    let env = v.get("env");
    for key in [
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        "CLAUDE_CODE_USE_FOUNDRY",
    ] {
        if let Some(value) = pick(env.and_then(|e| e.get(key))) {
            config.provider_flags.insert(key.to_string(), value);
        }
    }
    if let Some(m) = pick(env.and_then(|e| e.get("ANTHROPIC_MODEL"))) {
        config.env_model = Some(m);
    }
    if let Some(m) = pick(v.get("model")) {
        config.model_key = Some(m);
    }
    for (family, key, _) in FAMILY_ENV_KEYS {
        if let Some(m) = pick(env.and_then(|e| e.get(key))) {
            config.overrides.insert(family.to_string(), m);
        }
    }
}

pub(super) fn claude_model_details(
    bin: Option<&std::path::Path>,
) -> std::collections::HashMap<String, super::ModelDetails> {
    let Some(registry) = bin.and_then(embedded_registry) else {
        return std::collections::HashMap::new();
    };
    claude_model_details_from(&read_cli_config(), &registry)
}

fn claude_model_details_from(
    config: &CliModelConfig,
    registry: &EmbeddedRegistry,
) -> std::collections::HashMap<String, super::ModelDetails> {
    let default = config.resolved_default().or_else(|| registry.best.clone());
    CLI_ALIASES
        .iter()
        .filter_map(|(alias, _)| {
            let selector = if *alias == "default" {
                default.clone()?
            } else if config.override_for(alias).is_some() {
                return None;
            } else {
                alias.to_string()
            };
            let bare = selector.strip_suffix("[1m]").unwrap_or(&selector);
            let id = registry
                .alias_defaults
                .get(bare)
                .cloned()
                .unwrap_or_else(|| bare.to_string());
            let name = registry.display_names.get(&id)?.clone();
            let facts = registry.model_facts.get(&id).cloned().unwrap_or_default();
            Some((
                alias.to_string(),
                super::ModelDetails {
                    detail: Some(if *alias == "default" {
                        format!("Claude Code's default, now {name}")
                    } else {
                        id.clone()
                    }),
                    name: Some(name),
                    efforts: facts.efforts.map(|levels| {
                        levels
                            .iter()
                            .map(|level| super::EffortLevel::bare(level))
                            .collect()
                    }),
                    default_effort: facts.default_effort,
                    context_window: facts.context_window,
                    current: *alias == "default",
                    ..super::ModelDetails::default()
                },
            ))
        })
        .collect()
}

pub(super) fn claude_models(bin: Option<&std::path::Path>) -> Vec<EngineModel> {
    claude_models_from(read_cli_config(), bin.and_then(embedded_registry).as_ref())
}

fn claude_models_from(
    config: CliModelConfig,
    registry: Option<&EmbeddedRegistry>,
) -> Vec<EngineModel> {
    let resolved_default = config
        .resolved_default()
        .or_else(|| registry.and_then(|r| r.best.clone()));
    CLI_ALIASES
        .iter()
        .map(|(id, name)| {
            let display = FAMILY_ENV_KEYS
                .iter()
                .find(|(f, _, _)| *f == *id)
                .map(|(_, _, d)| *d);
            let custom = config.override_for(id);
            let (name, description) = match (display, custom) {
                (Some(display), Some(custom)) => (
                    Some(custom.to_string()),
                    Some(format!("Custom {display} model")),
                ),
                _ if *id == "default" => (
                    Some(name.to_string()),
                    resolved_default.as_ref().map(|d| {
                        let line = registry
                            .map(|r| r.display_line(d))
                            .unwrap_or_else(|| d.clone());
                        format!("Use the default model (currently {line})")
                    }),
                ),
                _ => (
                    Some(name.to_string()),
                    registry.and_then(|r| {
                        r.alias_defaults
                            .get(*id)
                            .map(|model_id| r.display_line(model_id))
                    }),
                ),
            };
            EngineModel {
                id: id.to_string(),
                name,
                description,
                provider: "claude".to_string(),
                context_window: None,
            }
        })
        .collect()
}

#[cfg(test)]
#[path = "claude_tests.rs"]
mod tests;
