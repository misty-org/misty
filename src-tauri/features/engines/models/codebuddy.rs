// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/models/codebuddy.rs.
use super::{run_probe, EngineCatalog, EngineModel};

pub(super) async fn codebuddy_catalog(bin: &str) -> EngineCatalog {
    let default_model = read_configured_default_model();
    let registry = shipped_registry(bin);

    if let Ok(stdout) = run_probe(bin, &["--help"], "help").await {
        let mut models = parse_help_models(&stdout, &registry);
        if !models.is_empty() {
            lead_with_default(&mut models, default_model.as_deref(), &registry);
            return EngineCatalog::authoritative(models).with_details(registry_details(&registry));
        }
    }

    let mut models: Vec<EngineModel> = registry.iter().map(|entry| entry.model()).collect();
    lead_with_default(&mut models, default_model.as_deref(), &registry);
    EngineCatalog {
        models,
        details: registry_details(&registry),
        authoritative: false,
    }
}

#[derive(Debug, Clone, Default)]
pub struct RegistryEntry {
    id: String,
    name: Option<String>,
    description: Option<String>,
    context_window: Option<u64>,
    efforts: Option<Vec<String>>,
    default_effort: Option<String>,
}

impl RegistryEntry {
    fn model(&self) -> EngineModel {
        EngineModel {
            id: self.id.clone(),
            name: self.name.clone(),
            description: self.description.clone(),
            provider: provider_of(&self.id).to_string(),
            context_window: self.context_window,
        }
    }
}

#[allow(
    clippy::disallowed_methods,
    reason = "reads the registry CodeBuddy ships beside its installed program, which lives outside the gate"
)]
fn shipped_registry(bin: &str) -> Vec<RegistryEntry> {
    let Some(path) = super::super::resolve::find_cli_binary("codebuddy", Some(bin)) else {
        return Vec::new();
    };
    let Ok(real) = std::fs::canonicalize(path) else {
        return Vec::new();
    };
    real.ancestors()
        .take(5)
        .map(|dir| dir.join("product.json"))
        .find(|file| file.is_file())
        .and_then(|file| std::fs::read_to_string(file).ok())
        .map(|content| parse_registry(&content))
        .unwrap_or_default()
}

pub fn parse_registry(content: &str) -> Vec<RegistryEntry> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(content) else {
        return Vec::new();
    };
    let text = |value: Option<&serde_json::Value>| {
        value
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string)
    };
    value
        .get("models")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|row| {
            let id = text(row.get("id"))?;
            let reasoning = row.get("reasoning");
            let efforts = reasoning
                .and_then(|reasoning| reasoning.get("supportedEfforts"))
                .and_then(serde_json::Value::as_array)
                .map(|levels| {
                    levels
                        .iter()
                        .filter_map(|level| text(Some(level)))
                        .collect()
                });
            Some(RegistryEntry {
                name: text(row.get("name")),
                description: text(row.get("descriptionEn")),
                context_window: row
                    .get("contextWindow")
                    .or_else(|| row.get("maxInputTokens"))
                    .and_then(serde_json::Value::as_u64),
                efforts: efforts.or_else(|| {
                    (row.get("supportsReasoning")
                        .and_then(serde_json::Value::as_bool)
                        == Some(false))
                    .then(Vec::new)
                }),
                default_effort: reasoning.and_then(|reasoning| {
                    text(reasoning.get("defaultEffort")).or_else(|| text(reasoning.get("effort")))
                }),
                id,
            })
        })
        .collect()
}

fn registry_details(
    registry: &[RegistryEntry],
) -> std::collections::HashMap<String, super::ModelDetails> {
    registry
        .iter()
        .map(|entry| {
            (
                entry.id.clone(),
                super::ModelDetails {
                    efforts: entry.efforts.as_ref().map(|levels| {
                        levels
                            .iter()
                            .map(|level| super::EffortLevel::bare(level))
                            .collect()
                    }),
                    default_effort: entry.default_effort.clone(),
                    context_window: entry.context_window,
                    ..super::ModelDetails::default()
                },
            )
        })
        .collect()
}

const ENTERPRISE_PROVIDER: &str = "enterprise";

fn is_enterprise(id: &str) -> bool {
    id.starts_with("custom:")
}

fn catalog_entry(id: &str, registry: &[RegistryEntry]) -> EngineModel {
    registry
        .iter()
        .find(|entry| entry.id == id)
        .map(RegistryEntry::model)
        .unwrap_or_else(|| EngineModel {
            id: id.to_string(),
            name: None,
            description: None,
            provider: provider_of(id).to_string(),
            context_window: None,
        })
}

fn provider_of(id: &str) -> &'static str {
    if is_enterprise(id) {
        ENTERPRISE_PROVIDER
    } else {
        "codebuddy"
    }
}

fn lead_with_default(
    models: &mut Vec<EngineModel>,
    default_model: Option<&str>,
    registry: &[RegistryEntry],
) {
    let Some(def) = default_model else {
        return;
    };
    let item = match models.iter().position(|m| m.id == def) {
        Some(pos) => models.remove(pos),
        None => catalog_entry(def, registry),
    };
    models.insert(0, item);
}

