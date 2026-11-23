// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/models/qoder.rs.
use super::{EngineCatalog, EngineModel};
use std::collections::HashMap;
use std::sync::Mutex;

static CACHE: Mutex<Option<HashMap<&'static str, EngineCatalog>>> = Mutex::new(None);

pub(super) async fn qoder_catalog(
    engine: &'static str,
    bin: &str,
) -> Result<EngineCatalog, String> {
    {
        let cached = CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(catalog) = cached.as_ref().and_then(|map| map.get(engine)) {
            return Ok(catalog.clone());
        }
    }
    let (entries, session) = crate::engines::qoder_session::probe_models(bin).await?;
    crate::engines::modes::learn_listed(engine, super::acp_modes(&session));
    let thought = super::acp_thought_levels(&session);
    let default_index = entries.iter().position(|entry| entry.is_default);
    let mut models: Vec<EngineModel> = entries
        .into_iter()
        .map(|entry| EngineModel {
            id: entry.id,
            name: entry.name,
            description: None,
            provider: engine.to_string(),
            context_window: None,
        })
        .collect();
    if let Some(index) = default_index.filter(|index| *index > 0) {
        let entry = models.remove(index);
        models.insert(0, entry);
    }
    let details: HashMap<String, super::ModelDetails> = thought
        .map(|(levels, current)| {
            models
                .iter()
                .map(|model| {
                    (
                        model.id.clone(),
                        super::ModelDetails {
                            efforts: Some(levels.clone()),
                            default_effort: current.clone(),
                            ..super::ModelDetails::default()
                        },
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    let catalog = EngineCatalog::authoritative(models).with_details(details);
    if !catalog.models.is_empty() {
        let mut cached = CACHE.lock().unwrap_or_else(|e| e.into_inner());
        cached
            .get_or_insert_with(HashMap::new)
            .insert(engine, catalog.clone());
    }
    Ok(catalog)
}
