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
/// The model registry the CLI embeds in its binary (native build or cli.js
/// bundle alike): per-family alias defaults (`aliases.<family>.default`),
/// the `best` alias used when nothing is configured, and each model's
/// human display name. Extracted from raw bytes; the JS object survives
/// bundling verbatim.
#[derive(Clone, Debug, Default)]
pub(super) struct EmbeddedRegistry {
    /// alias family → resolved first-party model id ("opus" → "claude-opus-5").
    alias_defaults: std::collections::HashMap<String, String>,
    provider_defaults: std::collections::HashMap<(String, String), String>,
    /// model id → human name ("claude-opus-5" → "Opus 5").
    display_names: std::collections::HashMap<String, String>,
    /// model id → its effort levels, default effort and context window.
    model_facts: std::collections::HashMap<String, ModelFacts>,
    /// The CLI's built-in default alias when no model is configured.
    best: Option<String>,
}

/// What a model's registry record says beyond its name.
#[derive(Clone, Debug, Default)]
struct ModelFacts {
    /// Effort levels it takes, weakest first. None when its record has no
    /// capabilities list to read.
    efforts: Option<Vec<String>>,
    default_effort: Option<String>,
    context_window: Option<u64>,
}

/// One model record's facts: `capabilities:["effort","xhigh_effort",…]`,
/// `default_effort:"medium"` and `context:{window:1e6,…}`.
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
    /// "Opus 5 · claude-opus-5" for a known selector (alias or id, with or
    /// without the [1m] suffix); the selector verbatim when the registry
    /// can't resolve it.
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

