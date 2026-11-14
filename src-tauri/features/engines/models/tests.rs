// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/models/mod.rs.
use super::*;

#[test]
fn top_level_model_stops_at_first_table() {
    let toml = "\
model_provider = \"OpenAI\"
model = \"gpt-5.6-sol\"   # active
review_model = 'gpt-5.6-mini'

[model_providers.OpenAI]
model = \"must-not-leak\"
";
    assert_eq!(
        parse_top_level_toml_string(toml, "model"),
        Some("gpt-5.6-sol".to_string())
    );
    assert_eq!(
        parse_top_level_toml_string("[features]\nmodel = \"x\"", "model"),
        None
    );
    assert_eq!(parse_top_level_toml_string("model = ''", "model"), None);
}

#[test]
fn default_entry_leads_the_catalog() {
    let listed = vec![
        EngineModel {
            id: "a".to_string(),
            name: None,
            description: None,
            provider: "p".to_string(),
            context_window: None,
        },
        EngineModel {
            id: "b".to_string(),
            name: None,
            description: None,
            provider: "p".to_string(),
            context_window: None,
        },
    ];
    let default = || EngineModel {
        id: "b".to_string(),
        name: None,
        description: None,
        provider: "p".to_string(),
        context_window: None,
    };
    let ids: Vec<String> = with_default_first(listed.clone(), Some(default()))
        .into_iter()
        .map(|m| m.id)
        .collect();
    assert_eq!(ids, vec!["b", "a"]);
    // Absent from the catalog: prepended, not dropped.
    let absent = EngineModel {
        id: "z".to_string(),
        name: None,
        description: None,
        provider: "p".to_string(),
        context_window: None,
    };
    let ids: Vec<String> = with_default_first(listed.clone(), Some(absent))
        .into_iter()
        .map(|m| m.id)
        .collect();
    assert_eq!(ids, vec!["z", "a", "b"]);
    // No default known: order untouched.
    let ids: Vec<String> = with_default_first(listed, None)
        .into_iter()
        .map(|m| m.id)
        .collect();
    assert_eq!(ids, vec!["a", "b"]);
}
