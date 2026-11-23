// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/models/minimax.rs.
use super::{EngineCatalog, EngineModel};
use std::sync::Mutex;

static CACHE: Mutex<Option<Vec<EngineModel>>> = Mutex::new(None);

pub(super) async fn minimax_catalog(bin: &str) -> EngineCatalog {
    {
        let cached = CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(models) = cached.as_ref() {
            return EngineCatalog::authoritative(models.clone());
        }
    }
    if let Ok(rows) = crate::engines::minimax_acp::probe_models(bin).await {
        if !rows.is_empty() {
            let models = rows
                .into_iter()
                .map(|row| EngineModel {
                    provider: row.id.split('/').next().unwrap_or("minimax").to_string(),
                    id: row.id,
                    name: row.name,
                    description: None,
                    context_window: None,
                })
                .collect::<Vec<_>>();
            if let Ok(mut cached) = CACHE.lock() {
                *cached = Some(models.clone());
            }
            return EngineCatalog::authoritative(models);
        }
    }
    EngineCatalog::unknown()
}