/// Parse the embedded registry out of the binary's raw bytes.
fn parse_registry(bytes: &[u8]) -> EmbeddedRegistry {
    use regex::bytes::Regex;
    let mut registry = EmbeddedRegistry::default();
    // Models array: `id:"claude-opus-5",family:"opus",display_name:"Opus 5"`.
    let models_re = Regex::new(r#"id:"([^"]+)",family:"[a-z]+",display_name:"([^"]+)""#).unwrap();
    let records: Vec<_> = models_re.captures_iter(bytes).collect();
    for (index, m) in records.iter().enumerate() {
        let id = String::from_utf8_lossy(&m[1]).into_owned();
        registry
            .display_names
            .insert(id.clone(), String::from_utf8_lossy(&m[2]).into_owned());
        // The rest of this record: up to the next one, the array's end, or 4 KB.
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
    // `aliases:{opus:{default:"claude-opus-5",per_provider:{…}},…}` followed
    // by `defaults:{…},best:"fable"` — one compact object, so bound the
    // window to keep unrelated `{default:"…"}` code from leaking in.
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

/// Read the CLI binary's embedded registry, cached per binary content: the
/// picker re-queries on every open and the scan reads the whole binary.
/// None for shims/old builds without an extractable registry — the catalog
/// then degrades to bare family names.
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

/// Selectors `claude --model` accepts out of the box — exactly the five rows
/// the CLI's own /model menu lists, in menu order (no [1m] variants, no
/// extra "configured" row). "fable" only exists on newer CLI builds — the
/// catalog is advisory, an unresolvable pick fails at launch with the CLI's
/// own error.
const CLI_ALIASES: &[(&str, &str)] = &[
    ("default", "Default"),
    ("opus", "Opus"),
    ("fable", "Fable"),
    ("sonnet", "Sonnet"),
    ("haiku", "Haiku"),
];

/// The CLI's config root: $CLAUDE_CONFIG_DIR when set, else ~/.claude.
fn claude_config_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }
    dirs::home_dir().expect("no home directory").join(".claude")
}

/// env keys that remap a built-in alias family to a custom model id,
/// mirroring the CLI's own /model menu ("Custom Opus model" rows).
const FAMILY_ENV_KEYS: &[(&str, &str, &str)] = &[
    // (alias family, env key, display name)
    ("opus", "ANTHROPIC_DEFAULT_OPUS_MODEL", "Opus"),
    ("sonnet", "ANTHROPIC_DEFAULT_SONNET_MODEL", "Sonnet"),
    ("haiku", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "Haiku"),
    ("fable", "ANTHROPIC_DEFAULT_FABLE_MODEL", "Fable"),
];

/// The CLI's model configuration from ~/.claude/settings.json, merged per
/// field with settings.local.json winning (the CLI's own precedence).
#[derive(Default)]
struct CliModelConfig {
    /// env.ANTHROPIC_MODEL — the CLI's effective default model id.
    env_model: Option<String>,
    /// Top-level `model` key (an alias like "opus" or a raw id).
    model_key: Option<String>,
    /// env.ANTHROPIC_DEFAULT_<FAMILY>_MODEL overrides, keyed by family.
    overrides: std::collections::HashMap<String, String>,
    provider_flags: std::collections::HashMap<String, String>,
}

impl CliModelConfig {
    /// The custom id a family alias resolves to, when overridden.
    fn override_for(&self, family: &str) -> Option<&str> {
        self.overrides.get(family).map(String::as_str)
    }

    /// The CLI's effective default model id: env.ANTHROPIC_MODEL beats the
    /// `model` key (the CLI applies settings env as real environment
    /// variables); a bare family alias there resolves through its override.
    /// A `[1m]` suffix on the raw default survives the override, the same
    /// contract as the launch selector — otherwise the "default" route
    /// would silently downgrade a 1M pick.
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

/// The model id a picker selector actually runs, for launch: a family alias
/// resolves through its ANTHROPIC_DEFAULT_<FAMILY>_MODEL override, "default"
/// through the CLI's configured default; anything unmapped passes through
/// for the CLI to resolve itself. Relay setups depend on the env remap,
/// which some CLI builds/shims skip — launching with the id the picker
/// names makes the request match the display regardless.
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
    // The person explicitly chose the 1M variant (`<family>[1m]`): the suffix is only used to
    // look up the family mapping, and on an override it is put back on the mapped value. This
    // used to return the override without the suffix, so under the official config the suffix
    // was silently dropped and a 1M request fell back to the normal window, while the channel
    // side (claude_channel) kept it. Without an override `unwrap_or_else` already returns the
    // selector as it is.
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

/// Resolve only the comparison evidence; keep the CLI's selector unchanged.
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
                    if let Ok(content) = std::fs::read_to_string(dir.join(name)) {
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
    // The comparison value is the concrete model name, not the launcher: `[1m]` is a
    // selector/launch convention and the model name the server reports has no such suffix (the
    // frontend's bareModel strips `[1m]` before comparing too). So this keeps stripping the
    // suffix; only the launch value needs it put back.
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

fn read_cli_config_from(dir: &std::path::Path) -> CliModelConfig {
    let mut config = CliModelConfig::default();
    // User settings first so the local file overrides per field.
    for name in ["settings.json", "settings.local.json"] {
        if let Ok(content) = std::fs::read_to_string(dir.join(name)) {
            merge_settings_json(&mut config, &content);
        }
    }
    config
}

/// Per-field settings merge (settings.local.json wins).
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

/// What the CLI's registry says about the model each of its aliases runs, by
/// alias: its name ("Opus 5.5"), id, effort levels, default effort and
/// context window. "default" names what the configured default resolves to.
/// An alias remapped to a custom model, and every alias when the binary has
/// no readable registry, is left out: the registry can't speak for it. Used
/// only when the CLI has no account catalog cached (`account_catalog`).
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
                    // The model it runs; the "default" row keeps "Default" as its label.
                    name: Some(name),
                    efforts: facts.efforts.map(|levels| {
                        levels.iter().map(|level| super::EffortLevel::bare(level)).collect()
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

/// Claude Code's own model menu for the signed-in account: the catalog the CLI downloads and
/// caches in `<config>/cache/model-catalog/` (the `-cc.json` file is the terminal CLI's; the
/// desktop app's `-ccd.json` is the same list). Its main models, then the ones its menu keeps
/// under "More models", each with its own name, description, effort levels (named, with the
/// CLI's badges), the level the CLI last used with it, context window, fast mode and notice.
/// None when nothing is cached, or when the CLI runs on a custom endpoint, another cloud or
/// remapped families: the account's catalog doesn't describe those, and the aliases do.
pub(super) fn account_catalog(
    bin: Option<&std::path::Path>,
) -> Option<(Vec<EngineModel>, std::collections::HashMap<String, super::ModelDetails>)> {
    let config = read_cli_config();
    let elsewhere = config
        .provider_flags
        .values()
        .any(|value| !matches!(value.as_str(), "" | "0" | "false"));
    if elsewhere || !config.overrides.is_empty() || uses_custom_endpoint() {
        return None;
    }
    let dir = claude_config_dir().join("cache").join("model-catalog");
    let file = catalog_file(&dir, signed_in_org().as_deref())?;
    let value: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok()?;
    let version = bin.and_then(cli_version);
    let catalog = parse_account_catalog(&value, version.as_deref());
    (!catalog.0.is_empty()).then_some(catalog)
}

/// The CLI's settings point it at another endpoint (a relay or gateway).
fn uses_custom_endpoint() -> bool {
    if std::env::var_os("ANTHROPIC_BASE_URL").is_some_and(|value| !value.is_empty()) {
        return true;
    }
    let dir = claude_config_dir();
    ["settings.json", "settings.local.json"].iter().any(|name| {
        std::fs::read_to_string(dir.join(name))
            .ok()
            .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
            .and_then(|value| {
                value
                    .pointer("/env/ANTHROPIC_BASE_URL")
                    .and_then(serde_json::Value::as_str)
                    .map(|url| !url.trim().is_empty())
            })
            .unwrap_or(false)
    })
}

/// The signed-in account's organization, from the CLI's own `.claude.json`.
fn signed_in_org() -> Option<String> {
    let path = match std::env::var_os("CLAUDE_CONFIG_DIR").filter(|dir| !dir.is_empty()) {
        Some(dir) => PathBuf::from(dir).join(".claude.json"),
        None => dirs::home_dir()?.join(".claude.json"),
    };
    let value: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    value
        .pointer("/oauthAccount/organizationUuid")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .filter(|org| !org.is_empty())
}

/// The cached catalog to read: the signed-in organization's terminal (`-cc`) catalog, else the
/// newest terminal one, else the newest desktop (`-ccd`) one. The published, unsigned-in
/// catalog (`published-*`) is the CLI's own fallback document, not an account's menu.
fn catalog_file(dir: &std::path::Path, org: Option<&str>) -> Option<PathBuf> {
    let mut files: Vec<(PathBuf, String, std::time::SystemTime)> = std::fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let modified = entry.metadata().ok()?.modified().ok()?;
            (name.ends_with(".json") && !name.starts_with("published"))
                .then(|| (entry.path(), name, modified))
        })
        .collect();
    files.sort_by(|a, b| b.2.cmp(&a.2));
    let terminal = |name: &str| name.ends_with("-cc.json");
    let desktop = |name: &str| name.ends_with("-ccd.json");
    let prefix = org.map(|org| format!("{org}-"));
    prefix
        .as_deref()
        .and_then(|prefix| {
            files
                .iter()
                .find(|file| file.1.starts_with(prefix) && terminal(file.1.as_str()))
        })
        .or_else(|| files.iter().find(|file| terminal(file.1.as_str())))
        .or_else(|| files.iter().find(|file| desktop(file.1.as_str())))
        .map(|file| file.0.clone())
}

/// The installed CLI's version, from its versioned install path
/// (`…/claude/versions/2.1.322`). None when the path doesn't say.
fn cli_version(bin: &std::path::Path) -> Option<String> {
    let resolved = std::fs::canonicalize(bin).ok()?;
    let name = resolved.file_name()?.to_string_lossy().into_owned();
    let parts: Vec<&str> = name.split('.').collect();
    (parts.len() == 3 && parts.iter().all(|part| part.parse::<u64>().is_ok())).then_some(name)
}

/// `a` is older than `b`, both dotted numbers ("2.1.251" < "2.1.280").
fn older(a: &str, b: &str) -> bool {
    let parse = |text: &str| -> Vec<u64> {
        text.split('.').map(|part| part.parse().unwrap_or(0)).collect()
    };
    parse(a) < parse(b)
}

fn parse_account_catalog(
    value: &serde_json::Value,
    cli_version: Option<&str>,
) -> (Vec<EngineModel>, std::collections::HashMap<String, super::ModelDetails>) {
    let text = |value: Option<&serde_json::Value>| {
        value
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string)
    };
    let mut models = Vec::new();
    let mut details = std::collections::HashMap::new();
    let Some(catalog) = value.get("catalog") else {
        return (models, details);
    };
    // The level the CLI last used with each model, and the model it runs now.
    let remembered: std::collections::HashMap<String, String> = catalog
        .pointer("/state/thinking_by_model")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            Some((
                text(entry.get("id"))?,
                text(entry.pointer("/thinking/effort"))?,
            ))
        })
        .collect();
    let current = text(catalog.pointer("/state/model"));
    for row in catalog
        .pointer("/config/models")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(id) = text(row.get("id")) else {
            continue;
        };
        // A model this CLI is too old to run stays out of its menu, as the CLI's own does.
        if let (Some(needs), Some(have)) = (text(row.get("min_claude_code_version")), cli_version) {
            if older(have, &needs) {
                continue;
            }
        }
        let name = text(row.get("name"));
        let description = text(row.get("description"));
        let runtime = row.get("runtime");
        let efforts = match text(row.pointer("/thinking/type")).as_deref() {
            Some("effort") => Some(
                row.pointer("/thinking/effort_options")
                    .and_then(serde_json::Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|option| {
                        Some(super::EffortLevel {
                            id: text(option.get("id"))?,
                            name: text(option.get("name")),
                            description: text(option.pointer("/tooltip/content")),
                            badge: text(option.pointer("/badge/message")),
                        })
                    })
                    .collect::<Vec<_>>(),
            ),
            Some("none") => Some(Vec::new()),
            _ => runtime
                .and_then(|runtime| runtime.get("effort_levels"))
                .and_then(serde_json::Value::as_array)
                .map(|levels| {
                    levels
                        .iter()
                        .filter_map(|level| text(Some(level)))
                        .map(|level| super::EffortLevel::bare(&level))
                        .collect()
                }),
        };
        let context_window = runtime
            .and_then(|runtime| runtime.get("max_input_tokens"))
            .and_then(serde_json::Value::as_u64);
        details.insert(
            id.clone(),
            super::ModelDetails {
                name: name.clone(),
                detail: description.clone(),
                efforts,
                default_effort: remembered
                    .get(&id)
                    .cloned()
                    .or_else(|| text(runtime.and_then(|runtime| runtime.get("default_effort")))),
                context_window,
                section: Some(
                    if text(row.get("section")).as_deref() == Some("main") {
                        "main"
                    } else {
                        "more"
                    }
                    .to_string(),
                ),
                // Its fast mode by the CLI's own name for it, and the option that turns it on.
                fast: row.get("fast_mode").and_then(|fast| {
                    Some(super::FastMode {
                        label: text(fast.get("name"))?,
                        tier: fast
                            .get("options")
                            .and_then(serde_json::Value::as_array)
                            .into_iter()
                            .flatten()
                            .filter_map(|option| text(option.get("id")))
                            .find(|id| id != "off")?,
                    })
                }),
                notice: text(row.pointer("/notice/text")),
                current: current.as_deref() == Some(id.as_str()),
            },
        );
        models.push(EngineModel {
            id,
            name,
            description,
            provider: "claude".to_string(),
            context_window,
        });
    }
    (models, details)
}

