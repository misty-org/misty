// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/models/claude.rs.
//! Claude Code's account catalog: the model menu the CLI downloads for the signed-in account and
//! caches, read as the CLI's own menu.

use std::path::PathBuf;

use super::super::{EffortLevel, EngineModel, FastMode, ModelDetails};
use super::{claude_config_dir, read_cli_config};
use crate::known_names::MAIN_MODEL_SECTION;

/// Claude Code's own model menu for the signed-in account: the catalog the CLI downloads and
/// caches in `<config>/cache/model-catalog/` (the `-cc.json` file is the terminal CLI's; the
/// desktop app's `-ccd.json` is the same list). Its main models, then the ones its menu keeps
/// under "More models", each with its own name, description, effort levels (named, with the
/// CLI's badges), the level the CLI last used with it, context window, fast mode and notice.
/// None when nothing is cached, or when the CLI runs on a custom endpoint, another cloud or
/// remapped families: the account's catalog doesn't describe those, and the aliases do.
pub(in super::super) fn account_catalog(
    bin: Option<&std::path::Path>,
) -> Option<(
    Vec<EngineModel>,
    std::collections::HashMap<String, ModelDetails>,
)> {
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
    let value: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok()?;
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
    let value: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
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
pub(super) fn older(a: &str, b: &str) -> bool {
    let parse = |text: &str| -> Vec<u64> {
        text.split('.')
            .map(|part| part.parse().unwrap_or(0))
            .collect()
    };
    parse(a) < parse(b)
}

pub(super) fn parse_account_catalog(
    value: &serde_json::Value,
    cli_version: Option<&str>,
) -> (
    Vec<EngineModel>,
    std::collections::HashMap<String, ModelDetails>,
) {
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
                        Some(EffortLevel {
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
                        .map(|level| EffortLevel::bare(&level))
                        .collect()
                }),
        };
        let context_window = runtime
            .and_then(|runtime| runtime.get("max_input_tokens"))
            .and_then(serde_json::Value::as_u64);
        details.insert(
            id.clone(),
            ModelDetails {
                name: name.clone(),
                detail: description.clone(),
                efforts,
                default_effort: remembered
                    .get(&id)
                    .cloned()
                    .or_else(|| text(runtime.and_then(|runtime| runtime.get("default_effort")))),
                context_window,
                section: Some(
                    if text(row.get("section")).as_deref() == Some(MAIN_MODEL_SECTION) {
                        MAIN_MODEL_SECTION
                    } else {
                        "more"
                    }
                    .to_string(),
                ),
                // Its fast mode by the CLI's own name for it, and the option that turns it on.
                fast: row.get("fast_mode").and_then(|fast| {
                    Some(FastMode {
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
