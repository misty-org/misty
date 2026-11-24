// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/models/mod.rs.
//! Per-engine model catalog for the composer's model picker.
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
//! it. agy is `agy models` TSV (`id<TAB>name`). Remaining engines are filled
//! by the frontend from the configured provider channels instead.

mod agy;
mod claude;
mod codex;
pub(crate) mod usable;

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
        "claude" => Ok(claude_catalog()),
        "agy" => Ok(agy_catalog().await),
        _ => Ok(EngineCatalog::authoritative(Vec::new())),
    }
}

async fn agy_catalog() -> EngineCatalog {
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let bin = super::engine_bin(&settings, "agy");
    agy::agy_catalog(&bin).await
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
