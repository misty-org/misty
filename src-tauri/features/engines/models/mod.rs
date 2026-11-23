// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/models/mod.rs.
//! Per-engine model catalog for the composer's model picker.
//!
//! Only the pi family (pi/omp) exposes a machine-readable catalog. Probe
//! chain, first success wins:
//!   1. `<bin> models --json` — richest shape (selector, display name,
//!      context window); omp-native, older pi may lack it.
//!   2. `<bin> --list-models --no-extensions` — fixed-width table
//!      `provider  model  ctx  max-out  thinking  images`; extensions slow
//!      the probe by ~10x (upstream evidence), so skip their boot.
//!   3. `<bin> --list-models` — bare retry for binaries that reject the flag.
//!
//! Codex ships its catalog inside the binary: `codex debug models` renders
//! it as JSON (the picker's entries are the ones with `visibility: "list"`).
//! Fallback when the probe fails (old binary): the CLI's own config names
//! the active model — top-level `model = "…"` in $CODEX_HOME/config.toml.
//! Claude runs entirely on the CLI's own configuration: the catalog is
//! the built-in aliases `claude --model` resolves (the /model menu's
//! entries) in menu order; the configured default from ~/.claude/settings.json is named
//! in the "default" row's subtitle, and each alias names the concrete model
//! id the CLI binary's embedded registry resolves it to. No
//! relay probe: the /model menu is built into the CLI binary. The app's
//! provider channels never feed
//! it. Kimi keeps its own
//! provider registry — `kimi provider list --json` is the authoritative
//! selector catalog (and, offline, the `[models.*]` tables in
//! $KIMI_CODE_HOME/config.toml — `kimi -m` takes aliases, not relay ids).
//! Grok's `-m` resolves `[model.<alias>]` sections (or
//! built-in names), never relay API ids, so its catalog is the `[model.*]`
//! tables in $GROK_HOME/config.toml with `[models].default` leading — the
//! same entries the CLI's own /model menu lists. The CLI-maintained
//! models_cache.json holds the relay's /v1/models ids, which `-m` cannot
//! resolve, so it is deliberately not a source. agy is `agy models` TSV
//! (`id<TAB>name`). OpenCode lists `provider/model` ids via `opencode
//! models` (ANSI table), with a generated fallback catalog when the probe
//! cannot run. Qoder has no list subcommand: its catalog only exists on the
//! ACP session/new result, so a temp-dir handshake probes it on demand and
//! caches the last success. Remaining engines are filled by the frontend
//! from the configured provider channels instead.

mod acp;
mod agy;
mod claude;
mod codebuddy;
mod codex;
mod grok;
mod kimi;
mod minimax;
mod opencode;
mod pi;
mod qoder;
pub(crate) mod usable;

pub(crate) use acp::{acp_modes, acp_thought_levels};