fn codebuddy_config_dir() -> std::path::PathBuf {
    crate::engines::engine_home(Some("CODEBUDDY_CONFIG_DIR"), ".codebuddy")
}

#[allow(
    clippy::disallowed_methods,
    reason = "reads CodeBuddy's own config in place, which CODEBUDDY_CONFIG_DIR may move outside the engine folders the gate grants"
)]
fn read_configured_default_model() -> Option<String> {
    let dir = codebuddy_config_dir();
    for name in ["settings.local.json", "settings.json"] {
        if let Ok(content) = std::fs::read_to_string(dir.join(name)) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(m) = v
                    .get("model")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                {
                    return Some(m.to_string());
                }
                if let Some(m) = v
                    .pointer("/env/CODEBUDDY_MODEL")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                {
                    return Some(m.to_string());
                }
            }
        }
    }
    None
}

pub fn parse_help_models(text: &str, registry: &[RegistryEntry]) -> Vec<EngineModel> {
    let Some(start) = text.find("Currently supported: (") else {
        return Vec::new();
    };
    let after = &text[start + "Currently supported: (".len()..];
    let Some(end) = after.find(')') else {
        return Vec::new();
    };
    let list_str = &after[..end];

    let mut public_models = Vec::new();
    let mut enterprise_models = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();

    for raw in list_str.split(',') {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let id = trimmed.split('|').next().unwrap_or(trimmed).trim();
        if !seen_ids.insert(id.to_string()) {
            continue;
        }

        let model = catalog_entry(id, registry);
        if is_enterprise(id) {
            enterprise_models.push(model);
        } else {
            public_models.push(model);
        }
    }

    let mut models = public_models;
    models.extend(enterprise_models);
    models
}

#[cfg(test)]
mod tests {
    use super::*;

    const REGISTRY: &str = r#"{"models":[
      {"id":"hy4-preview","name":"Hunyuan 4 Preview","descriptionEn":"Tencent's newest","maxInputTokens":256000,
       "reasoning":{"defaultEffort":"high","supportedEfforts":["high"]}},
      {"id":"balanced-model","name":"Balanced","contextWindow":200000,"reasoning":{"effort":"medium"}},
      {"id":"plain","name":"Plain","supportsReasoning":false}
    ]}"#;

    fn ids(models: &[EngineModel]) -> Vec<&str> {
        models.iter().map(|m| m.id.as_str()).collect()
    }

    #[test]
    fn rows_take_the_shipped_registry_names_never_our_own() {
        let registry = parse_registry(REGISTRY);
        let models = parse_help_models(
            "Currently supported: (custom:kimi-k3, hy4-preview, deepseek-v4-pro|deepseek-v4-pro)",
            &registry,
        );
        assert_eq!(
            ids(&models),
            ["hy4-preview", "deepseek-v4-pro", "custom:kimi-k3"]
        );
        assert_eq!(models[0].name.as_deref(), Some("Hunyuan 4 Preview"));
        assert_eq!(models[0].description.as_deref(), Some("Tencent's newest"));
        assert_eq!(models[0].context_window, Some(256_000));
        assert_eq!(models[1].name, None);
        assert_eq!(models[2].provider, "enterprise");
    }

    #[test]
    fn registry_levels_and_defaults_are_the_cli_own() {
        let registry = parse_registry(REGISTRY);
        let details = registry_details(&registry);
        let hy = &details["hy4-preview"];
        assert_eq!(hy.efforts.as_ref().map(Vec::len), Some(1));
        assert_eq!(hy.default_effort.as_deref(), Some("high"));
        assert_eq!(details["balanced-model"].efforts, None);
        assert_eq!(
            details["balanced-model"].default_effort.as_deref(),
            Some("medium")
        );
        assert_eq!(details["plain"].efforts.as_ref().map(Vec::len), Some(0));
    }

    #[test]
    fn duplicate_help_entries_collapse_to_one_row() {
        let models = parse_help_models(
            "Currently supported: (custom:glm-5.3, glm-5.3, custom:glm-5.3|glm-5.3)",
            &[],
        );
        assert_eq!(ids(&models), ["glm-5.3", "custom:glm-5.3"]);
    }

    #[test]
    fn configured_enterprise_default_leads_the_catalog() {
        let mut models = parse_help_models(
            "Currently supported: (hy4-preview, glm-5.3, custom:glm-5.3, custom:kimi-k3.1-pro)",
            &[],
        );
        lead_with_default(&mut models, Some("custom:kimi-k3.1-pro"), &[]);
        assert_eq!(
            ids(&models),
            [
                "custom:kimi-k3.1-pro",
                "hy4-preview",
                "glm-5.3",
                "custom:glm-5.3"
            ]
        );
        assert_eq!(models[0].provider, "enterprise");
    }

    #[test]
    fn unlisted_default_is_added_first() {
        let registry = parse_registry(REGISTRY);
        let mut models = parse_help_models("Currently supported: (glm-5.3)", &registry);
        lead_with_default(&mut models, Some("hy4-preview"), &registry);
        assert_eq!(models[0].id, "hy4-preview");
        assert_eq!(models[0].name.as_deref(), Some("Hunyuan 4 Preview"));
        lead_with_default(&mut models, None, &registry);
        assert_eq!(models[0].id, "hy4-preview");
    }
}
