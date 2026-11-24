// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/models/mod.rs.
use super::*;

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
    let ids: Vec<String> = with_default_first(listed, None)
        .into_iter()
        .map(|m| m.id)
        .collect();
    assert_eq!(ids, vec!["a", "b"]);
}