pub(crate) fn resolve_claude_launch_model(selector: &str) -> String {
    claude::resolve_launch_model(selector)
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EffortLevel {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub badge: Option<String>,
}

impl EffortLevel {
    pub fn bare(id: &str) -> Self {
        Self {
            id: id.to_string(),
            ..Self::default()
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FastMode {
    pub label: String,
    pub tier: String,
}

pub(crate) fn claude_fast_offered(model: Option<&str>) -> bool {
    let Some((_, details)) = claude::account_catalog(None) else {
        return false;
    };
    match model.filter(|model| !model.trim().is_empty()) {
        Some(id) => details.get(id).is_some_and(|facts| facts.fast.is_some()),
        None => details
            .values()
            .any(|facts| facts.current && facts.fast.is_some()),
    }
}

#[derive(Debug, Clone, Default)]
pub struct ModelDetails {
    pub name: Option<String>,
    pub detail: Option<String>,
    pub efforts: Option<Vec<EffortLevel>>,
    pub default_effort: Option<String>,
    pub context_window: Option<u64>,
    pub section: Option<String>,
    pub fast: Option<FastMode>,
    pub notice: Option<String>,
    pub current: bool,
}

pub(crate) fn claude_comparison_model(
    selector: &str,
    bin: &str,
    channel_env: Option<&std::collections::HashMap<String, String>>,
    workspace: &std::path::Path,
) -> Option<String> {
    let path = super::resolve::find_cli_binary("claude", Some(bin));
    claude::comparison_model(selector, path.as_deref(), channel_env, workspace)
}

use serde::Serialize;

const PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

pub(super) async fn run_probe(bin: &str, args: &[&str], probe: &str) -> Result<String, String> {
    let mut cmd = super::command_for_binary(bin);
    for arg in args {
        cmd.arg(arg);
    }
    cmd.kill_on_drop(true);
    #[cfg(windows)]
    super::hide_console(&mut cmd);
    let output = tokio::time::timeout(PROBE_TIMEOUT, cmd.output())
        .await
        .map_err(|_| format!("{bin} {probe} timed out"))?
        .map_err(|e| format!("failed to run {bin}: {e}"))?;
    if !output.status.success() {
        return Err(format!("{bin} {probe} exited with {}", output.status));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineModel {
    pub id: String,
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub provider: String,
    pub context_window: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineCatalog {
    pub models: Vec<EngineModel>,
    #[serde(skip)]
    pub details: std::collections::HashMap<String, ModelDetails>,
    pub authoritative: bool,
}

impl EngineCatalog {
    fn authoritative(models: Vec<EngineModel>) -> Self {
        Self {
            models,
            details: std::collections::HashMap::new(),
            authoritative: true,
        }
    }

    pub(super) fn unknown() -> Self {
        Self {
            authoritative: false,
            ..Self::authoritative(Vec::new())
        }
    }

    fn with_details(mut self, details: std::collections::HashMap<String, ModelDetails>) -> Self {
        self.details = details;
        self
    }
}

pub async fn list_engine_models(engine: String) -> Result<EngineCatalog, String> {
    crate::engines::support::config::ensure_engine_enabled(&engine)?;
    match engine.as_str() {
        "codex" => Ok(codex_catalog().await),
        "kimi" => Ok(kimi_catalog().await),
        "grok" => Ok(grok_catalog()),
        "claude" => Ok(claude_catalog()),
        "pi" | "omp" => Ok(pi_family_catalog(&engine).await),
        "dsh" => dsh_catalog().await,
        "agy" => Ok(agy_catalog().await),
        "opencode" => Ok(opencode_catalog().await),
        "qoder" => qoder_catalog("qoder").await,
        "qoder-cn" => qoder_catalog("qoder-cn").await,
        "minimax" => {
            let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
            let bin = super::engine_bin(&settings, "minimax");
            Ok(minimax::minimax_catalog(&bin).await)
        }
        "codebuddy" => {
            let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
            let bin = super::engine_bin(&settings, "codebuddy");
            Ok(codebuddy::codebuddy_catalog(&bin).await)
        }
        _ => Ok(EngineCatalog::authoritative(Vec::new())),
    }
}

async fn agy_catalog() -> EngineCatalog {
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let bin = super::engine_bin(&settings, "agy");
    agy::agy_catalog(&bin).await
}

async fn opencode_catalog() -> EngineCatalog {
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let bin = super::engine_bin(&settings, "opencode");
    opencode::opencode_catalog(&bin).await
}

async fn qoder_catalog(engine: &'static str) -> Result<EngineCatalog, String> {
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let bin = super::engine_bin(&settings, engine);
    qoder::qoder_catalog(engine, &bin).await
}

async fn dsh_catalog() -> Result<EngineCatalog, String> {
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let origin = crate::engines::support::dsh_host::configured_origin(&settings);
    let catalog =
        crate::engines::support::dsh_host::host_call(&origin, "session/modelCatalog", serde_json::json!({}))
            .await
            .map_err(|_| {
                format!("The DSH host isn't running ({origin}). Start it from the DeepSeek Harness settings, then try again.")
            })?;
    Ok(EngineCatalog::authoritative(flatten_llm_models(
        &catalog,
        catalog.get("default"),
    )))
}

fn flatten_llm_models(
    catalog: &serde_json::Value,
    describe: Option<&serde_json::Value>,
) -> Vec<EngineModel> {
    let current = describe.and_then(|value| {
        let provider = value.get("provider")?.as_str()?.trim();
        let model = value.get("model")?.as_str()?.trim();
        if provider.is_empty() || model.is_empty() {
            return None;
        }
        Some(format!("{provider}/{model}"))
    });
    let mut models = Vec::new();
    let mut default_id = current;
    for group in catalog
        .get("groups")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
    {
        let provider = group
            .get("id")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("unknown")
            .trim();
        for model in group
            .get("models")
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
        {
            let model_id = model
                .get("id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .trim();
            if provider.is_empty() || model_id.is_empty() {
                continue;
            }
            let id = format!("{provider}/{model_id}");
            if default_id.is_none()
                && model.get("default").and_then(serde_json::Value::as_bool) == Some(true)
            {
                default_id = Some(id.clone());
            }
            models.push(EngineModel {
                id,
                name: model
                    .get("name")
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|name| !name.is_empty() && *name != model_id)
                    .map(str::to_string),
                description: model
                    .get("description")
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|text| !text.is_empty())
                    .map(str::to_string),
                provider: provider.to_string(),
                context_window: None,
            });
        }
    }
    if let Some(default_id) = default_id {
        if let Some(index) = models.iter().position(|model| model.id == default_id) {
            models.rotate_left(index);
        }
    }
    models
}

async fn codex_catalog() -> EngineCatalog {
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let bin = super::engine_bin(&settings, "codex");
    if let Ok((mut models, details)) = codex::run_codex_debug_models(&bin).await {
        if !models.is_empty() {
            let configured = codex::codex_config_model();
            if let Some(window) = configured.as_ref().and_then(|model| model.context_window) {
                for model in &mut models {
                    model.context_window = Some(window);
                }
            }
            let own_provider =
                configured.is_some() && usable::configured_default("codex").is_none();
            let models = if own_provider {
                with_default_first(models, configured)
            } else {
                models
            };
            return usable::settle(
                "codex",
                EngineCatalog::authoritative(models).with_details(details),
            );
        }
    }
    EngineCatalog::authoritative(codex::codex_config_model().into_iter().collect())
}

async fn kimi_catalog() -> EngineCatalog {
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let bin = super::engine_bin(&settings, "kimi");
    if let Ok(models) = kimi::run_kimi_provider_list(&bin).await {
        if !models.is_empty() {
            return EngineCatalog::authoritative(with_default_first(
                models,
                kimi::kimi_default_model(),
            ));
        }
    }
    let local = kimi::kimi_local_models();
    if !local.is_empty() {
        return EngineCatalog::authoritative(local);
    }
    EngineCatalog::authoritative(kimi::kimi_default_model().into_iter().collect())
}

fn grok_catalog() -> EngineCatalog {
    EngineCatalog::authoritative(grok::grok_local_models())
}

fn claude_catalog() -> EngineCatalog {
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let bin = super::engine_bin(&settings, "claude");
    let bin_path = super::resolve::find_cli_binary("claude", Some(&bin));
    if let Some((models, details)) = claude::account_catalog(bin_path.as_deref()) {
        return EngineCatalog::authoritative(models).with_details(details);
    }
    EngineCatalog::authoritative(claude::claude_models(bin_path.as_deref()))
        .with_details(claude::claude_model_details(bin_path.as_deref()))
}

async fn pi_family_catalog(engine: &str) -> EngineCatalog {
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let bin = super::engine_bin(&settings, engine);
    let configured = pi::configured_models(engine).unwrap_or_default();
    if let Ok((models, details)) = pi::run_models_json(&bin).await {
        if !models.is_empty() {
            return usable::settle(
                engine,
                EngineCatalog::authoritative(pi::merge_configured_models(models, configured))
                    .with_details(details),
            );
        }
    }
    for extra in [&["--no-extensions"][..], &[][..]] {
        if let Ok(models) = pi::run_list_models(&bin, extra).await {
            if !models.is_empty() {
                return usable::settle(
                    engine,
                    EngineCatalog::authoritative(pi::merge_configured_models(models, configured)),
                );
            }
        }
    }
    EngineCatalog::authoritative(configured)
}

fn parse_top_level_toml_string(content: &str, key: &str) -> Option<String> {
    for line in content.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            break;
        }
        let Some((name, value)) = line.split_once('=') else {
            continue;
        };
        if name.trim() != key {
            continue;
        }
        let value = value.trim_start();
        for quote in ['"', '\''] {
            if let Some(rest) = value.strip_prefix(quote) {
                if let Some(end) = rest.find(quote) {
                    let model = rest[..end].trim();
                    if !model.is_empty() {
                        return Some(model.to_string());
                    }
                }
            }
        }
    }
    None
}

#[allow(
    clippy::disallowed_methods,
    reason = "reads an engine's own config in place, which its home's env override may move outside the engine folders the gate grants"
)]
pub(super) fn config_toml_model(
    home: &std::path::Path,
    key: &str,
    provider: &str,
) -> Option<EngineModel> {
    let content = std::fs::read_to_string(home.join("config.toml")).ok()?;
    let id = parse_top_level_toml_string(&content, key)?;
    Some(EngineModel {
        id,
        name: None,
        description: None,
        provider: provider.to_string(),
        context_window: None,
    })
}

pub(super) struct AliasFields {
    pub name_keys: &'static [&'static str],
    pub context_keys: &'static [&'static str],
    pub provider_key: Option<&'static str>,
}

