// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/models/grok.rs.
use super::{alias_table_catalog, promote_default, AliasFields, EngineModel};

#[allow(
    clippy::disallowed_methods,
    reason = "reads Grok's own config in place, which GROK_HOME may move outside the engine folders the gate grants"
)]
pub(super) fn grok_local_models() -> Vec<EngineModel> {
    let home = crate::engines::engine_home(Some("GROK_HOME"), ".grok");
    let Ok(content) = std::fs::read_to_string(home.join("config.toml")) else {
        return Vec::new();
    };
    parse_grok_config_models(&content)
}

pub fn parse_grok_config_models(content: &str) -> Vec<EngineModel> {
    const FIELDS: AliasFields = AliasFields {
        name_keys: &["name"],
        context_keys: &["context_window"],
        provider_key: None,
    };
    let Ok(root) = content.parse::<toml::Value>() else {
        return Vec::new();
    };
    let current = root
        .get("models")
        .and_then(|v| v.get("default"))
        .and_then(toml::Value::as_str)
        .or_else(|| root.get("model").and_then(toml::Value::as_str))
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let mut models = alias_table_catalog(&root, "model", "grok", &FIELDS);
    if models.is_empty() {
        return current
            .into_iter()
            .map(|id| EngineModel {
                id,
                name: None,
                description: None,
                provider: "grok".to_string(),
                context_window: None,
            })
            .collect();
    }
    promote_default(&mut models, current.as_deref());
    models
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grok_config_models_default_first_then_sorted() {
        let toml = "\
[models]
default = \"grok-4.6\"

[model.\"grok-4.5\"]
name = \"Grok 4.5\"
context_window = 131072

[model.\"grok-4.6\"]
name = \"Grok 4.6\"
api_backend = \"responses\"
context_window = 200000
";
        let models = parse_grok_config_models(toml);
        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, vec!["grok-4.6", "grok-4.5"]);
        assert_eq!(models[0].name.as_deref(), Some("Grok 4.6"));
        assert_eq!(models[0].context_window, Some(200_000));
        assert_eq!(models[1].context_window, Some(131_072));
    }

    #[test]
    fn grok_config_models_scalar_model_is_single_entry() {
        let models = parse_grok_config_models("model = \"grok-4.6\"\n");
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "grok-4.6");
        assert!(parse_grok_config_models("not [valid").is_empty());
        assert!(parse_grok_config_models("[session]\n").is_empty());
    }

    #[test]
    fn grok_config_models_name_matching_alias_is_dropped() {
        let toml = "\
[model.\"grok-4.6\"]
name = \"grok-4.6\"
";
        let models = parse_grok_config_models(toml);
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].name, None);
    }
}