/// Claude's picker catalog: the CLI's built-in aliases, default row first.
/// Aliases remapped via ANTHROPIC_DEFAULT_<FAMILY>_MODEL display the custom
/// id as the name with the CLI menu's "Custom <Family> model" subtitle;
/// unremapped aliases name the concrete model the CLI's embedded registry
/// resolves them to, so the picker shows what a request actually runs.
pub(super) fn claude_models(bin: Option<&std::path::Path>) -> Vec<EngineModel> {
    claude_models_from(read_cli_config(), bin.and_then(embedded_registry).as_ref())
}

fn claude_models_from(
    config: CliModelConfig,
    registry: Option<&EmbeddedRegistry>,
) -> Vec<EngineModel> {
    // Nothing configured: the CLI runs the registry's `best` alias.
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
mod tests {
    use super::*;

    #[test]
    fn aliases_cover_the_cli_model_menu() {
        let ids: Vec<&str> = CLI_ALIASES.iter().map(|(id, _)| *id).collect();
        assert_eq!(ids, vec!["default", "opus", "fable", "sonnet", "haiku"]);
    }

    #[test]
    fn cli_config_local_overrides_user_per_field() {
        let dir = std::env::temp_dir().join(format!("ccgui-claude-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("settings.json"),
            r#"{"model":"opus","env":{"ANTHROPIC_MODEL":"sonnet","ANTHROPIC_DEFAULT_OPUS_MODEL":"grok-4.5"}}"#,
        )
        .unwrap();
        std::fs::write(dir.join("settings.local.json"), r#"{"model":"haiku"}"#).unwrap();
        let config = read_cli_config_from(&dir);
        std::fs::remove_dir_all(&dir).ok();
        // Local `model` wins its field; the user file's env fields survive.
        assert_eq!(config.model_key.as_deref(), Some("haiku"));
        assert_eq!(config.env_model.as_deref(), Some("sonnet"));
        assert_eq!(config.override_for("opus"), Some("grok-4.5"));
        assert_eq!(config.override_for("sonnet"), None);
    }

    #[test]
    fn launch_model_resolves_overrides_and_passes_the_rest_through() {
        let dir = std::env::temp_dir().join(format!("ccgui-claude-test4-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("settings.json"),
            r#"{"model":"opus","env":{"ANTHROPIC_DEFAULT_OPUS_MODEL":"gemini-3.8-flash"}}"#,
        )
        .unwrap();
        let config = read_cli_config_from(&dir);
        std::fs::remove_dir_all(&dir).ok();
        // Overridden alias → custom id (what the picker names it).
        assert_eq!(
            resolve_launch_model_from(&config, "opus"),
            "gemini-3.8-flash"
        );
        // `<family>[1m]` with an override: the person chose the 1M variant, so the suffix must
        // follow onto the mapped value. This used to return the override without it: the channel
        // side (claude_channel) kept the suffix, the official config dropped it, and a 1M
        // request silently fell back to the normal window.
        assert_eq!(
            resolve_launch_model_from(&config, "opus[1m]"),
            "gemini-3.8-flash[1m]"
        );
        // "default" → the CLI's configured default, override applied.
        assert_eq!(
            resolve_launch_model_from(&config, "default"),
            "gemini-3.8-flash"
        );
        // Unmapped aliases and raw ids pass through for the CLI to resolve.
        assert_eq!(resolve_launch_model_from(&config, "sonnet"), "sonnet");
        assert_eq!(
            resolve_launch_model_from(&config, "claude-opus-5"),
            "claude-opus-5"
        );
        // Nothing configured: "default" stays an alias for the CLI's `best`.
        assert_eq!(
            resolve_launch_model_from(&CliModelConfig::default(), "default"),
            "default"
        );
    }

    #[test]
    fn cli_config_reads_env_when_no_local_file() {
        let dir = std::env::temp_dir().join(format!("ccgui-claude-test2-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("settings.json"),
            r#"{"model":"opus","env":{"ANTHROPIC_MODEL":"k3"}}"#,
        )
        .unwrap();
        let config = read_cli_config_from(&dir);
        std::fs::remove_dir_all(&dir).ok();
        // env.ANTHROPIC_MODEL outranks the `model` key within one file.
        assert_eq!(config.resolved_default().as_deref(), Some("k3"));
    }

    #[test]
    fn catalog_labels_overridden_aliases_like_the_cli_menu() {
        let dir = std::env::temp_dir().join(format!("ccgui-claude-test3-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("settings.json"),
            r#"{"model":"opus","env":{
                "ANTHROPIC_MODEL":"grok-4.5",
                "ANTHROPIC_DEFAULT_OPUS_MODEL":"grok-4.5",
                "ANTHROPIC_DEFAULT_SONNET_MODEL":"grok-4.5",
                "ANTHROPIC_DEFAULT_HAIKU_MODEL":"grok-4.5",
                "ANTHROPIC_DEFAULT_FABLE_MODEL":"grok-4.5"
            }}"#,
        )
        .unwrap();
        let config = read_cli_config_from(&dir);
        std::fs::remove_dir_all(&dir).ok();
        // The /model menu's main label is the resolved custom id, with the
        // "Custom <Family> model" subtitle the CLI shows.
        let models = claude_models_from(config, None);
        let by_id = |id: &str| models.iter().find(|m| m.id == id).unwrap();
        let opus = by_id("opus");
        assert_eq!(opus.name.as_deref(), Some("grok-4.5"));
        assert_eq!(opus.description.as_deref(), Some("Custom Opus model"));
        assert_eq!(
            by_id("fable").description.as_deref(),
            Some("Custom Fable model")
        );
        let default = by_id("default");
        assert_eq!(default.name.as_deref(), Some("Default"));
        assert_eq!(
            default.description.as_deref(),
            Some("Use the default model (currently grok-4.5)")
        );
        // Exactly the CLI menu's five rows, "default" first — no extra
        // "configured" row, no [1m] variants.
        assert_eq!(models.len(), 5);
        assert_eq!(models[0].id, "default");
    }

    #[test]
    fn resolved_default_maps_alias_through_override() {
        let config = CliModelConfig {
            provider_flags: Default::default(),
            env_model: None,
            model_key: Some("opus[1m]".to_string()),
            overrides: [("opus".to_string(), "grok-4.5".to_string())]
                .into_iter()
                .collect(),
        };
        // A default model written as `<family>[1m]` with an override: the suffix follows onto
        // the mapped value, the same convention as resolve_launch_model_from's selector path.
        assert_eq!(config.resolved_default().as_deref(), Some("grok-4.5[1m]"));
        // An override that already carries `[1m]` doesn't get the suffix twice.
        let config = CliModelConfig {
            provider_flags: Default::default(),
            env_model: None,
            model_key: Some("opus[1m]".to_string()),
            overrides: [("opus".to_string(), "grok-4.5[1m]".to_string())]
                .into_iter()
                .collect(),
        };
        assert_eq!(config.resolved_default().as_deref(), Some("grok-4.5[1m]"));
        // A raw id passes through untouched.
        let config = CliModelConfig {
            env_model: Some("k3".to_string()),
            ..CliModelConfig::default()
        };
        assert_eq!(config.resolved_default().as_deref(), Some("k3"));
    }

    /// A registry snippet shaped exactly like the CLI binary's embedded
    /// object: models array, then aliases/defaults/best.
    fn fake_registry() -> EmbeddedRegistry {
        parse_registry(
            br#"[{id:"claude-opus-4-5",family:"opus",display_name:"Opus 4.5"},{id:"claude-opus-5",family:"opus",display_name:"Opus 5"},{id:"claude-fable-5",family:"fable",display_name:"Fable 5"}],aliases:{opus:{default:"claude-opus-5",per_provider:{bedrock:"claude-opus-5",gateway:"claude-opus-4-7"}},fable:{default:"claude-fable-5"}},defaults:{},best:"fable",latest_per_family:{opus:"claude-opus-5"}});"#,
        )
    }

    #[test]
    fn comparison_resolves_aliases_overrides_and_provider_variants() {
        let registry = fake_registry();
        let mut config = CliModelConfig::default();
        assert_eq!(
            comparison_model_from("opus", &config, Some(&registry)).as_deref(),
            Some("claude-opus-5")
        );
        assert_eq!(
            comparison_model_from("opus[1m]", &config, Some(&registry)).as_deref(),
            Some("claude-opus-5")
        );
        assert_eq!(
            comparison_model_from("default", &config, Some(&registry)).as_deref(),
            Some("claude-fable-5")
        );
        merge_settings_json(&mut config, r#"{"env":{"CLAUDE_CODE_USE_BEDROCK":"1"}}"#);
        assert_eq!(
            comparison_model_from("opus", &config, Some(&registry)).as_deref(),
            Some("claude-opus-5")
        );
        merge_settings_json(
            &mut config,
            r#"{"env":{"CLAUDE_CODE_USE_BEDROCK":"0","CLAUDE_CODE_USE_VERTEX":"1"}}"#,
        );
        assert_eq!(
            comparison_model_from("opus", &config, Some(&registry)),
            None
        );
        merge_settings_json(
            &mut config,
            r#"{"model":"opus","env":{"ANTHROPIC_DEFAULT_OPUS_MODEL":"custom-opus"}}"#,
        );
        assert_eq!(
            comparison_model_from("opus", &config, Some(&registry)).as_deref(),
            Some("custom-opus")
        );
        // The 1M variant's comparison value is also the concrete model name: bareModel strips
        // `[1m]` before comparing, the badge's left side already shows the chosen `opus[1m]`,
        // and the right side should give the actual model.
        assert_eq!(
            comparison_model_from("opus[1m]", &config, Some(&registry)).as_deref(),
            Some("custom-opus")
        );
        assert_eq!(
            comparison_model_from("default", &config, None).as_deref(),
            Some("custom-opus")
        );
    }

    #[test]
    fn comparison_does_not_guess_aliases_without_a_registry() {
        let config = CliModelConfig::default();
        for selector in ["opus", "sonnet", "haiku", "fable", "default"] {
            assert_eq!(comparison_model_from(selector, &config, None), None);
        }
        assert_eq!(
            comparison_model_from("claude-opus-5-5", &config, None).as_deref(),
            Some("claude-opus-5-5")
        );
    }

    #[test]
    fn parse_registry_extracts_aliases_displays_and_best() {
        let registry = fake_registry();
        assert_eq!(
            registry.alias_defaults.get("opus").map(String::as_str),
            Some("claude-opus-5")
        );
        assert_eq!(
            registry.alias_defaults.get("fable").map(String::as_str),
            Some("claude-fable-5")
        );
        assert_eq!(
            registry
                .display_names
                .get("claude-opus-5")
                .map(String::as_str),
            Some("Opus 5")
        );
        assert_eq!(registry.best.as_deref(), Some("fable"));
        // Noise without the registry's shape contributes nothing.
        assert!(
            parse_registry(br#"aliases:Qn(N(),cyg()),foo:{default:32000}"#)
                .alias_defaults
                .is_empty()
        );
    }

    #[test]
    fn display_line_resolves_aliases_suffixes_and_unknowns() {
        let registry = fake_registry();
        assert_eq!(registry.display_line("opus"), "Opus 5 · claude-opus-5");
        assert_eq!(registry.display_line("opus[1m]"), "Opus 5 · claude-opus-5");
        // A raw id resolves to its display name; an unknown selector passes
        // through verbatim.
        assert_eq!(
            registry.display_line("claude-fable-5"),
            "Fable 5 · claude-fable-5"
        );
        assert_eq!(registry.display_line("k3"), "k3");
    }

    #[test]
    fn catalog_names_the_concrete_model_each_alias_runs() {
        let registry = fake_registry();
        let config = CliModelConfig {
            model_key: Some("opus".to_string()),
            ..CliModelConfig::default()
        };
        let models = claude_models_from(config, Some(&registry));
        let by_id = |id: &str| models.iter().find(|m| m.id == id).unwrap();
        assert_eq!(
            by_id("opus").description.as_deref(),
            Some("Opus 5 · claude-opus-5")
        );
        assert_eq!(
            by_id("default").description.as_deref(),
            Some("Use the default model (currently Opus 5 · claude-opus-5)")
        );
        // No registry entry (sonnet/haiku absent from the fake) → no
        // description, same as a CLI too old to embed one.
        assert_eq!(by_id("sonnet").description, None);
    }

    #[test]
    fn catalog_falls_back_to_registry_best_when_unconfigured() {
        let registry = fake_registry();
        let models = claude_models_from(CliModelConfig::default(), Some(&registry));
        let default = models.iter().find(|m| m.id == "default").unwrap();
        assert_eq!(
            default.description.as_deref(),
            Some("Use the default model (currently Fable 5 · claude-fable-5)")
        );
        // Without a registry an unconfigured default stays silent.
        let models = claude_models_from(CliModelConfig::default(), None);
        assert_eq!(models[0].description, None);
    }

    #[test]
    fn details_name_each_alias_with_its_efforts() {
        let registry = parse_registry(
            br#"[{id:"claude-opus-5",family:"opus",display_name:"Opus 5",context:{window:1e6,native_1m:!0},capabilities:["effort","xhigh_effort","max_effort"],default_effort:"high"},{id:"claude-haiku-4",family:"haiku",display_name:"Haiku 4",capabilities:["vision"]}],aliases:{opus:{default:"claude-opus-5"},haiku:{default:"claude-haiku-4"}},defaults:{},best:"opus"});"#,
        );
        let details = claude_model_details_from(&CliModelConfig::default(), &registry);
        let opus = &details["opus"];
        assert_eq!(opus.name.as_deref(), Some("Opus 5"));
        assert_eq!(opus.detail.as_deref(), Some("claude-opus-5"));
        let levels: Vec<&str> =
            opus.efforts.iter().flatten().map(|level| level.id.as_str()).collect();
        assert_eq!(levels, ["low", "medium", "high", "xhigh", "max"]);
        assert_eq!(opus.default_effort.as_deref(), Some("high"));
        assert_eq!(opus.context_window, Some(1_000_000));
        // A model whose capabilities don't include effort takes no levels.
        assert_eq!(details["haiku"].efforts.as_ref().map(Vec::len), Some(0));
        // Nothing configured: "default" is the registry's best, and is the CLI's own pick.
        assert_eq!(details["default"].name.as_deref(), Some("Opus 5"));
        assert!(details["default"].current);
        // Not in the registry, so it isn't described.
        assert!(!details.contains_key("sonnet"));
    }

    #[test]
    fn account_catalog_is_the_cli_own_menu() {
        let value: serde_json::Value = serde_json::from_str(
            r#"{"catalog":{"config":{"models":[
              {"id":"claude-opus-5-5","name":"Opus 5.5","description":"For complex work","section":"main",
               "thinking":{"type":"effort","effort_options":[{"id":"medium","name":"Medium","badge":{"message":"Recommended"}},{"id":"xhigh","name":"Extra"}]},
               "fast_mode":{"type":"toggle","name":"Fast mode","options":[{"id":"fast","name":"Enable fast mode"},{"id":"off","name":"Off"}]},
               "runtime":{"max_input_tokens":1000000,"default_effort":"medium"}},
              {"id":"claude-haiku-4-5","name":"Haiku 4.5","section":"overflow","thinking":{"type":"none"},
               "runtime":{"max_input_tokens":200000}},
              {"id":"claude-next","name":"Next","section":"main","min_claude_code_version":"9.0.0"}
            ]},"state":{"model":"claude-opus-5-5",
              "thinking_by_model":[{"id":"claude-opus-5-5","thinking":{"type":"effort","effort":"xhigh"}}]}}}"#,
        )
        .unwrap();
        let (models, details) = parse_account_catalog(&value, Some("2.1.322"));
        // Too new for this CLI: left out, as the CLI's own menu does.
        assert_eq!(
            models.iter().map(|model| model.id.as_str()).collect::<Vec<_>>(),
            ["claude-opus-5-5", "claude-haiku-4-5"]
        );
        let opus = &details["claude-opus-5-5"];
        assert_eq!(opus.section.as_deref(), Some("main"));
        assert!(opus.current);
        let fast = opus.fast.as_ref().unwrap();
        assert_eq!((fast.label.as_str(), fast.tier.as_str()), ("Fast mode", "fast"));
        // The level the CLI last used with it wins over its default.
        assert_eq!(opus.default_effort.as_deref(), Some("xhigh"));
        let levels = opus.efforts.as_ref().unwrap();
        assert_eq!(levels[1].name.as_deref(), Some("Extra"));
        assert_eq!(levels[0].badge.as_deref(), Some("Recommended"));
        let haiku = &details["claude-haiku-4-5"];
        assert_eq!(haiku.section.as_deref(), Some("more"));
        assert_eq!(haiku.efforts.as_ref().map(Vec::len), Some(0));
        assert!(haiku.fast.is_none() && !haiku.current);
    }

    #[test]
    fn version_order_reads_each_number() {
        assert!(older("2.1.251", "2.1.280"));
        assert!(!older("2.1.322", "2.1.290"));
        assert!(older("2.9.0", "2.10.0"));
    }

}