pub(super) fn alias_table_catalog(
    root: &toml::Value,
    table: &str,
    default_provider: &str,
    fields: &AliasFields,
) -> Vec<EngineModel> {
    let mut models: Vec<EngineModel> = root
        .get(table)
        .and_then(toml::Value::as_table)
        .map(|table| {
            table
                .iter()
                .map(|(alias, entry)| {
                    let name = fields
                        .name_keys
                        .iter()
                        .find_map(|key| entry.get(key).and_then(toml::Value::as_str))
                        .map(str::trim)
                        .filter(|n| !n.is_empty() && *n != alias.as_str())
                        .map(str::to_string);
                    let provider = fields
                        .provider_key
                        .and_then(|key| entry.get(key).and_then(toml::Value::as_str))
                        .unwrap_or(default_provider)
                        .to_string();
                    let context_window = fields
                        .context_keys
                        .iter()
                        .find_map(|key| entry.get(key).and_then(toml::Value::as_integer))
                        .and_then(|n| u64::try_from(n).ok());
                    EngineModel {
                        id: alias.clone(),
                        name,
                        description: None,
                        provider,
                        context_window,
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    models.sort_by(|a, b| a.id.cmp(&b.id));
    models
}

pub(super) fn promote_default(models: &mut Vec<EngineModel>, default: Option<&str>) {
    if let Some(default) = default {
        if let Some(index) = models.iter().position(|m| m.id == default) {
            let entry = models.remove(index);
            models.insert(0, entry);
        }
    }
}

pub(super) fn with_default_first(
    models: Vec<EngineModel>,
    default: Option<EngineModel>,
) -> Vec<EngineModel> {
    let Some(default) = default else {
        return models;
    };
    let mut models = models;
    match models.iter().position(|m| m.id == default.id) {
        Some(0) => models,
        Some(i) => {
            let entry = models.remove(i);
            models.insert(0, entry);
            models
        }
        None => {
            models.insert(0, default);
            models
        }
    }
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
