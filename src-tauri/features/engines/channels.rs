use std::collections::HashMap;

use serde_json::Value;

pub fn env_for(engine: &str) -> HashMap<String, String> {
    let _ = engine;
    crate::engine_config::proxy::proxy_env()
}

pub fn channel_for(engine: &str) -> Option<Value> {
    match crate::engine_config::channels::resolve_provider(engine, None) {
        Ok(provider) => provider,
        Err(error) => {
            eprintln!("[engine channels] {engine}: {error}");
            None
        }
    }
}

pub fn ensure_enabled(engine: &str) -> Result<(), String> {
    crate::engine_config::channels::ensure_engine_enabled(engine)
}
